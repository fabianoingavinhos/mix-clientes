-- ============================================================
--  MIX CLIENTES — Schema do Supabase
--  Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--  Pode ser executado mais de uma vez (idempotente).
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 1. PERFIS DE USUÁRIO
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  login          text not null unique,
  nome           text not null,
  role           text not null check (role in ('admin','supervisor','vendedor')),
  cod_vendedor   integer,
  cod_supervisor integer,
  created_at     timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: perfil do usuário logado
create or replace function public.meu_perfil()
returns public.profiles
language sql stable security definer set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2. BASE DO MIX (planilha)
-- ------------------------------------------------------------
create table if not exists public.mix (
  id                          bigserial primary key,
  codcli                      integer not null,
  cliente                     text,
  fantasia                    text,
  cnpj_cpf                    text,
  cidade                      text,
  uf                          text,
  cod_vendedor                integer,
  vendedor                    text,
  cod_supervisor              integer,
  supervisor                  text,
  codprod                     integer,
  descricao                   text,
  embalagem                   text,
  unidade                     text,
  codfornec                   integer,
  fornecedor                  text,
  primeira_compra_periodo     date,
  ultima_compra               date,
  dias_sem_comprar            integer,
  qtd_pedidos                 integer,
  qtd_notas                   integer,
  qtd_total_comprada          numeric,
  valor_total_comprado        numeric,
  preco_medio                 numeric,
  ultimo_preco_pago           numeric,
  estoque_filial_1            integer,
  qtd_bloqueada_filial_1      integer,
  qtd_reservada_filial_1      integer,
  estoque_disponivel_filial_1 integer,
  status_ultima_compra        text
);

create index if not exists mix_codcli_idx        on public.mix (codcli);
create index if not exists mix_cod_vendedor_idx  on public.mix (cod_vendedor);
create index if not exists mix_cod_supervisor_idx on public.mix (cod_supervisor);
create index if not exists mix_cliente_idx       on public.mix (lower(cliente));
create index if not exists mix_fantasia_idx      on public.mix (lower(fantasia));
create extension if not exists pg_trgm with schema extensions;
create index if not exists mix_cliente_trgm  on public.mix using gin (cliente  extensions.gin_trgm_ops);
create index if not exists mix_fantasia_trgm on public.mix using gin (fantasia extensions.gin_trgm_ops);

alter table public.mix enable row level security;

