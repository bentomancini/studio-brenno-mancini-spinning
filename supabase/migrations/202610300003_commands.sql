begin;

create function app_private.keys(p_body jsonb,p_allowed text[],p_required text[] default '{}') returns void
language plpgsql set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p_body) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_body) j(key) where not j.key=any(p_allowed))
    or not p_body ?& p_required then
    raise exception using errcode='PT422',message='INVALID_INPUT';
  end if;
  for k,v in select key,value from jsonb_each(p_body) loop
    if k=any(array['fullName','phone','contactEmail','name','bio','label','title','instructorId','startsAt','endsAt','timezone','bikeMode','status','sessionId','studentId','bikeId']) then
      if jsonb_typeof(v)<>'string' and not (v='null'::jsonb and k=any(array['phone','contactEmail','bio'])) then
        raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
      if k=any(array['fullName','name','title','label']) and length(btrim(p_body->>k))=0 then
        raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
      if k=any(array['startsAt','endsAt']) and (p_body->>k) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
    elsif k='capacity' and jsonb_typeof(v)<>'number' then
      raise exception using errcode='PT422',message='INVALID_INPUT';
    elsif k='restore' and v is distinct from 'true'::jsonb then
      raise exception using errcode='PT422',message='INVALID_INPUT';
    end if;
  end loop;
end $$;

