-- Etapas 2-4: diálogo por cena/plano, aprovação de plano e versão selecionada de vídeo.
alter table public.scenes add column if not exists dialogue text;
alter table public.shots add column if not exists dialogue text;
alter table public.shots add column if not exists approval_status text not null default 'pending'
  check (approval_status in ('pending', 'approved', 'rejected'));
alter table public.video_generations add column if not exists is_selected boolean not null default false;
create index if not exists scenes_project_pos on public.scenes (project_id, position);
create index if not exists shots_scene_pos on public.shots (scene_id, position);
create index if not exists storyboards_scene on public.storyboards (scene_id, created_at desc);
create index if not exists video_generations_shot on public.video_generations (shot_id, version desc);
