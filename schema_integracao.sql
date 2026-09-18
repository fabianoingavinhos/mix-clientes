-- ============================================================
--  MIX CLIENTES — Integração automática com o Winthor (Oracle)
--  Cole este arquivo inteiro no SQL Editor do Supabase e execute.
--  Pode ser executado mais de uma vez (idempotente).
--  Pré-requisito: schema.sql já executado (profiles, is_admin, ...).
--
--  Como funciona:
--    Um agente instalado num PC da empresa (pasta winthor-sync) conecta no Oracle
--    do Winthor, roda os SELECTs das rotinas e grava nas mesmas tabelas que hoje
--    recebem as planilhas (mix, roteiro, roteiro_vendedor, clientes, vendas).
--    O admin configura tudo na aba "Integração Winthor" do painel.
--    A senha do Oracle é criptografada NO NAVEGADOR com a chave pública do agente:
--    só o agente (que guarda a chave privada no PC) consegue abri-la.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CONFIGURAÇÃO (uma linha)
-- ------------------------------------------------------------
create table if not exists public.integracao_config (
  id              integer primary key default 1 check (id = 1),
  ativo           boolean not null default true,
  host            text,
  porta           integer default 1521,
  servico         text,                    -- service name ou SID
  usar_sid        boolean not null default false,
  usuario         text,
  senha_cifrada   text,                    -- RSA-OAEP (chave pública do agente), base64
  modo            text not null default 'thin' check (modo in ('thin','thick')),
  instant_client  text,                    -- pasta do Oracle Instant Client (modo thick)
  rotinas         jsonb not null default '{}'::jsonb,  -- parâmetros por rotina (supervisores, filial, meses, ativo)
  intervalo_min   integer not null default 60,         -- 0 = somente manual
  hora_inicio     integer not null default 6,
  hora_fim        integer not null default 20,
  atualizado_em   timestamptz default now(),
  atualizado_por  uuid
);
insert into public.integracao_config (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 2. AGENTE (uma linha): chave pública e sinal de vida
-- ------------------------------------------------------------
create table if not exists public.integracao_agente (
  id             integer primary key default 1 check (id = 1),
  chave_publica  text,         -- SPKI em base64 (RSA 2048)
  computador     text,
  versao         text,
  ultimo_sinal   timestamptz,
  oracle_ok      boolean,
  mensagem       text
);
insert into public.integracao_agente (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3. COMANDOS (fila: "testar conexão", "sincronizar agora")
-- ------------------------------------------------------------
create table if not exists public.integracao_comandos (
  id            bigserial primary key,
  tipo          text not null check (tipo in ('testar','sincronizar')),
  rotina        text,                     -- null = todas
  status        text not null default 'pendente' check (status in ('pendente','executando','ok','erro')),
  resultado     text,
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  iniciado_em   timestamptz,
  concluido_em  timestamptz
);
create index if not exists integracao_comandos_status_idx on public.integracao_comandos (status, criado_em);

-- ------------------------------------------------------------
-- 4. HISTÓRICO DAS SINCRONIZAÇÕES
-- ------------------------------------------------------------
create table if not exists public.integracao_log (
  id         bigserial primary key,
  rotina     text not null,
  inicio     timestamptz not null default now(),
  fim        timestamptz,
  status     text not null default 'executando' check (status in ('executando','ok','erro')),
  linhas     integer,
  mensagem   text,
  origem     text             -- 'agendado' | 'manual'
);
create index if not exists integracao_log_rotina_idx on public.integracao_log (rotina, inicio desc);

-- ------------------------------------------------------------
-- 5. PERMISSÕES: tudo restrito ao administrador
--    (o agente entra com um usuário de perfil admin, ex.: "integracao")
-- ------------------------------------------------------------
alter table public.integracao_config   enable row level security;
alter table public.integracao_agente   enable row level security;
alter table public.integracao_comandos enable row level security;
alter table public.integracao_log      enable row level security;

drop policy if exists integracao_config_admin on public.integracao_config;
create policy integracao_config_admin on public.integracao_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists integracao_agente_admin on public.integracao_agente;
create policy integracao_agente_admin on public.integracao_agente for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists integracao_comandos_admin on public.integracao_comandos;
create policy integracao_comandos_admin on public.integracao_comandos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists integracao_log_admin on public.integracao_log;
create policy integracao_log_admin on public.integracao_log for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Limpa histórico antigo (chamado pelo agente): mantém 90 dias
create or replace function public.integracao_limpar_historico()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  delete from public.integracao_log where inicio < now() - interval '90 days';
  delete from public.integracao_comandos where criado_em < now() - interval '30 days';
end;
$$;

-- ------------------------------------------------------------
-- 6. USUÁRIO DO AGENTE
--    Crie pelo painel: Administração → Usuários → novo usuário
--    login "integracao", perfil Administrador, senha forte.
--    Use esse login/senha na primeira execução do agente no PC.
-- ------------------------------------------------------------
