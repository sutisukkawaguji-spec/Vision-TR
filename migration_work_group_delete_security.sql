-- Enforce work-group deletion at database level, not only in the browser UI.
-- Run this once in Supabase SQL Editor after schema_v2.sql.

alter table public.work_groups enable row level security;

drop policy if exists work_groups_team_all on public.work_groups;
drop policy if exists work_groups_team_select on public.work_groups;
drop policy if exists work_groups_team_insert on public.work_groups;
drop policy if exists work_groups_team_update on public.work_groups;
drop policy if exists work_groups_creator_delete on public.work_groups;

create policy work_groups_team_select on public.work_groups
  for select using (
    team_id = (select p.team_id from public.profiles p where p.id = auth.uid())
  );

create policy work_groups_team_insert on public.work_groups
  for insert with check (
    team_id = (select p.team_id from public.profiles p where p.id = auth.uid())
  );

create policy work_groups_team_update on public.work_groups
  for update
  using (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()))
  with check (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()));

-- The creator is the only account permitted to delete the group.
create policy work_groups_creator_delete on public.work_groups
  for delete using (
    team_id = (select p.team_id from public.profiles p where p.id = auth.uid())
    and created_by = auth.uid()
  );

notify pgrst, 'reload schema';
