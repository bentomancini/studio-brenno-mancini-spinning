begin;

-- Separate additive RPC: the existing read contract and its unfiltered pagination remain intact.
create or replace function public.studio_catalog_search(p_resource text, p_term text, p_limit integer default 30, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb; term text := btrim(p_term);
begin
  perform app_private.admin_actor();
  if p_resource not in ('students','instructors','bikes') or p_resource is null
     or term is null or length(term) not between 1 and 120
     or p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset not between 0 and 100000 then
    raise exception using errcode='PT422',message='INVALID_INPUT';
  end if;

  if p_resource='students' then
    select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'::jsonb),'limit',p_limit,'offset',p_offset) into result from (
      select jsonb_build_object('id',id,'userId',user_id,'fullName',full_name,'contactEmail',contact_email,'phone',phone,
        'archivedAt',archived_at,'invited',invited_user_id is not null,'version',version) dto
      from app_private.students
      where strpos(lower(full_name),lower(term))>0 or strpos(lower(coalesce(contact_email,'')),lower(term))>0
        or strpos(lower(coalesce(phone,'')),lower(term))>0
      order by full_name,id limit p_limit offset p_offset
    ) q;
  elsif p_resource='instructors' then
    select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'::jsonb),'limit',p_limit,'offset',p_offset) into result from (
      select jsonb_build_object('id',id,'name',name,'bio',bio,'archivedAt',archived_at,'version',version) dto
      from app_private.instructors where strpos(lower(name),lower(term))>0
      order by name,id limit p_limit offset p_offset
    ) q;
  else
    select jsonb_build_object('items',coalesce(jsonb_agg(dto),'[]'::jsonb),'limit',p_limit,'offset',p_offset) into result from (
      select jsonb_build_object('id',id,'label',label,'archivedAt',archived_at,'version',version) dto
      from app_private.bikes where strpos(lower(label),lower(term))>0
      order by label,id limit p_limit offset p_offset
    ) q;
  end if;
  return result;
end $$;

revoke all on function public.studio_catalog_search(text,text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.studio_catalog_search(text,text,integer,integer) to authenticated;
commit;
