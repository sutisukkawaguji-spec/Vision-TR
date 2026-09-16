-- Survey ExtraPro: isolated Base Map + work-record schema
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  user_code text unique not null,
  team_id uuid not null,
  active_work_group_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.base_maps (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  name text not null,
  source_name text,
  source_url text,
  feature_count integer not null default 0,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  is_active boolean not null default true
);

create table if not exists public.base_plots (
  id text primary key,
  team_id uuid not null,
  base_map_id uuid not null references public.base_maps(id) on delete cascade,
  source_feature_id text,
  display_name text not null,
  lat double precision not null,
  lng double precision not null,
  geometry jsonb not null,
  source_properties jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_groups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  name text not null,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique(team_id, name)
);

create table if not exists public.survey_forms (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  work_group_id uuid not null references public.work_groups(id) on delete cascade,
  name text not null,
  version integer not null default 1,
  fields jsonb not null default '[]'::jsonb,
  layer_type text not null default 'both' check (layer_type in ('both', 'point', 'polygon')),
  layer_color text not null default '#10b981' check (layer_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id, work_group_id)
);

alter table public.profiles
  drop constraint if exists profiles_active_work_group_id_fkey;
alter table public.profiles
  add constraint profiles_active_work_group_id_fkey
  foreign key (active_work_group_id) references public.work_groups(id) on delete set null;

create table if not exists public.plot_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  base_plot_id text not null references public.base_plots(id) on delete restrict,
  work_group_id uuid not null references public.work_groups(id) on delete cascade,
  status text not null default 'waiting'
    check (status in ('waiting', 'navigating', 'checking', 'done', 'problem')),
  note text not null default '',
  images jsonb not null default '[]'::jsonb,
  record_properties jsonb not null default '{}'::jsonb,
  navigator_id uuid,
  navigator_name text,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(base_plot_id, work_group_id)
);

create index if not exists base_maps_team_idx on public.base_maps(team_id);
create index if not exists base_plots_team_map_idx on public.base_plots(team_id, base_map_id);
create index if not exists base_plots_search_idx on public.base_plots using gin(to_tsvector('simple', search_text));
create index if not exists work_groups_team_idx on public.work_groups(team_id);
create index if not exists survey_forms_team_group_idx on public.survey_forms(team_id, work_group_id);
create index if not exists plot_records_group_status_idx on public.plot_records(team_id, work_group_id, status);

alter table public.profiles enable row level security;
alter table public.base_maps enable row level security;
alter table public.base_plots enable row level security;
alter table public.work_groups enable row level security;
alter table public.survey_forms enable row level security;
alter table public.plot_records enable row level security;

drop policy if exists profiles_select_team on public.profiles;
drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_select_team on public.profiles for select using (auth.uid() is not null);
create policy profiles_insert_self on public.profiles for insert with check (id = auth.uid());
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.add_team_member_by_code(member_code text)
returns table (id uuid, email text, display_name text, user_code text)
language plpgsql security definer set search_path = public
as $$
declare caller_profile public.profiles%rowtype; member_profile public.profiles%rowtype;
begin
  select * into caller_profile from public.profiles where profiles.id = auth.uid();
  if caller_profile.id is null or caller_profile.team_id <> caller_profile.id then raise exception 'เฉพาะหัวหน้าทีมเท่านั้นที่เพิ่มสมาชิกได้'; end if;
  select p.* into member_profile from public.profiles p where lower(p.user_code) = lower(trim(member_code));
  if member_profile.id is null then raise exception 'ไม่พบรหัสสมาชิกนี้'; end if;
  if member_profile.id = caller_profile.id then raise exception 'ไม่สามารถเพิ่มตนเองเข้าทีมได้'; end if;
  update public.profiles as p set team_id = caller_profile.team_id, updated_at = now() where p.id = member_profile.id
    returning p.id, p.email, p.display_name, p.user_code into id, email, display_name, user_code;
  return next;
end;
$$;
revoke all on function public.add_team_member_by_code(text) from public;
grant execute on function public.add_team_member_by_code(text) to authenticated;

drop policy if exists base_maps_team_all on public.base_maps;
create policy base_maps_team_all on public.base_maps for all
  using (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()))
  with check (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()));

drop policy if exists base_plots_team_all on public.base_plots;
create policy base_plots_team_all on public.base_plots for all
  using (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()))
  with check (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()));

drop policy if exists work_groups_team_all on public.work_groups;
create policy work_groups_team_all on public.work_groups for all
  using (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()))
  with check (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()));

drop policy if exists survey_forms_team_all on public.survey_forms;
create policy survey_forms_team_all on public.survey_forms for all
  using (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()))
  with check (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()));

drop policy if exists plot_records_team_all on public.plot_records;
create policy plot_records_team_all on public.plot_records for all
  using (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()))
  with check (team_id = (select p.team_id from public.profiles p where p.id = auth.uid()));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_code text;
begin
  new_code := substring(md5(random()::text || clock_timestamp()::text) from 1 for 6);
  insert into public.profiles(id, email, display_name, user_code, team_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'display_name', 'ผู้ใช้งาน'),
    new_code,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Refresh the PostgREST schema cache after applying this schema.
notify pgrst, 'reload schema';
