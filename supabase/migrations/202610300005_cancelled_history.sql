begin;

-- Additive read path: existing studio_read history semantics remain unchanged.
create or replace function public.studio_cancelled_history(p_limit integer default 30, p_offset integer default 0, p_session_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := app_private.actor(); st uuid; result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception using errcode='PT422',message='INVALID_INPUT';
  end if;
  select id into st from app_private.students where user_id=u;
  select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'::jsonb),'limit',p_limit,'offset',p_offset) into result from (
    select app_private.reservation_dto(r.id) || jsonb_build_object('session',app_private.session_dto(s.id,u)) dto
    from app_private.reservations r join app_private.class_sessions s on s.id=r.session_id
    where r.student_id=st and r.status='cancelled' and (p_session_id is null or r.session_id=p_session_id)
    order by r.created_at desc,r.id limit p_limit offset p_offset
  ) q;
  return result;
end $$;

revoke all on function public.studio_cancelled_history(integer,integer,uuid) from public, anon, authenticated, service_role;
grant execute on function public.studio_cancelled_history(integer,integer,uuid) to authenticated;
commit;
