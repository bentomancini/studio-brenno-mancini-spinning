begin;

create function app_private.actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); s uuid := (auth.jwt()->>'session_id')::uuid;
begin
  if u is null or s is null or coalesce((auth.jwt()->>'exp')::bigint,0) <= extract(epoch from clock_timestamp()) or not exists (
    select 1 from app_private.session_guards g
    join auth.sessions a on a.id=g.session_id and a.user_id=g.user_id
    join app_private.profiles p on p.id=g.user_id
    where g.session_id=s and g.user_id=u and g.revoked_at is null and p.active
      and (a.not_after is null or a.not_after > now())
      and (p.auth_revoked_before is null or a.created_at > p.auth_revoked_before)
  ) then raise exception using errcode='PT401', message='UNAUTHENTICATED'; end if;
  if exists (select 1 from app_private.students where (user_id=u or invited_user_id=u) and archived_at is not null) then
    raise exception using errcode='PT403', message='ACCOUNT_DISABLED';
  end if;
  return u;
end $$;

create or replace function app_private.is_admin(p_user uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from app_private.user_roles ur
    join auth.users u on u.id = ur.user_id
    where ur.user_id = p_user and ur.role = 'admin'
      and (lower(u.email) = 'bentomancini@gmail.com' or u.email like '%@example.invalid')
  )
$$;