-- Regra central de visibilidade:
--   admin       -> tudo
--   supervisor  -> linhas do seu cod_supervisor
--   vendedor    -> linhas do seu cod_vendedor
-- Os subselects entre parênteses são avaliados UMA vez por consulta (InitPlan),
-- permitindo ao Postgres usar os índices de cod_vendedor / cod_supervisor.
drop policy if exists mix_select on public.mix;
create policy mix_select on public.mix
  for select to authenticated
  using (
    (select p.role from public.profiles p where p.id = auth.uid()) = 'admin'
    or mix.cod_supervisor = (select p.cod_supervisor from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
    or mix.cod_vendedor   = (select p.cod_vendedor   from public.profiles p where p.id = auth.uid() and p.role = 'vendedor')
  );

drop policy if exists mix_insert_admin on public.mix;
create policy mix_insert_admin on public.mix
  for insert to authenticated
  with check (public.is_admin());

-- Metadados da base (data do último upload)
create table if not exists public.mix_meta (
  id            integer primary key default 1 check (id = 1),
  atualizado_em timestamptz,
  linhas        integer,
  arquivo       text
);
alter table public.mix_meta enable row level security;
drop policy if exists mix_meta_select on public.mix_meta;
create policy mix_meta_select on public.mix_meta for select to authenticated using (true);
drop policy if exists mix_meta_write on public.mix_meta;
create policy mix_meta_write on public.mix_meta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 3. BUSCA DE CLIENTES (respeita RLS -> security invoker)
-- ------------------------------------------------------------
create or replace function public.buscar_clientes(q text, limite integer default 60)
returns table (
  codcli integer, cliente text, fantasia text, cidade text, uf text,
  cod_vendedor integer, vendedor text, cod_supervisor integer, supervisor text,
  produtos bigint, valor_total numeric, ultima_compra date
)
language sql stable security invoker set search_path = public
as $$
  with base as (
    select * from public.mix m
    where q is null or q = ''
       or m.codcli::text = q
       or m.cliente  ilike '%' || q || '%'
       or m.fantasia ilike '%' || q || '%'
       or m.cnpj_cpf ilike '%' || q || '%'
  )
  select codcli,
         max(cliente), max(fantasia), max(cidade), max(uf),
         max(cod_vendedor), max(vendedor), max(cod_supervisor), max(supervisor),
         count(*), sum(valor_total_comprado), max(ultima_compra)
  from base
  group by codcli
  order by max(cliente)
  limit limite;
$$;

-- Lista de vendedores/supervisores presentes na base (ajuda no cadastro)
create or replace function public.listar_equipe()
returns table (cod_vendedor integer, vendedor text, cod_supervisor integer, supervisor text, clientes bigint)
language sql stable security invoker set search_path = public
as $$
  select cod_vendedor, max(vendedor), cod_supervisor, max(supervisor), count(distinct codcli)
  from public.mix
  group by cod_vendedor, cod_supervisor
  order by max(supervisor), max(vendedor);
$$;

-- ------------------------------------------------------------
-- 4. FUNÇÕES ADMINISTRATIVAS (security definer)
-- ------------------------------------------------------------

-- Cria usuário no auth + perfil. Uso interno (não exposta ao front).
create or replace function public._criar_usuario_interno(
  p_login text, p_senha text, p_nome text, p_role text,
  p_cod_vendedor integer, p_cod_supervisor integer
) returns uuid
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_login)) || '@mix.app';
begin
  if p_role not in ('admin','supervisor','vendedor') then
    raise exception 'Perfil inválido';
  end if;
  if length(coalesce(p_senha,'')) < 4 then
    raise exception 'Senha deve ter pelo menos 4 caracteres';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Login já existe';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, is_super_admin
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_senha, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nome', p_nome),
    now(), now(), '', '', '', '', false
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.profiles (id, login, nome, role, cod_vendedor, cod_supervisor)
  values (v_id, lower(trim(p_login)), p_nome, p_role, p_cod_vendedor, p_cod_supervisor);

  return v_id;
end;
$$;
revoke all on function public._criar_usuario_interno(text,text,text,text,integer,integer) from public, anon, authenticated;

