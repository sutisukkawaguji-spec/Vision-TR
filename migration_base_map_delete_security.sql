-- Run once in Supabase SQL Editor.
-- Only the account that imported a Base Map can delete that Base Map.
alter table public.base_maps enable row level security;

drop policy if exists base_maps_team_all on public.base_maps;
drop policy if exists base_maps_team_select on public.base_maps;
drop policy if exists base_maps_team_insert on public.base_maps;
drop policy if exists base_maps_team_update on public.base_maps;
drop policy if exists base_maps_importer_delete on public.base_maps;

create policy base_maps_team_select on public.base_maps for select using (
  team_id = (select p.team_id from public.profiles p where p.id = auth.uid())
);
create policy base_maps_team_insert on public.base_maps for insert with check (
  team_id = (select p.team_id from public.profiles p where p.id = auth.uid())
);
create policy base_maps_team_update on public.base_maps for update
  using (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()))
  with check (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()));
create policy base_maps_importer_delete on public.base_maps for delete using (
  team_id = (select p.team_id from public.profiles p where p.id = auth.uid())
  and imported_by = auth.uid()
);

notify pgrst, 'reload schema';
