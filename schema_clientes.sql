-- ============================================================
--  MIX CLIENTES — Base de clientes (aba "Clientes")
--  Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--  Pode ser executado mais de uma vez (idempotente).
-- ============================================================

create table if not exists public.clientes (
  id                      bigserial primary key,
  cod_supervisor          integer,
  supervisor              text,
  cod_vendedor            integer,   -- COD_RCA
  vendedor                text,      -- RCA
  codcli                  integer not null,
  cliente                 text,
  fantasia                text,
  cnpj_cpf                text,
  endereco                text,
  numero                  text,
  bairro                  text,
  cidade                  text,
  uf                      text,
  telefone                text,
  ultima_compra           date,
  dias_sem_comprar        integer,
  status_ultima_compra    text,
  qtd_clientes_rca        integer,
  qtd_clientes_supervisor integer
);

create index if not exists clientes_codcli_idx         on public.clientes (codcli);
create index if not exists clientes_cod_vendedor_idx   on public.clientes (cod_vendedor);
create index if not exists clientes_cod_supervisor_idx on public.clientes (cod_supervisor);

alter table public.clientes enable row level security;

-- Mesma regra de visibilidade do mix
drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (
    (select p.role from public.profiles p where p.id = auth.uid()) = 'admin'
    or clientes.cod_supervisor = (select p.cod_supervisor from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
    or clientes.cod_vendedor   = (select p.cod_vendedor   from public.profiles p where p.id = auth.uid() and p.role = 'vendedor')
  );

drop policy if exists clientes_insert_admin on public.clientes;
create policy clientes_insert_admin on public.clientes
  for insert to authenticated
  with check (public.is_admin());

create table if not exists public.clientes_meta (
  id            integer primary key default 1 check (id = 1),
  atualizado_em timestamptz,
  linhas        integer,
  arquivo       text
);
alter table public.clientes_meta enable row level security;
drop policy if exists clientes_meta_select on public.clientes_meta;
create policy clientes_meta_select on public.clientes_meta for select to authenticated using (true);
drop policy if exists clientes_meta_write on public.clientes_meta;
create policy clientes_meta_write on public.clientes_meta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_limpar_clientes()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  truncate table public.clientes restart identity;
end;
$$;

create or replace function public.admin_registrar_upload_clientes(p_linhas integer, p_arquivo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  insert into public.clientes_meta (id, atualizado_em, linhas, arquivo)
  values (1, now(), p_linhas, p_arquivo)
  on conflict (id) do update
    set atualizado_em = excluded.atualizado_em, linhas = excluded.linhas, arquivo = excluded.arquivo;
end;
$$;

-- Registro de uso: novo tipo "clientes"
alter table public.acessos drop constraint if exists acessos_tipo_check;
alter table public.acessos add constraint acessos_tipo_check check (tipo in ('acesso','consulta','roteiro','clientes'));

