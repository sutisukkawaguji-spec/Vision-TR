-- Run once in Supabase SQL Editor: work groups can be private or shared,
-- and every newly imported Base Map is assigned to exactly one work group.
alter table public.work_groups
  add column if not exists is_shared boolean not null default false;

alter table public.base_maps
  add column if not exists work_group_id uuid references public.work_groups(id) on delete set null;

create index if not exists base_maps_team_group_idx
  on public.base_maps(team_id, work_group_id);

-- Existing groups were previously visible to the whole team, so retain that
-- behaviour after the upgrade. New groups are private unless shared by owner.
update public.work_groups set is_shared = true where is_shared = false;

notify pgrst, 'reload schema';
