-- ============================================================
--  MIX CLIENTES — Roteiro do vendedor (RCA)
--  Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--  Pode ser executado mais de uma vez (idempotente).
-- ============================================================

create table if not exists public.roteiro_vendedor (
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
  dia_semana_cadastrado   text,
  dia_semana              text,
  proxima_visita          date,
  sequencia_visita        integer,
  horario_visita          text,
  periodicidade           integer,
  numero_semana           integer,
  ciclo_visita            text,
  dia_fixo                text,
  data_inicio_rota        date,
  data_final_rota         date,
  ultima_visita_prevista  date,
  data_referencia         date,
  zona                    text,
  observacao              text,
  status_rota             text,
  ultima_compra           date,
  dias_sem_comprar        integer,
  status_ultima_compra    text
);

create index if not exists roteiro_vendedor_codcli_idx         on public.roteiro_vendedor (codcli);
create index if not exists roteiro_vendedor_cod_vendedor_idx   on public.roteiro_vendedor (cod_vendedor);
create index if not exists roteiro_vendedor_cod_supervisor_idx on public.roteiro_vendedor (cod_supervisor);
create index if not exists roteiro_vendedor_proxima_idx        on public.roteiro_vendedor (proxima_visita);

alter table public.roteiro_vendedor enable row level security;

drop policy if exists roteiro_vendedor_select on public.roteiro_vendedor;
create policy roteiro_vendedor_select on public.roteiro_vendedor
  for select to authenticated
  using (
    (select p.role from public.profiles p where p.id = auth.uid()) = 'admin'
    or roteiro_vendedor.cod_supervisor = (select p.cod_supervisor from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
    or roteiro_vendedor.cod_vendedor   = (select p.cod_vendedor   from public.profiles p where p.id = auth.uid() and p.role = 'vendedor')
  );

drop policy if exists roteiro_vendedor_insert_admin on public.roteiro_vendedor;
create policy roteiro_vendedor_insert_admin on public.roteiro_vendedor
  for insert to authenticated
  with check (public.is_admin());

create table if not exists public.roteiro_vendedor_meta (
  id            integer primary key default 1 check (id = 1),
  atualizado_em timestamptz,
  linhas        integer,
  arquivo       text
);
alter table public.roteiro_vendedor_meta enable row level security;
drop policy if exists roteiro_vendedor_meta_select on public.roteiro_vendedor_meta;
create policy roteiro_vendedor_meta_select on public.roteiro_vendedor_meta for select to authenticated using (true);
drop policy if exists roteiro_vendedor_meta_write on public.roteiro_vendedor_meta;
create policy roteiro_vendedor_meta_write on public.roteiro_vendedor_meta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_limpar_roteiro_vendedor()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  truncate table public.roteiro_vendedor restart identity;
end;
$$;

create or replace function public.admin_registrar_upload_roteiro_vendedor(p_linhas integer, p_arquivo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  insert into public.roteiro_vendedor_meta (id, atualizado_em, linhas, arquivo)
  values (1, now(), p_linhas, p_arquivo)
  on conflict (id) do update
    set atualizado_em = excluded.atualizado_em, linhas = excluded.linhas, arquivo = excluded.arquivo;
end;
$$;