create function app_private.require_expected_actor(p_expected uuid,p_actual uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if p_expected is null then raise exception using errcode='PT422',message='EXPECTED_ACTOR_REQUIRED'; end if;
  if p_actual is null then raise exception using errcode='PT401',message='UNAUTHENTICATED'; end if;
  if p_expected <> p_actual then raise exception using errcode='PT409',message='ACTOR_CHANGED'; end if;
end $$;

create function app_private.admin_actor() returns uuid
language plpgsql stable set search_path = '' as $$
declare u uuid := app_private.actor(); begin
  if not app_private.is_admin(u) then raise exception using errcode='PT403',message='FORBIDDEN'; end if;
  return u;
end $$;

create function app_private.audit(p_actor uuid,p_action text,p_id uuid,p_details jsonb default '{}') returns void
language sql set search_path = '' as $$
  insert into app_private.audit_events(actor_id,action,resource_id,details) values(p_actor,p_action,p_id,p_details)
$$;

create function app_private.policies_ready() returns boolean
language sql stable set search_path = '' as $$
  select policies->'bookingWindow'->>'mode' in ('unrestricted','restricted')
     and policies->'cancellation'->>'mode' in ('unrestricted','restricted')
     and policies->'eligibility'->>'mode' in ('unrestricted','restricted')
  from app_private.settings where singleton
$$;

create function app_private.booking_reason(p_session uuid,p_student uuid,p_cancel boolean default false) returns text
language plpgsql stable set search_path = '' as $$
declare c app_private.class_sessions; p jsonb; n integer; begin
  select * into c from app_private.class_sessions where id=p_session;
  if not found then return 'NOT_FOUND'; end if;
  if not app_private.policies_ready() then return 'POLICY_UNCONFIGURED'; end if;
  if c.status <> 'published' then return 'SESSION_NOT_BOOKABLE'; end if;
  select policies into p from app_private.settings where singleton;
  if p_cancel then
    if p->'cancellation'->>'mode'='restricted' and
      c.starts_at < now()+make_interval(mins=>(p->'cancellation'->>'minNoticeMinutes')::integer)
    then return 'CANCELLATION_WINDOW'; end if;
  else
    if not exists(select 1 from app_private.students where id=p_student and archived_at is null) then return 'STUDENT_INACTIVE'; end if;
    if exists(select 1 from app_private.reservations where session_id=p_session and student_id=p_student and status='confirmed') then return 'ALREADY_RESERVED'; end if;
    select count(*) into n from app_private.reservations where session_id=p_session and status='confirmed';
    if n >= c.capacity then return 'SESSION_FULL'; end if;
    if p->'bookingWindow'->>'mode'='restricted' then
      if c.starts_at < now()+make_interval(mins=>(p->'bookingWindow'->>'minNoticeMinutes')::integer)
        or c.starts_at > now()+make_interval(mins=>(p->'bookingWindow'->>'maxAdvanceMinutes')::integer)
      then return 'BOOKING_WINDOW'; end if;
    end if;
    if p->'eligibility'->>'mode'='restricted' and
      (select count(*) from app_private.reservations r join app_private.class_sessions s on s.id=r.session_id
        where r.student_id=p_student and r.status='confirmed' and s.status='published') >= (p->'eligibility'->>'maxActiveReservations')::integer
    then return 'RESERVATION_LIMIT'; end if;
  end if;
  return null;
end $$;

create function app_private.reservation_dto(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',r.id,'sessionId',r.session_id,'studentId',r.student_id,
    'bikeId',r.bike_id,'status',r.status,'createdAt',r.created_at,'cancelledAt',r.cancelled_at,
    'version',r.version,'attendance',coalesce(a.status,'unmarked'))
  from app_private.reservations r left join app_private.attendance a on a.reservation_id=r.id where r.id=p_id
$$;

create function app_private.session_dto(p_id uuid,p_actor uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id',s.id,'title',s.title,'instructor',jsonb_build_object('id',i.id,'name',i.name),
    'startsAt',s.starts_at,'endsAt',s.ends_at,'timezone',s.timezone,
    'durationMinutes',extract(epoch from (s.ends_at-s.starts_at))/60,
    'sessionStatus',s.status,'capacity',s.capacity,
    'availability',s.capacity-(select count(*) from app_private.reservations where session_id=s.id and status='confirmed'),
    'bikeMode',s.bike_mode,'version',s.version,
    'myReservation',(select app_private.reservation_dto(r.id) from app_private.reservations r
      join app_private.students st on st.id=r.student_id where r.session_id=s.id and st.user_id=p_actor
      order by (r.status='confirmed') desc,r.created_at desc,r.id limit 1),
    'allowedActions',jsonb_build_object('reserve',reason.code is null,'reasonCode',reason.code),
    'asOf',statement_timestamp())
  from app_private.class_sessions s join app_private.instructors i on i.id=s.instructor_id
  left join app_private.students st on st.user_id=p_actor
  cross join lateral (select app_private.booking_reason(s.id,st.id) code) reason
  where s.id=p_id
$$;

create function public.studio_session(p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); s uuid := (auth.jwt()->>'session_id')::uuid; inv app_private.students;
begin
  if p_action='register' then
    if u is null or s is null or not exists(select 1 from auth.sessions where id=s and user_id=u and (not_after is null or not_after>now())) then
      raise exception using errcode='PT401',message='UNAUTHENTICATED'; end if;
    -- Serialize first activation/registration and invitation linking for this identity.
    -- No profile-row lock: student -> profile ordering of edits stays unchanged.
    perform pg_advisory_xact_lock(hashtextextended('identity:'||u::text,0));
    if not exists(select 1 from app_private.profiles where id=u and active) then
      raise exception using errcode='PT403',message='ACCOUNT_DISABLED'; end if;
    insert into app_private.session_guards(session_id,user_id) values(s,u) on conflict do nothing;
    perform app_private.actor(); -- A revoked session can never be re-registered.
    -- Link only the exact Auth invitation identity, with email confirmation proof.
    select * into inv from app_private.students where invited_user_id=u for update;
    if found then
      if not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then
        raise exception using errcode='PT403',message='INVITATION_UNCONFIRMED'; end if;
      update app_private.students set user_id=u,invited_user_id=null,version=version+1,updated_at=now() where id=inv.id;
      update app_private.profiles set full_name=inv.full_name,phone=inv.phone,version=version+1,updated_at=now() where id=u;
    elsif not exists(select 1 from app_private.students where user_id=u) then
      insert into app_private.students(user_id,full_name,phone,contact_email)
      select p.id,p.full_name,p.phone,a.email from app_private.profiles p join auth.users a on a.id=p.id where p.id=u;
    end if;
    perform app_private.audit(u,'session.register',s);
  elsif p_action='revoke' then
    -- Idempotent logout also works for an already revoked/disabled actor.
    if u is null or s is null then raise exception using errcode='PT401',message='UNAUTHENTICATED'; end if;
    insert into app_private.session_guards(session_id,user_id,revoked_at) values(s,u,now())
    on conflict(session_id) do update set revoked_at=coalesce(app_private.session_guards.revoked_at,now())
    where app_private.session_guards.user_id=u;
    perform app_private.audit(u,'session.revoke',s);
    return jsonb_build_object('revoked',true);
  elsif p_action <> 'check' then
    raise exception using errcode='PT422',message='INVALID_INPUT';
  end if;
  u := app_private.actor();
  return jsonb_build_object('userId',u,'role',(select role from app_private.user_roles where user_id=u),
    'studentId',(select id from app_private.students where user_id=u));
end $$;

create function public.studio_auth_bridge(p_action text,p_body jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid; s uuid; n integer; lim integer; win integer; request_actor uuid;
begin
  -- This RPC is granted ONLY to service_role, not to authenticated or anon.
  if p_action='rate_limit' then
    lim := (p_body->>'limit')::integer; win := (p_body->>'seconds')::integer;
    if length(p_body->>'bucket')>200 or lim not between 1 and 1000 or win not between 1 and 86400 then
      raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
    insert into app_private.rate_limits(bucket,window_at,hits) values(p_body->>'bucket',clock_timestamp(),1)
    on conflict(bucket) do update set
      hits=case when app_private.rate_limits.window_at <= clock_timestamp()-make_interval(secs=>win) then 1 else app_private.rate_limits.hits+1 end,
      window_at=case when app_private.rate_limits.window_at <= clock_timestamp()-make_interval(secs=>win) then clock_timestamp() else app_private.rate_limits.window_at end
    returning hits into n;
    return jsonb_build_object('allowed',n<=lim);
  end if;
  u := (p_body->>'userId')::uuid; s := (p_body->>'sessionId')::uuid;
  if u is null then raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  if p_action='recovery_grant' then
    if not exists(select 1 from auth.sessions where id=s and user_id=u and (not_after is null or not_after>now())) then
      raise exception using errcode='PT401',message='UNAUTHENTICATED'; end if;
    insert into app_private.session_guards(session_id,user_id) values(s,u) on conflict do nothing;
    if exists(select 1 from app_private.session_guards where session_id=s and revoked_at is not null) then
      raise exception using errcode='PT401',message='UNAUTHENTICATED'; end if;
    insert into app_private.recovery_grants(session_id,user_id,expires_at) values(s,u,now()+interval '10 minutes')
    on conflict do nothing; -- Never extend validity or reset consumption on replay.
    return jsonb_build_object('granted',true);
  elsif p_action='consume_recovery' then
    update app_private.recovery_grants set consumed_at=now()
    where session_id=s and user_id=u and consumed_at is null and expires_at>now()
      and exists(select 1 from app_private.session_guards where session_id=s and user_id=u and revoked_at is null)
      and exists(select 1 from auth.sessions where id=s and user_id=u and (not_after is null or not_after>now()));
    if not found then raise exception using errcode='PT401',message='RECOVERY_INVALID'; end if;
    return jsonb_build_object('consumed',true);
  elsif p_action='revoke_user' then
    -- Also deny old but previously unregistered provider sessions on later registration.
    update app_private.profiles set auth_revoked_before=clock_timestamp() where id=u;
    update app_private.session_guards set revoked_at=coalesce(revoked_at,now()) where user_id=u;
    return jsonb_build_object('revoked',true);
  elsif p_action='link_invitation' then
    -- Called only after Auth Admin inviteUserByEmail returned this identity.
    -- Only service_role can attest a BFF-verified request session. Derive the requesting
    -- actor from that live session, NOT the expected UUID or the invitee's userId.
    if p_body->>'expectedActor' is null then
      raise exception using errcode='PT422',message='EXPECTED_ACTOR_REQUIRED'; end if;
    select g.user_id into request_actor from app_private.session_guards g
    join auth.sessions a on a.id=g.session_id and a.user_id=g.user_id
    join app_private.profiles p on p.id=g.user_id
    where g.session_id=(p_body->>'requestSessionId')::uuid and g.revoked_at is null and p.active
      and (a.not_after is null or a.not_after>now())
      and (p.auth_revoked_before is null or a.created_at>p.auth_revoked_before);
    perform app_private.require_expected_actor((p_body->>'expectedActor')::uuid,request_actor);
    if not app_private.is_admin(request_actor) or exists(
      select 1 from app_private.students where (user_id=request_actor or invited_user_id=request_actor) and archived_at is not null
    ) then raise exception using errcode='PT403',message='FORBIDDEN'; end if;
    perform pg_advisory_xact_lock(hashtextextended('identity:'||u::text,0));
    if exists(select 1 from app_private.students where user_id=u) then
      raise exception using errcode='PT409',message='INVITATION_CONFLICT'; end if;
    update app_private.students set invited_user_id=u,version=version+1,updated_at=now()
    where id=(p_body->>'studentId')::uuid and user_id is null and invited_user_id is null and archived_at is null
      and version=(p_body->>'version')::bigint;
    if not found then raise exception using errcode='PT409',message='INVITATION_CONFLICT'; end if;
    perform app_private.audit(request_actor,'student.invited',(p_body->>'studentId')::uuid,jsonb_build_object('invitedUserId',u));
    return jsonb_build_object('invited',true);
  end if;
  raise exception using errcode='PT422',message='INVALID_INPUT';
end $$;

create function public.studio_read(p_resource text,p_id uuid default null,p_query jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.actor(); adm boolean := app_private.is_admin(u); st uuid;
  lim integer := coalesce((p_query->>'limit')::integer,30); offst integer := coalesce((p_query->>'offset')::integer,0);
  result jsonb; op app_private.idempotency_operations;
begin
  if lim not between 1 and 100 or offst not between 0 and 100000 then raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  select id into st from app_private.students where user_id=u;
  if p_resource like 'admin.%' and not adm then raise exception using errcode='PT403',message='FORBIDDEN'; end if;
  if p_resource='me' then
    select jsonb_build_object('id',id,'fullName',full_name,'phone',phone,'version',version,'studentId',st,
      'role',(select role from app_private.user_roles where user_id=u)) into result from app_private.profiles where id=u;
  elsif p_resource='operations' then
    select * into op from app_private.idempotency_operations where actor_id=u and key=p_query->>'key' and outcome is not null;
    if not found then return jsonb_build_object('state','not_observed'); end if;
    return jsonb_build_object('state','observed','operation',op.result,'currentResource',app_private.reservation_dto(op.resource_id));
  elsif p_resource in ('sessions','admin.sessions') then
    if p_id is not null then
      select app_private.session_dto(id,u) into result from app_private.class_sessions where id=p_id and (adm or status <> 'draft');
    else
      select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'),'limit',lim,'offset',offst) into result from (
        select app_private.session_dto(id,u) dto from app_private.class_sessions
        where (adm or status <> 'draft') and (p_query->>'from' is null or starts_at >= (p_query->>'from')::timestamptz)
        and (p_query->>'to' is null or starts_at < (p_query->>'to')::timestamptz)
        order by starts_at,id limit lim offset offst
      ) q;
    end if;
  elsif p_resource='session_bikes' then
    if not exists(select 1 from app_private.class_sessions where id=p_id and (adm or status<>'draft')) then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
    select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'available',not exists(
      select 1 from app_private.reservations r where r.session_id=p_id and r.bike_id=b.id and r.status='confirmed')) order by b.label,b.id),'[]'),
      'asOf',statement_timestamp()) into result from app_private.session_bikes sb join app_private.bikes b on b.id=sb.bike_id where sb.session_id=p_id;
  elsif p_resource in ('reservations','admin.reservations') then
    if p_id is not null then
      select app_private.reservation_dto(id) into result from app_private.reservations where id=p_id and (p_resource='admin.reservations' or student_id=st);
    else
      select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'),'limit',lim,'offset',offst) into result from (
        select app_private.reservation_dto(r.id) || jsonb_build_object('session',app_private.session_dto(s.id,u)) dto
        from app_private.reservations r join app_private.class_sessions s on s.id=r.session_id
        where (p_resource='admin.reservations' or r.student_id=st)
          and (p_query->>'sessionId' is null or r.session_id=(p_query->>'sessionId')::uuid)
          and (p_query->>'studentId' is null or (p_resource='admin.reservations' and r.student_id=(p_query->>'studentId')::uuid))
          and (p_query->>'history' is null or case when (p_query->>'history')::boolean then r.status='cancelled' or s.status in ('cancelled','completed') else r.status='confirmed' and s.status='published' end)
        order by r.created_at desc,r.id limit lim offset offst
      ) q;
    end if;
  elsif p_resource='admin.students' then
    if p_id is not null then
      select jsonb_build_object('id',id,'userId',user_id,'fullName',full_name,'contactEmail',contact_email,'phone',phone,
        'archivedAt',archived_at,'invited',invited_user_id is not null,'version',version) into result from app_private.students where id=p_id;
    else
      select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'),'limit',lim,'offset',offst) into result from (
        select jsonb_build_object('id',id,'userId',user_id,'fullName',full_name,'contactEmail',contact_email,'phone',phone,
          'archivedAt',archived_at,'invited',invited_user_id is not null,'version',version) dto
        from app_private.students order by full_name,id limit lim offset offst
      ) q;
    end if;
  elsif p_resource in ('admin.instructors','admin.bikes') then
    if p_resource='admin.instructors' then
      if p_id is not null then select jsonb_build_object('id',id,'name',name,'bio',bio,'archivedAt',archived_at,'version',version) into result from app_private.instructors where id=p_id;
      else select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'),'limit',lim,'offset',offst) into result from (
        select jsonb_build_object('id',id,'name',name,'bio',bio,'archivedAt',archived_at,'version',version) dto from app_private.instructors order by name,id limit lim offset offst) q;
      end if;
    else
      if p_id is not null then select jsonb_build_object('id',id,'label',label,'archivedAt',archived_at,'version',version) into result from app_private.bikes where id=p_id;
      else select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'),'limit',lim,'offset',offst) into result from (
        select jsonb_build_object('id',id,'label',label,'archivedAt',archived_at,'version',version) dto from app_private.bikes order by label,id limit lim offset offst) q;
      end if;
    end if;
  elsif p_resource='admin.settings' then
    select jsonb_build_object('policies',policies,'version',version) into result from app_private.settings where singleton;
  else raise exception using errcode='PT404',message='NOT_FOUND';
  end if;
  if result is null then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  return result;
end $$;

revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
revoke all on function public.studio_session(text), public.studio_read(text,uuid,jsonb), public.studio_auth_bridge(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.studio_session(text), public.studio_read(text,uuid,jsonb) to authenticated;
grant execute on function public.studio_auth_bridge(text,jsonb) to service_role;
commit;
