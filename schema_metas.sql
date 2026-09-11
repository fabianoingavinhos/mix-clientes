-- ============================================================
--  MIX CLIENTES — Metas por cliente (venda do ano passado x mês atual)
--  Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--  Pode ser executado mais de uma vez (idempotente).
--
--  Duas planilhas alimentam a tabela "vendas":
--    origem = 'hist'  -> Relatório 8238 (venda por cliente/produto de set, out, nov e dez do ano passado)
--    origem = 'atual' -> Relatório 8239 (venda por cliente/produto do mês atual)
--  A meta do cliente para o mês M = venda do mesmo mês do ano anterior
--    + 15% financeiro, + 15% quantidade, + 20% mix, + 15% clientes atendidos (percentuais em config.js).
-- ============================================================

create table if not exists public.vendas (
  id              bigserial primary key,
  origem          text not null check (origem in ('hist','atual')),
  cod_supervisor  integer,
  supervisor      text,
  cod_vendedor    integer,
  vendedor        text,
  codcli          integer not null,
  cliente         text,
  fantasia        text,
  cnpj_cpf        text,
  cidade          text,
  uf              text,
  codprod         integer not null,
  descricao       text,
  embalagem       text,
  unidade         text,
  codfornec       integer,
  fornecedor      text,
  mes             date not null,          -- primeiro dia do mês da venda
  qtd             numeric,                -- quantidade líquida (faturada - devolvida)
  valor           numeric                 -- valor líquido
);

create index if not exists vendas_origem_mes_idx     on public.vendas (origem, mes);
create index if not exists vendas_codcli_idx         on public.vendas (codcli);
create index if not exists vendas_cod_vendedor_idx   on public.vendas (cod_vendedor);
create index if not exists vendas_cod_supervisor_idx on public.vendas (cod_supervisor);

alter table public.vendas enable row level security;

-- Mesma regra de visibilidade do mix
drop policy if exists vendas_select on public.vendas;
create policy vendas_select on public.vendas
  for select to authenticated
  using (
    (select p.role from public.profiles p where p.id = auth.uid()) = 'admin'
    or vendas.cod_supervisor = (select p.cod_supervisor from public.profiles p where p.id = auth.uid() and p.role = 'supervisor')
    or vendas.cod_vendedor   = (select p.cod_vendedor   from public.profiles p where p.id = auth.uid() and p.role = 'vendedor')
  );

drop policy if exists vendas_insert_admin on public.vendas;
create policy vendas_insert_admin on public.vendas
  for insert to authenticated
  with check (public.is_admin());

