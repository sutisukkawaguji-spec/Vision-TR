-- Run this once in Supabase SQL Editor to allow a team owner to add members.
-- The browser never receives elevated database credentials.
create or replace function public.add_team_member_by_code(member_code text)
returns table (id uuid, email text, display_name text, user_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_profile public.profiles%rowtype;
  member_profile public.profiles%rowtype;
begin
  select * into caller_profile from public.profiles where profiles.id = auth.uid();
  if caller_profile.id is null or caller_profile.team_id <> caller_profile.id then
    raise exception 'เฉพาะหัวหน้าทีมเท่านั้นที่เพิ่มสมาชิกได้';
  end if;

  select * into member_profile
  from public.profiles
  where lower(user_code) = lower(trim(member_code));
  if member_profile.id is null then
    raise exception 'ไม่พบรหัสสมาชิกนี้';
  end if;
  if member_profile.id = caller_profile.id then
    raise exception 'ไม่สามารถเพิ่มตนเองเข้าทีมได้';
  end if;

  update public.profiles
  set team_id = caller_profile.team_id, updated_at = now()
  where profiles.id = member_profile.id
  returning profiles.id, profiles.email, profiles.display_name, profiles.user_code
  into id, email, display_name, user_code;
  return next;
end;
$$;

revoke all on function public.add_team_member_by_code(text) from public;
grant execute on function public.add_team_member_by_code(text) to authenticated;
