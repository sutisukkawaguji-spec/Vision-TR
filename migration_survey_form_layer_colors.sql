-- Run once in Supabase SQL Editor to enable separate Point and Polygon colors.
alter table public.survey_forms
  add column if not exists layer_point_color text not null default '#10b981'
  check (layer_point_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.survey_forms
  add column if not exists layer_polygon_color text not null default '#10b981'
  check (layer_polygon_color ~ '^#[0-9A-Fa-f]{6}$');

-- Preserve each existing form's selected color for both layer types.
update public.survey_forms
set layer_point_color = layer_color,
    layer_polygon_color = layer_color
where layer_point_color = '#10b981'
  and layer_polygon_color = '#10b981';

notify pgrst, 'reload schema';
