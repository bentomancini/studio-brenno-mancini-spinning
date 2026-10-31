-- Operator migration for Supabase.
begin;

revoke create on schema public from public, anon, authenticated;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated, service_role;

alter default privileges in schema app_private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

create table if not exists app_private.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (length(full_name) between 1 and 120),
  phone text check (length(phone) <= 32),
  active boolean not null default true,
  auth_revoked_before timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists app_private.user_roles (
  user_id uuid primary key references app_private.profiles(id),
  role text not null check (role in ('student','admin'))
);
create table if not exists app_private.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references app_private.profiles(id),
  invited_user_id uuid unique references app_private.profiles(id),
  full_name text not null check (length(full_name) between 1 and 120),
  contact_email text check (length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text check (length(phone) <= 32),
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is null or invited_user_id is null)
);
create index if not exists students_name_idx on app_private.students (full_name, id);
create table if not exists app_private.session_guards (
  session_id uuid primary key,
  user_id uuid not null references app_private.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists session_guards_user_idx on app_private.session_guards(user_id);
create table if not exists app_private.recovery_grants (
  session_id uuid primary key references app_private.session_guards(session_id),
  user_id uuid not null references app_private.profiles(id),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table if not exists app_private.instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  bio text check (length(bio) <= 2000),
  archived_at timestamptz,
  version bigint not null default 1
);
create table if not exists app_private.bikes (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (length(label) between 1 and 40),
  archived_at timestamptz,
  version bigint not null default 1
);
create table if not exists app_private.class_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 160),
  instructor_id uuid not null references app_private.instructors(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  status text not null default 'draft' check (status in ('draft','published','cancelled','completed')),
  capacity integer not null check (capacity between 1 and 10000),
  bike_mode text not null check (bike_mode in ('none','required')),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and isfinite(starts_at) and isfinite(ends_at))
);
create index if not exists sessions_agenda_idx on app_private.class_sessions(starts_at, id);
create index if not exists sessions_instructor_idx on app_private.class_sessions(instructor_id, starts_at);
create table if not exists app_private.session_bikes (
  session_id uuid not null references app_private.class_sessions(id),
  bike_id uuid not null references app_private.bikes(id),
  primary key (session_id, bike_id)
);
create index if not exists session_bikes_bike_idx on app_private.session_bikes(bike_id, session_id);
create table if not exists app_private.reservations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references app_private.class_sessions(id),
  student_id uuid not null references app_private.students(id),
  bike_id uuid,
  status text not null check (status in ('confirmed','cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references app_private.profiles(id),
  version bigint not null default 1,
  check ((status = 'confirmed' and cancelled_at is null) or (status = 'cancelled' and cancelled_at is not null)),
  foreign key (session_id, bike_id) references app_private.session_bikes(session_id, bike_id)
);
create unique index if not exists reservation_active_student_uq on app_private.reservations(session_id, student_id) where status = 'confirmed';
create unique index if not exists reservation_active_bike_uq on app_private.reservations(session_id, bike_id) where status = 'confirmed' and bike_id is not null;
create index if not exists reservations_student_history_idx on app_private.reservations(student_id, created_at desc, id);
create index if not exists reservations_session_idx on app_private.reservations(session_id, status);
create table if not exists app_private.attendance (
  reservation_id uuid primary key references app_private.reservations(id),
  status text not null check (status in ('present','absent')),
  marked_by uuid not null references app_private.profiles(id),
  marked_at timestamptz not null default now()
);
create table if not exists app_private.idempotency_operations (
  actor_id uuid not null references app_private.profiles(id),
  key text not null check (length(key) between 8 and 128 and key ~ '^[A-Za-z0-9_-]+$'),
  request jsonb not null,
  outcome text check (outcome in ('applied','rejected')),
  result jsonb,
  resource_id uuid references app_private.reservations(id),
  created_at timestamptz not null default now(),
  primary key (actor_id, key)
);
create table if not exists app_private.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references app_private.profiles(id),
  action text not null,
  resource_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_resource_idx on app_private.audit_events(resource_id, created_at);
create table if not exists app_private.settings (
  singleton boolean primary key default true check (singleton),
  policies jsonb not null default '{"bookingWindow":{"mode":"unconfigured"},"cancellation":{"mode":"unconfigured"},"eligibility":{"mode":"unconfigured"},"adminOnBehalf":{"mode":"unconfigured"}}',
  version bigint not null default 1
);
insert into app_private.settings(singleton) values (true) on conflict do nothing;
create table if not exists app_private.rate_limits (
  bucket text primary key,
  window_at timestamptz not null,
  hits integer not null
);
create index if not exists rate_limits_window_idx on app_private.rate_limits(window_at);

create or replace function app_private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := case when lower(new.email) = 'bentomancini@gmail.com' then 'admin' else 'student' end;
begin
  insert into app_private.profiles(id, full_name)
  values (new.id, coalesce(nullif(left(trim(new.raw_user_meta_data->>'full_name'),120),''), case when v_role = 'admin' then 'Bento Mancini' else 'Aluno' end))
  on conflict (id) do nothing;
  insert into app_private.user_roles(user_id, role) values (new.id, v_role)
  on conflict (user_id) do update set role = v_role;
  return new;
end $$;

drop trigger if exists studio_auth_user_created on auth.users;
create trigger studio_auth_user_created after insert on auth.users
for each row execute function app_private.on_auth_user_created();

insert into app_private.profiles(id,full_name)
select id, 'Aluno' from auth.users on conflict do nothing;
insert into app_private.user_roles(user_id,role)
select id,'student' from app_private.profiles on conflict do nothing;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'app_private' loop
    execute format('alter table app_private.%I enable row level security', t.tablename);
  end loop;
end $$;
revoke all on all tables in schema app_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema app_private from public, anon, authenticated, service_role;
revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
commit;