-- Exposta ao front: só admin
create or replace function public.admin_criar_usuario(
  p_login text, p_senha text, p_nome text, p_role text,
  p_cod_vendedor integer default null, p_cod_supervisor integer default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  return public._criar_usuario_interno(p_login, p_senha, p_nome, p_role, p_cod_vendedor, p_cod_supervisor);
end;
$$;

-- Redefinir senha de qualquer usuário (admin)
create or replace function public.admin_redefinir_senha(p_user_id uuid, p_senha text)
returns void
language plpgsql security definer set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if length(coalesce(p_senha,'')) < 4 then raise exception 'Senha deve ter pelo menos 4 caracteres'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
end;
$$;

-- Editar dados do perfil (admin)
create or replace function public.admin_editar_usuario(
  p_user_id uuid, p_nome text, p_role text, p_cod_vendedor integer, p_cod_supervisor integer
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if p_role not in ('admin','supervisor','vendedor') then raise exception 'Perfil inválido'; end if;
  update public.profiles
     set nome = p_nome, role = p_role, cod_vendedor = p_cod_vendedor, cod_supervisor = p_cod_supervisor
   where id = p_user_id;
end;
$$;

-- Excluir usuário (admin). Não permite excluir a si mesmo.
create or replace function public.admin_excluir_usuario(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if p_user_id = auth.uid() then raise exception 'Você não pode excluir o próprio usuário'; end if;
  delete from auth.users where id = p_user_id;
end;
$$;

-- Trocar a própria senha (qualquer usuário logado)
create or replace function public.trocar_minha_senha(p_senha text)
returns void
language plpgsql security definer set search_path = public, auth, extensions
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if length(coalesce(p_senha,'')) < 4 then raise exception 'Senha deve ter pelo menos 4 caracteres'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now()
   where id = auth.uid();
end;
$$;

-- Limpar base antes de novo upload (admin)
create or replace function public.admin_limpar_mix()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  truncate table public.mix restart identity;
end;
$$;

-- Registrar upload (admin)
create or replace function public.admin_registrar_upload(p_linhas integer, p_arquivo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  insert into public.mix_meta (id, atualizado_em, linhas, arquivo)
  values (1, now(), p_linhas, p_arquivo)
  on conflict (id) do update
    set atualizado_em = excluded.atualizado_em, linhas = excluded.linhas, arquivo = excluded.arquivo;
end;
$$;

-- ------------------------------------------------------------
-- 6. REGISTRO DE USO (acessos e consultas)
-- ------------------------------------------------------------
create table if not exists public.acessos (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tipo       text not null check (tipo in ('acesso','consulta')),
  codcli     integer,
  criado_em  timestamptz not null default now()
);
create index if not exists acessos_user_data_idx on public.acessos (user_id, criado_em desc);
create index if not exists acessos_data_idx on public.acessos (criado_em desc);
alter table public.acessos enable row level security;

drop policy if exists acessos_insert_proprio on public.acessos;
create policy acessos_insert_proprio on public.acessos
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists acessos_select_admin on public.acessos;
create policy acessos_select_admin on public.acessos
  for select to authenticated using (public.is_admin());

-- Resumo de uso por usuário (admin)
create or replace function public.admin_uso()
returns table (
  id uuid, login text, nome text, role text, cod_vendedor integer, cod_supervisor integer,
  ultimo_login timestamptz, ultimo_acesso timestamptz,
  acessos_30d bigint, consultas_30d bigint, consultas_hoje bigint, clientes_30d bigint, consultas_total bigint
)
language sql stable security definer set search_path = public, auth
as $$
  select p.id, p.login, p.nome, p.role, p.cod_vendedor, p.cod_supervisor,
         u.last_sign_in_at,
         (select max(a.criado_em) from public.acessos a where a.user_id = p.id),
         (select count(*) from public.acessos a where a.user_id = p.id and a.tipo = 'acesso'   and a.criado_em >= now() - interval '30 days'),
         (select count(*) from public.acessos a where a.user_id = p.id and a.tipo = 'consulta' and a.criado_em >= now() - interval '30 days'),
         (select count(*) from public.acessos a where a.user_id = p.id and a.tipo = 'consulta' and a.criado_em >= date_trunc('day', now() at time zone 'America/Recife') at time zone 'America/Recife'),
         (select count(distinct a.codcli) from public.acessos a where a.user_id = p.id and a.tipo = 'consulta' and a.criado_em >= now() - interval '30 days'),
         (select count(*) from public.acessos a where a.user_id = p.id and a.tipo = 'consulta')
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_admin()
  order by coalesce((select max(a.criado_em) from public.acessos a where a.user_id = p.id), u.last_sign_in_at) desc nulls last, p.nome;
$$;

-- Últimas consultas (admin)
create or replace function public.admin_uso_recente(limite integer default 100)
returns table (criado_em timestamptz, login text, nome text, role text, tipo text, codcli integer, cliente text, fantasia text)
language sql stable security definer set search_path = public
as $$
  select a.criado_em, p.login, p.nome, p.role, a.tipo, a.codcli,
         (select max(m.cliente)  from public.mix m where m.codcli = a.codcli),
         (select max(m.fantasia) from public.mix m where m.codcli = a.codcli)
  from public.acessos a
  join public.profiles p on p.id = a.user_id
  where public.is_admin()
  order by a.criado_em desc
  limit limite;
$$;

-- ------------------------------------------------------------
-- 5. USUÁRIO ADMIN INICIAL
--    login: admin   senha: admin123   (troque depois no painel!)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.profiles where login = 'admin') then
    perform public._criar_usuario_interno('admin', 'admin123', 'Administrador', 'admin', null, null);
  end if;
end;
$$;
