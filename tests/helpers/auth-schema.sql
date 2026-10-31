-- TEST ONLY: the minimal Supabase Auth DB contract. This is NOT GoTrue or JWT verification.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key, email text unique, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'
);
create table auth.sessions (
  id uuid primary key, user_id uuid not null references auth.users(id), not_after timestamptz,
  created_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