-- Situação de cada upload
create table if not exists public.vendas_meta (
  origem        text primary key check (origem in ('hist','atual')),
  atualizado_em timestamptz,
  linhas        integer,
  arquivo       text,
  meses         text            -- ex: "09/2025, 10/2025, 11/2025, 12/2025"
);
alter table public.vendas_meta enable row level security;
drop policy if exists vendas_meta_select on public.vendas_meta;
create policy vendas_meta_select on public.vendas_meta for select to authenticated using (true);
drop policy if exists vendas_meta_write on public.vendas_meta;
create policy vendas_meta_write on public.vendas_meta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_limpar_vendas(p_origem text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  delete from public.vendas where origem = p_origem;
end;
$$;

create or replace function public.admin_registrar_upload_vendas(p_origem text, p_linhas integer, p_arquivo text, p_meses text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  insert into public.vendas_meta (origem, atualizado_em, linhas, arquivo, meses)
  values (p_origem, now(), p_linhas, p_arquivo, p_meses)
  on conflict (origem) do update
    set atualizado_em = excluded.atualizado_em, linhas = excluded.linhas, arquivo = excluded.arquivo, meses = excluded.meses;
end;
$$;

-- ------------------------------------------------------------
-- Referência de meses: mês atual (maior mês do relatório 8239, ou o mês de hoje)
-- e mês base (mesmo mês do ano anterior no 8238). Se o 8238 não tiver esse mês,
-- usa a média mensal dos meses carregados (modo 'media').
-- ------------------------------------------------------------
create or replace function public.metas_referencia()
returns table (mes_atual date, mes_base date, modo text, meses_hist integer)
language sql stable security invoker set search_path = public
as $$
  with a as (
    select coalesce((select max(mes) from public.vendas where origem = 'atual'), date_trunc('month', current_date)::date) as mes_atual
  ), b as (
    select a.mes_atual, (a.mes_atual - interval '1 year')::date as bm,
           (select count(distinct mes) from public.vendas where origem = 'hist')::integer as nm
    from a
  )
  select mes_atual,
         case when exists (select 1 from public.vendas v where v.origem = 'hist' and v.mes = b.bm) then b.bm else null end,
         case when exists (select 1 from public.vendas v where v.origem = 'hist' and v.mes = b.bm) then 'mes' when nm > 0 then 'media' else 'sem_base' end,
         nm
  from b;
$$;

-- ------------------------------------------------------------
-- Meta por cliente: base (ano passado) x realizado (mês atual). Respeita RLS.
-- Os percentuais são aplicados na tela (config.js).
-- ------------------------------------------------------------
create or replace function public.metas_clientes()
returns table (
  codcli integer, cliente text, fantasia text, cidade text, uf text,
  cod_vendedor integer, vendedor text, cod_supervisor integer, supervisor text,
  base_valor numeric, base_qtd numeric, base_mix integer,
  real_valor numeric, real_qtd numeric, real_mix integer,
  mes_atual date, mes_base date, modo text
)
language plpgsql stable security invoker set search_path = public
as $$
declare
  r_atual date; r_base date; r_modo text; r_div numeric;
begin
  select ref.mes_atual, ref.mes_base, ref.modo, case when ref.modo = 'media' then greatest(ref.meses_hist, 1) else 1 end
    into r_atual, r_base, r_modo, r_div
  from public.metas_referencia() ref;
  return query
  with h as (
    select v.codcli, max(v.cliente) cliente, max(v.fantasia) fantasia, max(v.cidade) cidade, max(v.uf) uf,
           max(v.cod_vendedor) cod_vendedor, max(v.vendedor) vendedor, max(v.cod_supervisor) cod_supervisor, max(v.supervisor) supervisor,
           sum(v.valor) / r_div as base_valor,
           sum(v.qtd)   / r_div as base_qtd,
           -- mix = produtos distintos com quantidade no mês base (no modo 'media': média mensal de produtos distintos)
           round((count(*) filter (where coalesce(v.qtd, 0) > 0))::numeric / r_div)::integer as base_mix
    from public.vendas v
    where v.origem = 'hist' and (r_modo = 'media' or v.mes = r_base)
    group by v.codcli
  ),
  a as (
    select v.codcli, max(v.cliente) cliente, max(v.fantasia) fantasia, max(v.cidade) cidade, max(v.uf) uf,
           max(v.cod_vendedor) cod_vendedor, max(v.vendedor) vendedor, max(v.cod_supervisor) cod_supervisor, max(v.supervisor) supervisor,
           sum(v.valor) real_valor, sum(v.qtd) real_qtd,
           (count(distinct v.codprod) filter (where coalesce(v.qtd, 0) > 0))::integer real_mix
    from public.vendas v
    where v.origem = 'atual' and v.mes = r_atual
    group by v.codcli
  )
  select coalesce(h.codcli, a.codcli), coalesce(a.cliente, h.cliente), coalesce(a.fantasia, h.fantasia), coalesce(a.cidade, h.cidade), coalesce(a.uf, h.uf),
         coalesce(a.cod_vendedor, h.cod_vendedor), coalesce(a.vendedor, h.vendedor), coalesce(a.cod_supervisor, h.cod_supervisor), coalesce(a.supervisor, h.supervisor),
         coalesce(h.base_valor, 0), coalesce(h.base_qtd, 0), coalesce(h.base_mix, 0),
         coalesce(a.real_valor, 0), coalesce(a.real_qtd, 0), coalesce(a.real_mix, 0),
         r_atual, r_base, r_modo
  from h full outer join a on a.codcli = h.codcli;
end;
$$;

-- Registro de uso: novo tipo "metas"
alter table public.acessos drop constraint if exists acessos_tipo_check;
alter table public.acessos add constraint acessos_tipo_check check (tipo in ('acesso','consulta','roteiro','clientes','metas'));
