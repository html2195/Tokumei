create schema tokumei_auth;
revoke all on schema tokumei_auth from public, anon, authenticated;
grant usage on schema tokumei_auth to service_role;

create table tokumei_auth.accounts (
  id uuid primary key default gen_random_uuid(),
  login text not null unique check (login ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  salt text not null check (salt ~ '^[0-9a-f]{32}$'),
  password_hash text not null check (password_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table tokumei_auth.sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references tokumei_auth.accounts(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table tokumei_auth.rate_limits (
  key text primary key,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);

create index on tokumei_auth.sessions (account_id);
create index on tokumei_auth.sessions (expires_at);
create index on tokumei_auth.rate_limits (expires_at);

alter table tokumei_auth.accounts enable row level security;
alter table tokumei_auth.sessions enable row level security;
alter table tokumei_auth.rate_limits enable row level security;
grant select, insert on tokumei_auth.accounts to service_role;
grant select, insert, delete on tokumei_auth.sessions to service_role;
grant select, insert, update, delete on tokumei_auth.rate_limits to service_role;

create function public.tokumei_auth_limit(p_key text, p_max integer, p_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_attempts integer;
begin
  delete from tokumei_auth.rate_limits where expires_at <= statement_timestamp();
  insert into tokumei_auth.rate_limits as limits (key, attempts, expires_at)
  values (p_key, 1, statement_timestamp() + make_interval(secs => p_seconds))
  on conflict (key) do update set
    attempts = case when limits.expires_at <= statement_timestamp() then 1
      else least(limits.attempts + 1, p_max + 1) end,
    expires_at = case when limits.expires_at <= statement_timestamp() then excluded.expires_at
      else limits.expires_at end
  returning attempts into current_attempts;
  return current_attempts <= p_max;
end;
$$;

create function public.tokumei_auth_register(p_login text, p_salt text, p_hash text, p_token_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into tokumei_auth.accounts (login, salt, password_hash)
  values (p_login, p_salt, p_hash)
  on conflict (login) do nothing
  returning id into new_id;
  if new_id is null then
    return null;
  end if;
  delete from tokumei_auth.sessions where expires_at <= statement_timestamp();
  insert into tokumei_auth.sessions (account_id, token_hash) values (new_id, p_token_hash);
  return jsonb_build_object('id', new_id, 'login', p_login);
end;
$$;

create function public.tokumei_auth_credentials(p_login text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('id', id, 'login', login, 'salt', salt, 'password_hash', password_hash)
  from tokumei_auth.accounts
  where login = p_login;
$$;

create function public.tokumei_auth_start_session(p_id uuid, p_token_hash text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from tokumei_auth.sessions where expires_at <= statement_timestamp();
  insert into tokumei_auth.sessions (account_id, token_hash) values (p_id, p_token_hash);
end;
$$;

create function public.tokumei_auth_session(p_token_hash text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('id', accounts.id, 'login', accounts.login)
  from tokumei_auth.sessions
  join tokumei_auth.accounts on accounts.id = sessions.account_id
  where sessions.token_hash = p_token_hash and sessions.expires_at > statement_timestamp();
$$;

create function public.tokumei_auth_end_session(p_token_hash text)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from tokumei_auth.sessions where token_hash = p_token_hash;
$$;

revoke all on function
  public.tokumei_auth_limit(text, integer, integer),
  public.tokumei_auth_register(text, text, text, text),
  public.tokumei_auth_credentials(text),
  public.tokumei_auth_start_session(uuid, text),
  public.tokumei_auth_session(text),
  public.tokumei_auth_end_session(text)
from public, anon, authenticated;

grant execute on function
  public.tokumei_auth_limit(text, integer, integer),
  public.tokumei_auth_register(text, text, text, text),
  public.tokumei_auth_credentials(text),
  public.tokumei_auth_start_session(uuid, text),
  public.tokumei_auth_session(text),
  public.tokumei_auth_end_session(text)
to service_role;

notify pgrst, 'reload schema';
