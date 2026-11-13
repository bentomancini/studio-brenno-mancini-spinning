begin;

-- A finite, materialized weekly series. Its operation row is also the durable
-- idempotency record; a failed transaction leaves neither a row nor occurrences.
create table if not exists app_private.session_series (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references app_private.profiles(id),
  operation_key text not null check (length(operation_key) between 8 and 128 and operation_key ~ '^[A-Za-z0-9_-]+$'),
  request jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (actor_id, operation_key)
);
alter table app_private.session_series enable row level security;
revoke all on app_private.session_series from public, anon, authenticated, service_role;
alter table app_private.class_sessions add column if not exists series_id uuid references app_private.session_series(id);
create index if not exists class_sessions_series_idx on app_private.class_sessions(series_id, starts_at, id) where series_id is not null;

-- PostgreSQL's AT TIME ZONE alone silently resolves gaps and folds. Enumerate
-- the offsets around the date and accept exactly ONE round-tripping UTC instant.
-- Hourly sampling also handles historical offsets with seconds, non-hour DST
-- changes and date-line jumps; it is independent of the database session TZ.
create or replace function app_private.unambiguous_local_instant(p_local timestamp, p_zone text) returns timestamptz
language plpgsql set search_path = '' as $$
declare base timestamptz := p_local at time zone p_zone;
  sample timestamptz; delta interval; candidate timestamptz;
  seen interval[] := '{}'; matches integer := 0; answer timestamptz;
  hour_offset integer;
begin
  for hour_offset in -48..48 loop
    sample := base + make_interval(hours => hour_offset);
    delta := (sample at time zone p_zone) - (sample at time zone 'UTC');
    if delta = any(seen) then continue; end if;
    seen := array_append(seen, delta);
    candidate := (p_local - delta) at time zone 'UTC';
    if candidate at time zone p_zone = p_local then
      matches := matches + 1;
      answer := candidate;
    end if;
  end loop;
  if matches <> 1 then raise exception using errcode='PT422', message='AMBIGUOUS_LOCAL_TIME'; end if;
  return answer;
end $$;

create or replace function public.studio_create_session_series(p_body jsonb, p_key text, p_expected_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.actor(); op app_private.session_series;
  start_day date; end_day date; until_day date; day date; end_offset integer;
  local_start timestamp; local_end timestamp; instant_start timestamptz; instant_end timestamptz;
  first_id uuid; first_start timestamptz; last_start timestamptz; count_created integer := 0;
  created jsonb; output jsonb; i integer;
begin
  perform app_private.require_expected_actor(p_expected_actor,u);
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='PT503',message='ISOLATION_LEVEL_UNSUPPORTED'; end if;
  perform app_private.admin_actor();
  if p_key is null or length(p_key) not between 8 and 128 or p_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode='PT422',message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform app_private.keys(p_body,
    array['title','instructorId','startDate','startTime','endDate','endTime','untilDate','timezone','capacity','bikeMode','bikeIds','status'],
    array['title','instructorId','startDate','startTime','endDate','endTime','untilDate','timezone','capacity','bikeMode','bikeIds','status']);
  if jsonb_typeof(p_body->'title') <> 'string' or length(btrim(p_body->>'title')) not between 1 and 160
    or jsonb_typeof(p_body->'instructorId') <> 'string'
    or jsonb_typeof(p_body->'timezone') <> 'string'
    or length(p_body->>'timezone') not between 1 and 80
    or jsonb_typeof(p_body->'bikeMode') <> 'string' or p_body->>'bikeMode' not in ('none','required')
    or jsonb_typeof(p_body->'status') <> 'string' or p_body->>'status' not in ('draft','published')
    or jsonb_typeof(p_body->'capacity') <> 'number' or (p_body->>'capacity')::numeric <> trunc((p_body->>'capacity')::numeric)
    or (p_body->>'capacity')::numeric not between 1 and 10000
    or jsonb_typeof(p_body->'bikeIds') <> 'array' or jsonb_array_length(p_body->'bikeIds') > 10000 then
    raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_body->>'timezone') then
    raise exception using errcode='PT422',message='INVALID_TIMEZONE'; end if;
  for i in 1..3 loop
    if (p_body->>(array['startDate','endDate','untilDate'])[i]) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  end loop;
  if (p_body->>'startTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or (p_body->>'endTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  start_day := (p_body->>'startDate')::date;
  end_day := (p_body->>'endDate')::date;
  until_day := (p_body->>'untilDate')::date;
  if to_char(start_day,'YYYY-MM-DD') <> p_body->>'startDate'
    or to_char(end_day,'YYYY-MM-DD') <> p_body->>'endDate'
    or to_char(until_day,'YYYY-MM-DD') <> p_body->>'untilDate'
    or end_day < start_day or until_day < start_day
    or (until_day - start_day) / 7 + 1 > 52 then
    raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  end_offset := end_day - start_day;

  -- Serialized by the actor/key unique row; a competing identical POST waits
  -- for this transaction and returns its original result. No partial commit.
  insert into app_private.session_series(actor_id,operation_key,request) values(u,p_key,p_body)
    on conflict (actor_id,operation_key) do nothing;
  select * into op from app_private.session_series where actor_id=u and operation_key=p_key for update;
  if op.request <> p_body then raise exception using errcode='PT409',message='IDEMPOTENCY_CONFLICT'; end if;
  if op.result is not null then return op.result; end if;

  -- Acquire the same schedule advisory lock used by single-session commands.
  -- Each nested studio_command performs ALL existing publication, inventory,
  -- capacity, actor, policy and audit checks inside this ONE RPC transaction.
  perform pg_advisory_xact_lock(70123);
  day := start_day;
  while day <= until_day loop
    local_start := day::timestamp + (p_body->>'startTime')::time;
    local_end := (day + end_offset)::timestamp + (p_body->>'endTime')::time;
    instant_start := app_private.unambiguous_local_instant(local_start,p_body->>'timezone');
    instant_end := app_private.unambiguous_local_instant(local_end,p_body->>'timezone');
    if instant_end <= instant_start then
      raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
    created := public.studio_command('admin.sessions.create',null,
      jsonb_build_object('title',p_body->>'title','instructorId',p_body->>'instructorId',
        'startsAt',instant_start,'endsAt',instant_end,'timezone',p_body->>'timezone',
        'capacity',p_body->'capacity','bikeMode',p_body->>'bikeMode',
        'bikeIds',p_body->'bikeIds','status',p_body->>'status'),null,null,p_expected_actor);
    update app_private.class_sessions set series_id=op.id where id=(created->>'id')::uuid;
    if count_created=0 then first_id := (created->>'id')::uuid; first_start := instant_start; end if;
    count_created := count_created + 1;
    last_start := instant_start;
    day := day + 7;
  end loop;
  output := jsonb_build_object('id',first_id,'occurrenceCount',count_created,
    'firstStartsAt',first_start,'lastStartsAt',last_start);
  update app_private.session_series set result=output where id=op.id;
  perform app_private.audit(u,'admin.session_series.create',op.id,jsonb_build_object('firstSessionId',first_id,'occurrenceCount',count_created));
  return output;
end $$;

revoke all on function app_private.unambiguous_local_instant(timestamp,text) from public, anon, authenticated, service_role;
revoke all on function public.studio_create_session_series(jsonb,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.studio_create_session_series(jsonb,text,uuid) to authenticated;
commit;
