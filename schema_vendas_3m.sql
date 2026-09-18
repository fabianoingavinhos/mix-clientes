-- ============================================================
--  MIX CLIENTES — Venda dos últimos 3 meses por cliente (aba Clientes)
--  Alimentada automaticamente pelo agente Winthor (rotina V3M).
--  Cole no SQL Editor do Supabase e execute (idempotente).
-- ============================================================

create table if not exists public.vendas_3m (
  id              bigserial primary key,
  cod_supervisor  integer,
  supervisor      text,
  cod_vendedor    integer,
  vendedor        text,
  codcli          integer not null,
  cliente         text,
  fantasia        text,
  mes_1           date,          -- 3 meses atrás (1º dia)
  mes_2           date,
  mes_3           date,          -- mês passado
  mes_atual       date,
  vlr_m1          numeric,
  vlr_m2          numeric,
  vlr_m3          numeric,
  vlr_atual       numeric,
  media_vlr_3m    numeric,
  qtd_m1          numeric,
  qtd_m2          numeric,
  qtd_m3          numeric,
  qtd_atual       numeric,
  media_qtd_3m    numeric,
  ped_m1          integer,
  ped_m2          integer,
  ped_m3          integer,
  ped_atual       integer,
  mix_3m          integer
);

create index if not exists vendas_3m_codcli_idx         on public.vendas_3m (codcli);
create index if not exists vendas_3m_cod_vendedor_idx   on public.vendas_3m (cod_vendedor);
create index if not exists vendas_3m_cod_supervisor_idx on public.vendas_3m (cod_supervisor);

alter table public.vendas_3m enable row level security;

-- Mesma regra de visibilidade do mix
drop policy if exists vendas_3m_select on public.vendas_3m;
create policy vendas_3m_select on public.vendas_3m
  for select to authenticated
  using (
    (select p.role from public.profiles p where p.id = auth.uid()) = 'admin'
    or vendas_3m.cod_supervisor = (select p.cod_supervisor from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
    or vendas_3m.cod_vendedor   = (select p.cod_vendedor   from public.profiles p where p.id = auth.uid() and p.role = 'vendedor')
  );

drop policy if exists vendas_3m_insert_admin on public.vendas_3m;
create policy vendas_3m_insert_admin on public.vendas_3m
  for insert to authenticated
  with check (public.is_admin());

create table if not exists public.vendas_3m_meta (
  id            integer primary key default 1 check (id = 1),
  atualizado_em timestamptz,
  linhas        integer,
  arquivo       text
);
alter table public.vendas_3m_meta enable row level security;
drop policy if exists vendas_3m_meta_select on public.vendas_3m_meta;
create policy vendas_3m_meta_select on public.vendas_3m_meta for select to authenticated using (true);
drop policy if exists vendas_3m_meta_write on public.vendas_3m_meta;
create policy vendas_3m_meta_write on public.vendas_3m_meta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_limpar_vendas_3m()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  truncate table public.vendas_3m restart identity;
end;
$$;

create or replace function public.admin_registrar_upload_vendas_3m(p_linhas integer, p_arquivo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  insert into public.vendas_3m_meta (id, atualizado_em, linhas, arquivo)
  values (1, now(), p_linhas, p_arquivo)
  on conflict (id) do update
    set atualizado_em = excluded.atualizado_em, linhas = excluded.linhas, arquivo = excluded.arquivo;
end;
$$;