create function app_private.validate_policies(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare k text; v jsonb; mode text;
begin
  perform app_private.keys(p,array['bookingWindow','cancellation','eligibility','adminOnBehalf'],array['bookingWindow','cancellation','eligibility','adminOnBehalf']);
  foreach k in array array['bookingWindow','cancellation','eligibility','adminOnBehalf'] loop
    v:=p->k; mode:=v->>'mode';
    if mode not in ('unconfigured','unrestricted','restricted') or mode is null then
      raise exception using errcode='PT422',message='INVALID_POLICY'; end if;
    if mode in ('unconfigured','unrestricted') then perform app_private.keys(v,array['mode'],array['mode']);
    elsif k='bookingWindow' then
      perform app_private.keys(v,array['mode','minNoticeMinutes','maxAdvanceMinutes'],array['mode','minNoticeMinutes','maxAdvanceMinutes']);
      if jsonb_typeof(v->'minNoticeMinutes')<>'number' or jsonb_typeof(v->'maxAdvanceMinutes')<>'number'
        or (v->>'minNoticeMinutes')::integer not between 0 and 5256000
        or (v->>'maxAdvanceMinutes')::integer not between (v->>'minNoticeMinutes')::integer and 5256000 then
        raise exception using errcode='PT422',message='INVALID_POLICY'; end if;
    elsif k='cancellation' then
      perform app_private.keys(v,array['mode','minNoticeMinutes'],array['mode','minNoticeMinutes']);
      if jsonb_typeof(v->'minNoticeMinutes')<>'number' or (v->>'minNoticeMinutes')::integer not between 0 and 5256000 then
        raise exception using errcode='PT422',message='INVALID_POLICY'; end if;
    elsif k='eligibility' then
      perform app_private.keys(v,array['mode','maxActiveReservations'],array['mode','maxActiveReservations']);
      if jsonb_typeof(v->'maxActiveReservations')<>'number' or (v->>'maxActiveReservations')::integer not between 1 and 10000 then
        raise exception using errcode='PT422',message='INVALID_POLICY'; end if;
    else
      -- The only currently implemented restriction is denying on-behalf actions.
      perform app_private.keys(v,array['mode','allowed'],array['mode','allowed']);
      if v->'allowed' is distinct from 'false'::jsonb then raise exception using errcode='PT422',message='INVALID_POLICY'; end if;
    end if;
  end loop;
end $$;

create function app_private.booking_command(p_action text,p_id uuid,p_body jsonb,p_key text,p_actor uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare op app_private.idempotency_operations; req jsonb; st uuid; sid uuid; rid uuid; bid uuid;
  c app_private.class_sessions; r app_private.reservations; reason text; v_outcome text := 'applied'; res jsonb;
  behalf boolean := p_action like 'admin.%'; cancel boolean := p_action in ('cancel','admin.cancel');
begin
  if p_key is null or length(p_key) not between 8 and 128 or p_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode='PT422',message='IDEMPOTENCY_KEY_REQUIRED'; end if;
  if cancel then perform app_private.keys(p_body,'{}');
  elsif behalf then perform app_private.keys(p_body,array['sessionId','bikeId','studentId'],array['sessionId','studentId']);
  else perform app_private.keys(p_body,array['sessionId','bikeId'],array['sessionId']); end if;
  if behalf and not app_private.is_admin(p_actor) then raise exception using errcode='PT403',message='FORBIDDEN'; end if;
  req:=jsonb_build_object('action',p_action,'id',p_id,'body',p_body);
  insert into app_private.idempotency_operations(actor_id,key,request) values(p_actor,p_key,req) on conflict do nothing;
  select * into op from app_private.idempotency_operations where actor_id=p_actor and key=p_key for update;
  if op.request<>req then raise exception using errcode='PT409',message='IDEMPOTENCY_CONFLICT'; end if;
  if op.outcome is not null then
    return op.result || jsonb_build_object('replayed',true,'currentResource',app_private.reservation_dto(op.resource_id));
  end if;
  if cancel then
    select * into r from app_private.reservations where id=p_id;
    if not found then reason:='NOT_FOUND';
    elsif not behalf and not exists(select 1 from app_private.students where id=r.student_id and user_id=p_actor) then reason:='NOT_FOUND';
    else st:=r.student_id; sid:=r.session_id; rid:=r.id; end if;
  else
    sid:=(p_body->>'sessionId')::uuid; bid:=(p_body->>'bikeId')::uuid;
    if behalf then st:=(p_body->>'studentId')::uuid;
    else select id into st from app_private.students where user_id=p_actor; end if;
  end if;
  if reason is null and behalf and not exists(select 1 from app_private.settings where policies->'adminOnBehalf'->>'mode'='unrestricted') then reason:='ADMIN_ON_BEHALF_UNCONFIGURED_OR_DENIED'; end if;
  if reason is null then
    -- Global protocol: idempotency row -> student row -> session row -> reservation.
    -- Student lock also serializes the configurable cross-session reservation limit.
    -- Only an authorized admin cancellation may resolve an archived student's reservation.
    -- Keep the student lock and all on-behalf/policy/window checks; never allow new bookings.
    perform 1 from app_private.students where id=st and (archived_at is null or p_action='admin.cancel') for update;
    if not found then reason:='STUDENT_INACTIVE'; end if;
  end if;
  if reason is null then
    select * into c from app_private.class_sessions where id=sid for update;
    if not found then reason:='NOT_FOUND'; end if;
  end if;
  if reason is null then
    -- READ COMMITTED: this is a NEW SQL statement after acquiring the session lock.
    -- Never combine the lock and count in a single snapshot/CTE.
    if cancel then
      select * into r from app_private.reservations where id=rid for update;
      if r.status<>'cancelled' then reason:=app_private.booking_reason(sid,st,true); end if;
    else reason:=app_private.booking_reason(sid,st,false); end if;
  end if;
  if reason is null and not cancel then
    if c.bike_mode='none' and bid is not null then reason:='BIKE_NOT_ALLOWED';
    elsif c.bike_mode='required' and bid is null then reason:='BIKE_REQUIRED';
    elsif bid is not null and not exists(select 1 from app_private.session_bikes where session_id=sid and bike_id=bid) then reason:='BIKE_NOT_IN_SESSION';
    elsif bid is not null and exists(select 1 from app_private.reservations where session_id=sid and bike_id=bid and status='confirmed') then reason:='BIKE_TAKEN'; end if;
  end if;
  if reason is not null then
    v_outcome:='rejected'; rid:=null;
    res:=jsonb_build_object('outcome',v_outcome,'error',jsonb_build_object('code',reason),'reference',null);
  else
    if cancel then
      if r.status<>'cancelled' then
        update app_private.reservations set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,version=version+1 where id=rid;
        perform app_private.audit(p_actor,'reservation.cancel',rid);
      end if;
    else
      insert into app_private.reservations(session_id,student_id,bike_id,status) values(sid,st,bid,'confirmed') returning id into rid;
      perform app_private.audit(p_actor,'reservation.create',rid,jsonb_build_object('sessionId',sid,'studentId',st));
    end if;
    res:=jsonb_build_object('outcome','applied','reference',jsonb_build_object('reservationId',rid,'sessionId',sid),'resource',app_private.reservation_dto(rid));
  end if;
  update app_private.idempotency_operations set outcome=v_outcome,result=res,resource_id=rid where actor_id=p_actor and key=p_key;
  return res || jsonb_build_object('replayed',false,'currentResource',app_private.reservation_dto(rid));
end $$;

create function public.studio_command(p_action text,p_id uuid default null,p_body jsonb default '{}',p_key text default null,p_version bigint default null,p_expected_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.actor(); st app_private.students; c app_private.class_sessions;
  ids uuid[]; n integer; v bigint; rowid uuid; pol jsonb; resource text; cancelled_ids jsonb;
begin
  -- Bind the intent in this SAME transaction, before every write, audit and idempotency row.
  -- auth.uid()/the guard resolved u above; p_expected_actor cannot choose identity or role.
  perform app_private.require_expected_actor(p_expected_actor,u);
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='PT503',message='ISOLATION_LEVEL_UNSUPPORTED'; end if;
  if p_action in ('reserve','cancel','admin.reserve','admin.cancel') then
    return app_private.booking_command(p_action,p_id,p_body,p_key,u);
  end if;
  if p_action='me.update' then
    perform app_private.keys(p_body,array['fullName','phone']);
    -- Same student -> profile order as administrative student edits.
    perform 1 from app_private.students where user_id=u for update;
    update app_private.profiles set full_name=case when p_body?'fullName' then p_body->>'fullName' else full_name end,
      phone=case when p_body?'phone' then p_body->>'phone' else phone end,version=version+1,updated_at=now()
    where id=u and version=p_version;
    if not found then raise exception using errcode='PT409',message='VERSION_CONFLICT'; end if;
    update app_private.students s set full_name=p.full_name,phone=p.phone,version=s.version+1,updated_at=now()
    from app_private.profiles p where s.user_id=u and p.id=u;
    perform app_private.audit(u,p_action,u);
    return public.studio_read('me');
  end if;
  perform app_private.admin_actor();
  if p_action='admin.settings.update' then
    perform app_private.keys(p_body,array['policies'],array['policies']);
    pol:=p_body->'policies'; perform app_private.validate_policies(pol);
    update app_private.settings set policies=pol,version=version+1 where singleton and version=p_version;
    if not found then raise exception using errcode='PT409',message='VERSION_CONFLICT'; end if;
    perform app_private.audit(u,p_action,null,pol);
    return public.studio_read('admin.settings');
  elsif p_action in ('admin.students.create','admin.students.update','admin.students.archive') then
    resource:='admin.students';
    if p_action='admin.students.create' then
      perform app_private.keys(p_body,array['fullName','contactEmail','phone'],array['fullName']);
      insert into app_private.students(full_name,contact_email,phone) values(p_body->>'fullName',p_body->>'contactEmail',p_body->>'phone') returning id into rowid;
    else
      if p_action='admin.students.archive' then perform app_private.keys(p_body,'{}');
      else perform app_private.keys(p_body,array['fullName','contactEmail','phone','restore']); end if;
      select * into st from app_private.students where id=p_id for update;
      if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
      if p_version is distinct from st.version then raise exception using errcode='PT409',message='VERSION_CONFLICT'; end if;
      if coalesce(st.user_id,st.invited_user_id)=u and p_action='admin.students.archive' then raise exception using errcode='PT409',message='CANNOT_ARCHIVE_SELF'; end if;
      update app_private.students set
        full_name=case when p_body?'fullName' then p_body->>'fullName' else full_name end,
        contact_email=case when p_body?'contactEmail' then p_body->>'contactEmail' else contact_email end,
        phone=case when p_body?'phone' then p_body->>'phone' else phone end,
        archived_at=case when p_action='admin.students.archive' then now() when p_body->'restore'='true'::jsonb then null else archived_at end,
        version=version+1,updated_at=now() where id=p_id;
      update app_private.profiles p set full_name=s.full_name,phone=s.phone,active=s.archived_at is null,
        -- Use the DB's actual revocation instant, not transaction-start now() or a JS-rounded date.
        -- Restore must preserve this barrier against old, previously unregistered Auth sessions.
        auth_revoked_before=case when p_action='admin.students.archive' then clock_timestamp() else p.auth_revoked_before end,
        version=p.version+1,updated_at=now()
      from app_private.students s where s.id=p_id and p.id=coalesce(s.user_id,s.invited_user_id);
      if p_action='admin.students.archive' then
        update app_private.session_guards set revoked_at=coalesce(revoked_at,now()) where user_id=coalesce(st.user_id,st.invited_user_id);
      end if;
      rowid:=p_id;
    end if;
  elsif p_action in ('admin.instructors.create','admin.instructors.update','admin.instructors.archive','admin.bikes.create','admin.bikes.update','admin.bikes.archive') then
    -- Serializes schedule/inventory changes across all sessions; not normal reservations.
    perform pg_advisory_xact_lock(70123);
    if p_action like 'admin.instructors.%' then
      resource:='admin.instructors';
      if p_action='admin.instructors.create' then
        perform app_private.keys(p_body,array['name','bio'],array['name']);
        insert into app_private.instructors(name,bio) values(p_body->>'name',p_body->>'bio') returning id into rowid;
      else
        if p_action='admin.instructors.archive' then perform app_private.keys(p_body,'{}');
        else perform app_private.keys(p_body,array['name','bio','restore']); end if;
        select version into v from app_private.instructors where id=p_id for update;
        if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
        if p_version is distinct from v then raise exception using errcode='PT409',message='VERSION_CONFLICT'; end if;
        if p_action='admin.instructors.archive' and exists(select 1 from app_private.class_sessions where instructor_id=p_id and status in ('draft','published')) then
          raise exception using errcode='PT409',message='RESOURCE_IN_USE'; end if;
        update app_private.instructors set name=case when p_body?'name' then p_body->>'name' else name end,
          bio=case when p_body?'bio' then p_body->>'bio' else bio end,
          archived_at=case when p_action='admin.instructors.archive' then now() when p_body->'restore'='true'::jsonb then null else archived_at end,version=version+1 where id=p_id;
        rowid:=p_id;
      end if;
    else
      resource:='admin.bikes';
      if p_action='admin.bikes.create' then
        perform app_private.keys(p_body,array['label'],array['label']);
        insert into app_private.bikes(label) values(p_body->>'label') returning id into rowid;
      else
        if p_action='admin.bikes.archive' then perform app_private.keys(p_body,'{}');
        else perform app_private.keys(p_body,array['label','restore']); end if;
        -- Session locks in stable UUID order precede bike changes, like class edits.
        perform 1 from app_private.class_sessions s where s.id in (select session_id from app_private.session_bikes where bike_id=p_id) order by s.id for update;
        select version into v from app_private.bikes where id=p_id for update;
        if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
        if p_version is distinct from v then raise exception using errcode='PT409',message='VERSION_CONFLICT'; end if;
        if p_action='admin.bikes.archive' and exists(select 1 from app_private.session_bikes sb join app_private.class_sessions s on s.id=sb.session_id where bike_id=p_id and s.status in ('draft','published')) then
          raise exception using errcode='PT409',message='RESOURCE_IN_USE'; end if;
        update app_private.bikes set label=case when p_body?'label' then p_body->>'label' else label end,
          archived_at=case when p_action='admin.bikes.archive' then now() when p_body->'restore'='true'::jsonb then null else archived_at end,version=version+1 where id=p_id;
        rowid:=p_id;
      end if;
    end if;
  elsif p_action in ('admin.sessions.create','admin.sessions.update','admin.sessions.archive') then
    resource:='admin.sessions';
    perform pg_advisory_xact_lock(70123);
    if p_action='admin.sessions.archive' then perform app_private.keys(p_body,'{}');
    else perform app_private.keys(p_body,array['title','instructorId','startsAt','endsAt','timezone','capacity','bikeMode','bikeIds','status']); end if;
    if p_action='admin.sessions.create' then
      perform app_private.keys(p_body,array['title','instructorId','startsAt','endsAt','timezone','capacity','bikeMode','bikeIds','status'],array['title','instructorId','startsAt','endsAt','timezone','capacity','bikeMode','bikeIds']);
      insert into app_private.class_sessions(title,instructor_id,starts_at,ends_at,timezone,capacity,bike_mode,status)
      values(p_body->>'title',(p_body->>'instructorId')::uuid,(p_body->>'startsAt')::timestamptz,(p_body->>'endsAt')::timestamptz,
        p_body->>'timezone',(p_body->>'capacity')::integer,p_body->>'bikeMode',coalesce(p_body->>'status','draft')) returning * into c;
    else
      select * into c from app_private.class_sessions where id=p_id for update;
      if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
      if p_version is distinct from c.version then raise exception using errcode='PT409',message='VERSION_CONFLICT'; end if;
      if c.status in ('cancelled','completed') then raise exception using errcode='PT409',message='SESSION_TERMINAL'; end if;
      if c.status='published' and p_body->>'status'='draft' then raise exception using errcode='PT409',message='INVALID_TRANSITION'; end if;
      update app_private.class_sessions set
        title=case when p_body?'title' then p_body->>'title' else title end,
        instructor_id=case when p_body?'instructorId' then (p_body->>'instructorId')::uuid else instructor_id end,
        starts_at=case when p_body?'startsAt' then (p_body->>'startsAt')::timestamptz else starts_at end,
        ends_at=case when p_body?'endsAt' then (p_body->>'endsAt')::timestamptz else ends_at end,
        timezone=case when p_body?'timezone' then p_body->>'timezone' else timezone end,
        capacity=case when p_body?'capacity' then (p_body->>'capacity')::integer else capacity end,
        bike_mode=case when p_body?'bikeMode' then p_body->>'bikeMode' else bike_mode end,
        status=case when p_action='admin.sessions.archive' then 'cancelled' when p_body?'status' then p_body->>'status' else status end,
        version=version+1 where id=p_id returning * into c;
    end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=c.timezone) then raise exception using errcode='PT422',message='INVALID_TIMEZONE'; end if;
    if c.status in ('draft','published') and not exists(select 1 from app_private.instructors where id=c.instructor_id and archived_at is null) then
      raise exception using errcode='PT409',message='INSTRUCTOR_INACTIVE'; end if;
    if p_body?'bikeIds' then
      if jsonb_typeof(p_body->'bikeIds') <> 'array' then raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
      select coalesce(array_agg(value::uuid order by value::uuid),'{}') into ids from jsonb_array_elements_text(p_body->'bikeIds');
      if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then raise exception using errcode='PT422',message='DUPLICATE_BIKE'; end if;
      if exists(select 1 from unnest(ids) x where not exists(select 1 from app_private.bikes where id=x and archived_at is null)) then raise exception using errcode='PT409',message='BIKE_INACTIVE'; end if;
      -- History FK is preserved even for cancelled reservations. No destructive inventory rewrite.
      if exists(select 1 from app_private.reservations where session_id=c.id and bike_id is not null and not bike_id=any(ids)) then
        raise exception using errcode='PT409',message='INVENTORY_HISTORY_DEPENDENCY'; end if;
      delete from app_private.session_bikes where session_id=c.id and not bike_id=any(ids);
      insert into app_private.session_bikes(session_id,bike_id) select c.id,x from unnest(ids) x on conflict do nothing;
    end if;
    select count(*) into n from app_private.reservations where session_id=c.id and status='confirmed';
    if c.capacity<n then raise exception using errcode='PT409',message='CAPACITY_BELOW_RESERVATIONS'; end if;
    if c.bike_mode='none' and exists(select 1 from app_private.reservations where session_id=c.id and status='confirmed' and bike_id is not null)
      or c.bike_mode='required' and exists(select 1 from app_private.reservations where session_id=c.id and status='confirmed' and bike_id is null) then
      raise exception using errcode='PT409',message='BIKE_MODE_CONFLICT'; end if;
    if c.status='published' then
      if not app_private.policies_ready() then raise exception using errcode='PT409',message='POLICY_UNCONFIGURED'; end if;
      if c.capacity>(select count(*) from app_private.session_bikes where session_id=c.id) then raise exception using errcode='PT409',message='INSUFFICIENT_INVENTORY'; end if;
      if exists(select 1 from app_private.session_bikes mine join app_private.session_bikes other on other.bike_id=mine.bike_id and other.session_id<>mine.session_id
        join app_private.class_sessions s on s.id=other.session_id where mine.session_id=c.id and s.status='published'
        and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(c.starts_at,c.ends_at,'[)')) then
        raise exception using errcode='PT409',message='BIKE_SCHEDULE_OVERLAP'; end if;
    end if;
    if c.status='cancelled' then
      with affected as (
        update app_private.reservations set status='cancelled',cancelled_at=now(),cancelled_by=u,version=version+1
        where session_id=c.id and status='confirmed' returning id
      ) select coalesce(jsonb_agg(id),'[]') into cancelled_ids from affected;
      perform app_private.audit(u,'session.cancel_reservations',c.id,jsonb_build_object('reservationIds',cancelled_ids));
    end if;
    rowid:=c.id;
  elsif p_action in ('admin.attendance.mark','admin.attendance.clear') then
    if p_action='admin.attendance.mark' then perform app_private.keys(p_body,array['status'],array['status']);
    else perform app_private.keys(p_body,'{}'); end if;
    select session_id into rowid from app_private.reservations where id=p_id;
    if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
    perform 1 from app_private.class_sessions where id=rowid for update;
    select version into v from app_private.reservations where id=p_id and status='confirmed' for update;
    if not found then raise exception using errcode='PT409',message='RESERVATION_NOT_CONFIRMED'; end if;
    if p_version is distinct from v then raise exception using errcode='PT409',message='VERSION_CONFLICT'; end if;
    if p_action='admin.attendance.mark' then
      insert into app_private.attendance(reservation_id,status,marked_by) values(p_id,p_body->>'status',u)
      on conflict(reservation_id) do update set status=excluded.status,marked_by=u,marked_at=now();
    else delete from app_private.attendance where reservation_id=p_id; end if;
    update app_private.reservations set version=version+1 where id=p_id;
    perform app_private.audit(u,p_action,p_id,p_body);
    return app_private.reservation_dto(p_id);
  else raise exception using errcode='PT404',message='NOT_FOUND';
  end if;
  perform app_private.audit(u,p_action,rowid);
  return public.studio_read(resource,rowid);
end $$;

revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
revoke all on function public.studio_command(text,uuid,jsonb,text,bigint,uuid) from public, anon, authenticated, service_role;
grant execute on function public.studio_command(text,uuid,jsonb,text,bigint,uuid) to authenticated;
commit;
