-- ============================================================
--  MIX CLIENTES — App do vendedor e do supervisor
--  Presença automática nas lojas, pedidos do mês (positivação), metas,
--  entregas (Fusion), visitas do promotor (Promotor na Rede), alertas e push.
--  Cole no SQL Editor do Supabase e execute (idempotente).
--  Pré-requisito: schema.sql, schema_clientes.sql e schema_integracao.sql.
-- ============================================================

-- Regra de visibilidade padrão (admin tudo; supervisor a equipe; vendedor o seu)
create or replace function public.app_pode_ver(p_cod_vendedor integer, p_cod_supervisor integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select p.role = 'admin'
        or (p.role = 'supervisor' and p.cod_supervisor = p_cod_supervisor)
        or (p.role = 'vendedor'   and p.cod_vendedor   = p_cod_vendedor)
    from public.profiles p where p.id = auth.uid()), false);
$$;

-- ------------------------------------------------------------
-- 1. CONFIGURAÇÃO DO APP (uma linha; leitura para todos os logados)
-- ------------------------------------------------------------
create table if not exists public.app_config (
  id                 integer primary key default 1 check (id = 1),
  raio_padrao_m      integer not null default 80,     -- raio da loja para contar presença
  permanencia_min    integer not null default 3,      -- minutos no local para contar visita
  hora_inicio        integer not null default 6,      -- só registra presença neste horário
  hora_fim           integer not null default 20,
  dias_uteis         text    not null default '1,2,3,4,5,6',  -- 0=dom … 6=sáb
  alertas_horarios   text    not null default '07:00,11:50,16:50',
  meta_visitas_dia   integer,                          -- se nulo, usa o roteiro do dia
  vapid_public       text,                             -- chave pública do push (gerada pelo agente)
  atualizado_em      timestamptz default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

-- Conectores externos (só admin/agente): ficam na configuração da integração
alter table public.integracao_config add column if not exists fusion        jsonb not null default '{}'::jsonb;
alter table public.integracao_config add column if not exists promotor_rede jsonb not null default '{}'::jsonb;
alter table public.app_config enable row level security;
drop policy if exists app_config_select on public.app_config;
create policy app_config_select on public.app_config for select to authenticated using (true);
drop policy if exists app_config_admin on public.app_config;
create policy app_config_admin on public.app_config for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2. LOCALIZAÇÃO DAS LOJAS
-- ------------------------------------------------------------
create table if not exists public.lojas_geo (
  codcli        integer primary key,
  lat           double precision not null,
  lng           double precision not null,
  raio_m        integer,
  origem        text not null default 'winthor' check (origem in ('winthor','aprendido','manual')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table public.lojas_geo enable row level security;
-- vê a coordenada quem vê o cliente (a subconsulta respeita o RLS de "clientes")
drop policy if exists lojas_geo_select on public.lojas_geo;
create policy lojas_geo_select on public.lojas_geo for select to authenticated
  using (public.is_admin() or exists (select 1 from public.clientes c where c.codcli = lojas_geo.codcli));
drop policy if exists lojas_geo_admin on public.lojas_geo;
create policy lojas_geo_admin on public.lojas_geo for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Vendedor/supervisor grava a localização de uma loja da sua carteira que ainda não tem coordenada
create or replace function public.app_salvar_local_loja(p_codcli integer, p_lat double precision, p_lng double precision)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_cli record; v_geo record;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  select * into v_cli from public.clientes where codcli = p_codcli limit 1;
  if v_cli is null or not public.app_pode_ver(v_cli.cod_vendedor, v_cli.cod_supervisor) then raise exception 'Cliente fora da sua carteira'; end if;
  select * into v_geo from public.lojas_geo where codcli = p_codcli;
  if v_geo is not null and v_geo.origem <> 'aprendido' and not public.is_admin() then
    return 'Esta loja já tem localização cadastrada no Winthor.';
  end if;
  insert into public.lojas_geo (codcli, lat, lng, origem, atualizado_em, atualizado_por)
  values (p_codcli, p_lat, p_lng, case when public.is_admin() then 'manual' else 'aprendido' end, now(), auth.uid())
  on conflict (codcli) do update set lat = excluded.lat, lng = excluded.lng, origem = excluded.origem,
    atualizado_em = now(), atualizado_por = auth.uid();
  return 'Localização salva.';
end;
$$;

-- ------------------------------------------------------------
-- 3. PRESENÇA (visita presencial detectada pelo app, sem check-in)
-- ------------------------------------------------------------
create table if not exists public.presencas (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  cod_vendedor   integer,
  cod_supervisor integer,
  codcli         integer not null,
  data           date not null,
  inicio         timestamptz not null,
  fim            timestamptz not null,
  duracao_seg    integer not null default 0,
  lat            double precision,
  lng            double precision,
  precisao_m     integer,
  distancia_m    integer,
  origem         text not null default 'app',
  unique (user_id, codcli, data)
);
create index if not exists presencas_vend_data_idx on public.presencas (cod_vendedor, data);
create index if not exists presencas_sup_data_idx  on public.presencas (cod_supervisor, data);
alter table public.presencas enable row level security;
drop policy if exists presencas_select on public.presencas;
create policy presencas_select on public.presencas for select to authenticated
  using (user_id = auth.uid() or public.app_pode_ver(cod_vendedor, cod_supervisor));

-- Registra/estende a presença do usuário logado numa loja (chamado pelo app a cada leitura de GPS).
-- Só conta como visita quando a permanência acumulada chega ao mínimo configurado (padrão 3 min).
create or replace function public.app_registrar_presenca(
  p_codcli integer, p_inicio timestamptz, p_fim timestamptz,
  p_lat double precision, p_lng double precision, p_precisao integer, p_distancia integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_prof record; v_cli record;
begin
  select * into v_prof from public.profiles where id = auth.uid();
  if v_prof is null then raise exception 'Não autenticado'; end if;
  select * into v_cli from public.clientes where codcli = p_codcli limit 1;
  if v_cli is null then raise exception 'Cliente não encontrado'; end if;
  if not public.app_pode_ver(v_cli.cod_vendedor, v_cli.cod_supervisor) then raise exception 'Cliente fora da sua carteira'; end if;
  if p_fim < p_inicio or p_fim > now() + interval '5 minutes' then raise exception 'Horário inválido'; end if;
  insert into public.presencas (user_id, cod_vendedor, cod_supervisor, codcli, data, inicio, fim, duracao_seg, lat, lng, precisao_m, distancia_m)
  values (auth.uid(),
          -- só a visita do próprio vendedor conta no desempenho dele (supervisor/admin ficam registrados sem vendedor)
          case when v_prof.role = 'vendedor' then v_prof.cod_vendedor end,
          coalesce(v_prof.cod_supervisor, v_cli.cod_supervisor),
          p_codcli, (p_inicio at time zone 'America/Recife')::date, p_inicio, p_fim,
          extract(epoch from (p_fim - p_inicio))::integer, p_lat, p_lng, p_precisao, p_distancia)
  on conflict (user_id, codcli, data) do update
     set inicio = least(presencas.inicio, excluded.inicio),
         fim = greatest(presencas.fim, excluded.fim),
         duracao_seg = presencas.duracao_seg + greatest(0, extract(epoch from (excluded.fim - greatest(presencas.fim, excluded.inicio)))::integer),
         lat = excluded.lat, lng = excluded.lng, precisao_m = excluded.precisao_m, distancia_m = excluded.distancia_m;
end;
$$;

-- ------------------------------------------------------------
-- 4. PEDIDOS DO MÊS (Winthor) — positivação e faturamento do dia/mês
-- ------------------------------------------------------------
create table if not exists public.pedidos_mes (
  id             bigserial primary key,
  numped         bigint not null,
  data           date not null,
  hora           text,
  codcli         integer not null,
  cliente        text,
  fantasia       text,
  cod_vendedor   integer,
  vendedor       text,
  cod_supervisor integer,
  supervisor     text,
  valor          numeric,
  valor_faturado numeric,
  posicao        text,          -- L liberado, M montado, F faturado, B bloqueado, P pendente
  origem         text,
  itens          integer
);
create index if not exists pedidos_mes_vend_idx on public.pedidos_mes (cod_vendedor, data);
create index if not exists pedidos_mes_sup_idx  on public.pedidos_mes (cod_supervisor, data);
create index if not exists pedidos_mes_cli_idx  on public.pedidos_mes (codcli);
alter table public.pedidos_mes enable row level security;
drop policy if exists pedidos_mes_select on public.pedidos_mes;
create policy pedidos_mes_select on public.pedidos_mes for select to authenticated using (public.app_pode_ver(cod_vendedor, cod_supervisor));
drop policy if exists pedidos_mes_admin on public.pedidos_mes;
create policy pedidos_mes_admin on public.pedidos_mes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 5. METAS DO VENDEDOR (Winthor). Sem linha aqui, o app usa a meta calculada (ano passado + %).
-- ------------------------------------------------------------
create table if not exists public.metas_vendedor (
  cod_vendedor     integer not null,
  mes              date not null,
  cod_supervisor   integer,
  meta_valor       numeric,
  meta_positivacao integer,
  meta_visitas     integer,
  meta_mix         integer,
  primary key (cod_vendedor, mes)
);
alter table public.metas_vendedor enable row level security;
drop policy if exists metas_vendedor_select on public.metas_vendedor;
create policy metas_vendedor_select on public.metas_vendedor for select to authenticated using (public.app_pode_ver(cod_vendedor, cod_supervisor));
drop policy if exists metas_vendedor_admin on public.metas_vendedor;
create policy metas_vendedor_admin on public.metas_vendedor for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 6. ENTREGAS (Fusion)
-- ------------------------------------------------------------
create table if not exists public.entregas (
  chave          text primary key,          -- identificador único na origem (nota/pedido/entrega)
  numped         bigint,
  numnota        bigint,
  codcli         integer,
  cliente        text,
  cod_vendedor   integer,
  cod_supervisor integer,
  status         text not null default 'pendente'
                 check (status in ('pendente','em_rota','entregue','nao_entregue','ocorrencia','devolvida')),
  ocorrencia     text,
  motorista      text,
  veiculo        text,
  carga          text,
  valor          numeric,
  previsao       timestamptz,
  saida_em       timestamptz,
  entregue_em    timestamptz,
  lat            double precision,
  lng            double precision,
  comprovante    text,                      -- link da foto/canhoto, se houver
  data_ref       date not null default current_date,
  atualizado_em  timestamptz not null default now()
);
create index if not exists entregas_vend_idx on public.entregas (cod_vendedor, data_ref);
create index if not exists entregas_sup_idx  on public.entregas (cod_supervisor, data_ref);
alter table public.entregas enable row level security;
drop policy if exists entregas_select on public.entregas;
create policy entregas_select on public.entregas for select to authenticated using (public.app_pode_ver(cod_vendedor, cod_supervisor));
drop policy if exists entregas_admin on public.entregas;
create policy entregas_admin on public.entregas for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 7. VISITAS DO PROMOTOR (Promotor na Rede): status, horários, fotos e contagem
-- ------------------------------------------------------------
create table if not exists public.promotor_visitas (
  chave          text primary key,          -- id da visita na origem
  data           date not null,
  codcli         integer,
  cliente        text,
  cod_promotor   integer,
  promotor       text,
  cod_vendedor   integer,
  cod_supervisor integer,
  status         text not null default 'pendente'
                 check (status in ('pendente','em_andamento','concluida','nao_realizada','justificada')),
  checkin        timestamptz,
  checkout       timestamptz,
  justificativa  text,
  link_fotos     text,
  fotos          jsonb not null default '[]'::jsonb,      -- ["https://…jpg", …]
  contagem       jsonb not null default '[]'::jsonb,      -- [{codprod, descricao, qtd, validade}]
  obs            text,
  atualizado_em  timestamptz not null default now()
);
create index if not exists promotor_visitas_vend_idx on public.promotor_visitas (cod_vendedor, data);
create index if not exists promotor_visitas_sup_idx  on public.promotor_visitas (cod_supervisor, data);
alter table public.promotor_visitas enable row level security;
drop policy if exists promotor_visitas_select on public.promotor_visitas;
create policy promotor_visitas_select on public.promotor_visitas for select to authenticated using (public.app_pode_ver(cod_vendedor, cod_supervisor));
drop policy if exists promotor_visitas_admin on public.promotor_visitas;
create policy promotor_visitas_admin on public.promotor_visitas for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 8. NOTIFICAÇÕES (feed do app) e ASSINATURAS DE PUSH
-- ------------------------------------------------------------
create table if not exists public.notificacoes (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tipo       text not null,             -- entrega | promotor | estoque | meta | resumo
  titulo     text not null,
  corpo      text,
  link       text,
  chave      text,                      -- evita duplicar o mesmo aviso
  criado_em  timestamptz not null default now(),
  lida_em    timestamptz,
  unique (user_id, chave)
);
create index if not exists notificacoes_user_idx on public.notificacoes (user_id, criado_em desc);
alter table public.notificacoes enable row level security;
drop policy if exists notificacoes_select on public.notificacoes;
create policy notificacoes_select on public.notificacoes for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists notificacoes_update on public.notificacoes;
create policy notificacoes_update on public.notificacoes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notificacoes_admin on public.notificacoes;
create policy notificacoes_admin on public.notificacoes for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  plataforma text,
  criado_em  timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists push_subs_own on public.push_subs;
create policy push_subs_own on public.push_subs for all to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

-- Registro de uso: novo tipo "app"
alter table public.acessos drop constraint if exists acessos_tipo_check;
alter table public.acessos add constraint acessos_tipo_check check (tipo in ('acesso','consulta','roteiro','clientes','metas','app'));

-- Limpeza (chamada pelo agente): presença e notificações com mais de 120 dias
create or replace function public.app_limpar_antigos()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  delete from public.presencas where data < current_date - 120;
  delete from public.notificacoes where criado_em < now() - interval '60 days';
  delete from public.entregas where data_ref < current_date - 60;
  delete from public.promotor_visitas where data < current_date - 120;
end;
$$;

-- Limpa uma tabela do app antes de nova carga do agente (lista fechada de tabelas)
create or replace function public.app_admin_limpar(p_tabela text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if p_tabela = 'pedidos_mes' then truncate table public.pedidos_mes restart identity;
  elsif p_tabela = 'metas_vendedor' then delete from public.metas_vendedor where mes >= date_trunc('month', current_date) - interval '1 month';
  elsif p_tabela = 'lojas_geo_winthor' then delete from public.lojas_geo where origem = 'winthor';
  else raise exception 'Tabela não permitida: %', p_tabela;
  end if;
end;
$$;
