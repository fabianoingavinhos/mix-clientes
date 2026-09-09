-- ============================================================
--  MIX CLIENTES — Alerta de volume de consultas (admin → Uso)
--  Acrescenta "consultas na última hora" ao resumo de uso.
--  Cole no SQL Editor do Supabase e execute (idempotente).
-- ============================================================

drop function if exists public.admin_uso();

create or replace function public.admin_uso()
returns table (
  id uuid, login text, nome text, role text, cod_vendedor integer, cod_supervisor integer,
  ultimo_login timestamptz, ultimo_acesso timestamptz,
  acessos_30d bigint, consultas_30d bigint, consultas_hoje bigint, clientes_30d bigint, consultas_total bigint,
  consultas_1h bigint, clientes_1h bigint
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
         (select count(*) from public.acessos a where a.user_id = p.id and a.tipo = 'consulta'),
         (select count(*) from public.acessos a where a.user_id = p.id and a.tipo = 'consulta' and a.criado_em >= now() - interval '1 hour'),
         (select count(distinct a.codcli) from public.acessos a where a.user_id = p.id and a.tipo = 'consulta' and a.criado_em >= now() - interval '1 hour')
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_admin()
  order by coalesce((select max(a.criado_em) from public.acessos a where a.user_id = p.id), u.last_sign_in_at) desc nulls last, p.nome;
$$;
