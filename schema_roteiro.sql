-- ============================================================
--  MIX CLIENTES — Roteiro de promotores
--  Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--  Pode ser executado mais de uma vez (idempotente).
--  Pré-requisito: schema.sql já executado (profiles, is_admin, ...).
-- ============================================================

-- ------------------------------------------------------------
-- 1. BASE DO ROTEIRO (planilha "relatorio pr")
-- ------------------------------------------------------------
create table if not exists public.roteiro (
  id                      bigserial primary key,
  cod_supervisor          integer,
  supervisor              text,
  cod_sup_promotor        integer,
  supervisor_promotor     text,
  cod_vendedor            integer,   -- COD_RCA
  vendedor                text,      -- RCA
  cod_promotor            integer,
  promotor                text,
  codcli                  integer not null,
  cliente                 text,
  fantasia                text,
  cnpj_cpf                text,
  endereco                text,
  numero                  text,
  bairro                  text,
  cidade                  text,
  uf                      text,
  ultima_compra           date,
  dias_sem_comprar        integer,
  dia_semana_cadastrado   text,
  dia_semana              text,
  proxima_visita          date,
  dia_calculado           text,
  horario_visita          text,
  sequencia_visita        integer,
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
  qtd_clientes_promotor   integer
);

create index if not exists roteiro_codcli_idx         on public.roteiro (codcli);
create index if not exists roteiro_cod_vendedor_idx   on public.roteiro (cod_vendedor);
create index if not exists roteiro_cod_supervisor_idx on public.roteiro (cod_supervisor);
create index if not exists roteiro_proxima_visita_idx on public.roteiro (proxima_visita);
create index if not exists roteiro_cod_promotor_idx   on public.roteiro (cod_promotor);

alter table public.roteiro enable row level security;

-- Mesma regra de visibilidade do mix:
--   admin       -> tudo
--   supervisor  -> linhas do seu cod_supervisor
--   vendedor    -> linhas do seu cod_vendedor (COD_RCA)
drop policy if exists roteiro_select on public.roteiro;
create policy roteiro_select on public.roteiro
  for select to authenticated
  using (
    (select p.role from public.profiles p where p.id = auth.uid()) = 'admin'
    or roteiro.cod_supervisor = (select p.cod_supervisor from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
    or roteiro.cod_vendedor   = (select p.cod_vendedor   from public.profiles p where p.id = auth.uid() and p.role = 'vendedor')
  );

drop policy if exists roteiro_insert_admin on public.roteiro;
create policy roteiro_insert_admin on public.roteiro
  for insert to authenticated
  with check (public.is_admin());

-- Metadados (data do último upload do roteiro)
create table if not exists public.roteiro_meta (
  id            integer primary key default 1 check (id = 1),
  atualizado_em timestamptz,
  linhas        integer,
  arquivo       text
);
alter table public.roteiro_meta enable row level security;
drop policy if exists roteiro_meta_select on public.roteiro_meta;
create policy roteiro_meta_select on public.roteiro_meta for select to authenticated using (true);
drop policy if exists roteiro_meta_write on public.roteiro_meta;
create policy roteiro_meta_write on public.roteiro_meta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2. FUNÇÕES ADMINISTRATIVAS
-- ------------------------------------------------------------
create or replace function public.admin_limpar_roteiro()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  truncate table public.roteiro restart identity;
end;
$$;

create or replace function public.admin_registrar_upload_roteiro(p_linhas integer, p_arquivo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  insert into public.roteiro_meta (id, atualizado_em, linhas, arquivo)
  values (1, now(), p_linhas, p_arquivo)
  on conflict (id) do update
    set atualizado_em = excluded.atualizado_em, linhas = excluded.linhas, arquivo = excluded.arquivo;
end;
$$;

-- Registro de uso: novo tipo "roteiro"
alter table public.acessos drop constraint if exists acessos_tipo_check;
alter table public.acessos add constraint acessos_tipo_check check (tipo in ('acesso','consulta','roteiro'));
