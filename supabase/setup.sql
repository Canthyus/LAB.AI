-- Lab.AI — schema principal
-- Todas as tabelas de dados do usuário têm user_id; RLS é aplicada em 0002_rls.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Garante que a linha referenciada (projeto, personagem, cena...) pertence ao mesmo usuário.
-- Uso: trigger ... execute function public.check_parent_owner('projects', 'project_id')
create or replace function public.check_parent_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_table text := tg_argv[0];
  fk_column text := tg_argv[1];
  fk_value uuid := nullif(to_jsonb(new) ->> fk_column, '')::uuid;
  owner uuid;
begin
  if fk_value is null then
    return new;
  end if;
  execute format('select user_id from public.%I where id = $1', parent_table) into owner using fk_value;
  if owner is null or owner <> new.user_id then
    raise exception 'Registro referenciado (%.%) não pertence ao usuário', parent_table, fk_column
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- users (perfil)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on public.users
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catálogo de modelos (global, somente leitura para clientes)
-- ---------------------------------------------------------------------------
create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'agnes',
  kind text not null check (kind in ('text', 'image', 'video')),
  model_id text not null unique,
  label text not null,
  enabled boolean not null default false,
  -- verified = confirmado na documentação oficial ou via GET /v1/models
  verified boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_models_updated before update on public.ai_models
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Credenciais (somente service role; sem policies = sem acesso do cliente)
-- ---------------------------------------------------------------------------
create table public.user_api_credentials (
  user_id uuid primary key references public.users (id) on delete cascade,
  provider text not null default 'agnes',
  key_ciphertext text not null,
  key_iv text not null,
  key_last4 text not null,
  -- limites de requisições por minuto usados pelo controle de fila
  rate_limits jsonb not null default '{"text": 20, "image": 10, "video": 1}'::jsonb,
  daily_video_seconds_limit int not null default 500,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_api_credentials_updated before update on public.user_api_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Estilos visuais (user_id nulo = estilo do sistema)
-- ---------------------------------------------------------------------------
create table public.visual_styles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  -- lighting, photography, palette[], textures, environments, cinematic_language, prompt_modifier
  config jsonb not null default '{}'::jsonb,
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index visual_styles_system_slug on public.visual_styles (slug) where user_id is null;
create unique index visual_styles_user_slug on public.visual_styles (user_id, slug) where user_id is not null;
create trigger visual_styles_updated before update on public.visual_styles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Projetos
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null,
  description text,
  original_idea text not null default '',
  genre text,
  visual_style_id uuid references public.visual_styles (id) on delete set null,
  format text not null default 'short_film',
  aspect_ratio text not null default '16:9' check (aspect_ratio in ('16:9', '9:16', '1:1')),
  target_duration_seconds int not null default 60 check (target_duration_seconds > 0),
  language text not null default 'pt-BR',
  character_count int,
  production_mode text not null default 'assisted' check (production_mode in ('manual', 'assisted', 'automatic')),
  current_step text not null default 'idea',
  -- {"characters":"approved","script":"pending",...}
  step_status jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_updated on public.projects (user_id, updated_at desc);
create trigger projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

create table public.project_settings (
  project_id uuid primary key references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  text_model text,
  image_model text,
  video_model text,
  video_num_frames int,
  video_frame_rate int,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger project_settings_updated before update on public.project_settings
  for each row execute function public.set_updated_at();

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null,
  note text,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

-- ---------------------------------------------------------------------------
-- Personagens (biblioteca reutilizável) e referências
-- ---------------------------------------------------------------------------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null,
  apparent_age text,
  physical_traits text,
  clothing text,
  personality text,
  expressions text,
  voice text,
  permanent_visual_traits text,
  story_role text,
  -- Descrição visual compacta em inglês, usada em TODOS os prompts de imagem/vídeo
  visual_prompt_en text,
  source text not null default 'manual' check (source in ('manual', 'extracted', 'generated', 'uploaded')),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index characters_user on public.characters (user_id, updated_at desc);
create trigger characters_updated before update on public.characters
  for each row execute function public.set_updated_at();

create table public.character_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  kind text not null check (kind in ('main', 'sheet', 'upload', 'expression', 'pose')),
  storage_bucket text not null default 'media',
  storage_path text not null,
  is_primary boolean not null default false,
  job_id uuid,
  created_at timestamptz not null default now()
);
create index character_references_char on public.character_references (character_id, created_at desc);

-- Quais personagens fazem parte de qual projeto
create table public.project_characters (
  project_id uuid not null references public.projects (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, character_id)
);

-- ---------------------------------------------------------------------------
-- Roteiro, sequências, cenas, planos, storyboard (estrutura pronta; módulos na etapa 2)
-- ---------------------------------------------------------------------------
create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version int not null default 1,
  title text,
  logline text,
  content text not null default '',
  structure jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger scripts_updated before update on public.scripts
  for each row execute function public.set_updated_at();

create table public.sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  script_id uuid references public.scripts (id) on delete set null,
  position int not null,
  title text not null,
  summary text,
  estimated_duration_seconds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sequences_updated before update on public.sequences
  for each row execute function public.set_updated_at();

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  sequence_id uuid references public.sequences (id) on delete cascade,
  position int not null,
  title text not null,
  description text,
  location text,
  character_ids jsonb not null default '[]'::jsonb,
  action text,
  emotion text,
  lighting text,
  environment text,
  estimated_duration_seconds int,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger scenes_updated before update on public.scenes
  for each row execute function public.set_updated_at();

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  scene_id uuid not null references public.scenes (id) on delete cascade,
  position int not null,
  shot_type text,
  visual_prompt text,
  character_motion text,
  camera_movement text,
  framing text,
  lighting text,
  environment text,
  duration_seconds numeric(5, 2),
  reference_media_id uuid,
  character_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger shots_updated before update on public.shots
  for each row execute function public.set_updated_at();

create table public.storyboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  scene_id uuid not null references public.scenes (id) on delete cascade,
  image_generation_id uuid,
  storage_path text,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Filas, gerações, histórico e consumo
-- ---------------------------------------------------------------------------
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind text not null check (kind in ('text', 'image', 'video')),
  purpose text not null,                -- ex.: character_main, character_sheet, storyboard, shot_video
  model text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress int not null default 0 check (progress between 0 and 100),
  attempts int not null default 0,
  max_attempts int not null default 4,
  request jsonb not null default '{}'::jsonb,   -- payload enviado à Agnes (sem credenciais)
  target jsonb not null default '{}'::jsonb,    -- o que fazer com o resultado
  result jsonb,
  error text,
  external_id text,                              -- video_id retornado pela Agnes
  not_before timestamptz not null default now(), -- backoff / controle de taxa
  started_at timestamptz,
  finished_at timestamptz,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index generation_jobs_user_status on public.generation_jobs (user_id, status, created_at);
create index generation_jobs_project on public.generation_jobs (project_id, created_at desc);
create trigger generation_jobs_updated before update on public.generation_jobs
  for each row execute function public.set_updated_at();

-- Registro de consumo e histórico (uma linha por tentativa concluída)
create table public.generation_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  job_id uuid references public.generation_jobs (id) on delete set null,
  kind text not null check (kind in ('text', 'image', 'video')),
  model text not null,
  status text not null check (status in ('succeeded', 'failed', 'cancelled')),
  prompt_tokens int,
  completion_tokens int,
  images_count int,
  video_seconds numeric(6, 2),
  duration_ms int,
  error text,
  created_at timestamptz not null default now()
);
create index generation_history_user_day on public.generation_history (user_id, created_at desc);

create table public.image_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  job_id uuid references public.generation_jobs (id) on delete set null,
  purpose text not null,
  prompt text not null,
  model text not null,
  storage_bucket text not null default 'media',
  storage_path text not null,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.video_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  shot_id uuid references public.shots (id) on delete set null,
  job_id uuid references public.generation_jobs (id) on delete set null,
  version int not null default 1,
  prompt text not null,
  model text not null,
  external_video_id text,
  storage_bucket text not null default 'media',
  storage_path text,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audio_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind text not null check (kind in ('narration', 'dialogue', 'music', 'sfx', 'subtitle')),
  name text not null,
  text_content text,
  voice text,
  storage_bucket text not null default 'media',
  storage_path text,
  duration_seconds numeric(8, 2),
  created_at timestamptz not null default now()
);

create table public.media_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  kind text not null check (kind in ('character', 'image', 'reference', 'storyboard', 'video', 'audio', 'subtitle')),
  name text not null,
  source text not null default 'generated' check (source in ('generated', 'upload')),
  storage_bucket text not null default 'media',
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  width int,
  height int,
  duration_seconds numeric(8, 2),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index media_library_user on public.media_library (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integridade de dono entre tabelas relacionadas
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'project_settings', 'project_versions', 'project_characters', 'scripts', 'sequences', 'scenes',
    'shots', 'storyboards', 'generation_jobs', 'generation_history', 'image_generations',
    'video_generations', 'audio_assets', 'media_library'
  ] loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.check_parent_owner(%L, %L)',
      t || '_project_owner', t, 'projects', 'project_id');
  end loop;
end $$;

create trigger character_references_owner before insert or update on public.character_references
  for each row execute function public.check_parent_owner('characters', 'character_id');
create trigger project_characters_char_owner before insert or update on public.project_characters
  for each row execute function public.check_parent_owner('characters', 'character_id');
create trigger scenes_sequence_owner before insert or update on public.scenes
  for each row execute function public.check_parent_owner('sequences', 'sequence_id');
create trigger shots_scene_owner before insert or update on public.shots
  for each row execute function public.check_parent_owner('scenes', 'scene_id');
create trigger storyboards_scene_owner before insert or update on public.storyboards
  for each row execute function public.check_parent_owner('scenes', 'scene_id');
-- Lab.AI — Row Level Security
-- Regra: cada usuário só lê/escreve linhas com user_id = auth.uid().

-- Tabelas com user_id e CRUD completo para o dono
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'project_settings', 'project_versions', 'characters', 'character_references',
    'project_characters', 'scripts', 'sequences', 'scenes', 'shots', 'storyboards',
    'image_generations', 'video_generations', 'audio_assets', 'media_library'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete', t);
  end loop;
end $$;

-- Filas e histórico: o cliente lê, mas só as Edge Functions (service role) criam/alteram.
-- Isso impede o navegador de forjar jobs, status, resultados ou consumo.
alter table public.generation_jobs enable row level security;
create policy generation_jobs_select on public.generation_jobs
  for select to authenticated using (user_id = (select auth.uid()));
-- O usuário pode apenas pedir cancelamento do próprio job (via função agnes), não por UPDATE direto.

alter table public.generation_history enable row level security;
create policy generation_history_select on public.generation_history
  for select to authenticated using (user_id = (select auth.uid()));

-- Perfil
alter table public.users enable row level security;
create policy users_select on public.users for select to authenticated using (id = (select auth.uid()));
create policy users_update on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Estilos: sistema (user_id nulo) legível por todos; personalizados só do dono
alter table public.visual_styles enable row level security;
create policy visual_styles_select on public.visual_styles
  for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy visual_styles_insert on public.visual_styles
  for insert to authenticated with check (user_id = (select auth.uid()) and is_custom = true);
create policy visual_styles_update on public.visual_styles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy visual_styles_delete on public.visual_styles
  for delete to authenticated using (user_id = (select auth.uid()));

-- Catálogo de modelos: leitura para autenticados; escrita só service role
alter table public.ai_models enable row level security;
create policy ai_models_select on public.ai_models for select to authenticated using (true);

-- Credenciais: RLS ligada, nenhuma policy e nenhum grant => inacessível ao navegador
alter table public.user_api_credentials enable row level security;
revoke all on public.user_api_credentials from anon, authenticated;

-- Escrita direta do cliente em filas/histórico/catálogo é bloqueada também por GRANT
revoke insert, update, delete on public.generation_jobs from anon, authenticated;
revoke insert, update, delete on public.generation_history from anon, authenticated;
revoke insert, update, delete on public.ai_models from anon, authenticated;
revoke all on all tables in schema public from anon;
-- Buckets privados. Convenção de caminho: <user_id>/<project_id|library>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 524288000)   -- 500 MB por arquivo
on conflict (id) do nothing;

create policy "media_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Catálogo de modelos.
-- verified = true  -> consta na documentação oficial da Agnes (catálogo de 2026-07-30).
-- verified = false -> nome citado no briefing, mas ausente do catálogo oficial; fica DESABILITADO
--                     até a descoberta via GET /v1/models (Configurações > Descobrir modelos) confirmar.
-- Presets de tamanho/duração em "capabilities" são os que o app oferece na interface; edite aqui
-- (sem rebuild) se a API aceitar outros valores. Os marcados "unverified_presets" ainda não foram
-- testados com chamadas reais.
insert into public.ai_models (kind, model_id, label, enabled, verified, capabilities, sort_order) values
('text', 'agnes-2.5-flash', 'Agnes 2.5 Flash (texto)', true, true,
  '{"streaming": true, "vision": true, "context": 512000, "max_output": 65500}', 10),

('image', 'agnes-image-2.1-flash', 'Agnes Image 2.1 Flash', true, true,
  '{"reference_images": true, "unverified_presets": true,
    "sizes": {"1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280", "4:3": "1024x768"},
    "default_size": "1024x768"}', 10),
('image', 'agnes-image-2.0-flash', 'Agnes Image 2.0 Flash (rápido)', true, true,
  '{"reference_images": true, "unverified_presets": true,
    "sizes": {"1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280", "4:3": "1024x768"},
    "default_size": "1024x768"}', 20),
('image', 'agnes-image-2.5-flash', 'Agnes Image 2.5 Flash (não confirmado)', false, false,
  '{"reference_images": true, "sizes": {"1:1": "1024x1024", "16:9": "1280x720", "9:16": "720x1280"}, "default_size": "1024x1024"}', 90),

('video', 'agnes-video-v2.0', 'Agnes Video v2.0', true, true,
  '{"image_to_video": true, "keyframes": true, "async": true, "unverified_presets": true,
    "resolutions": {"16:9": {"width": 1152, "height": 640}, "9:16": {"width": 640, "height": 1152}, "1:1": {"width": 768, "height": 768}},
    "frame_rate_options": [24],
    "num_frames_options": [49, 97, 121],
    "default_num_frames": 121, "default_frame_rate": 24,
    "known_good": {"width": 1152, "height": 768, "num_frames": 121, "frame_rate": 24}}', 10),
('video', 'agnes-video-2.5', 'Agnes Video 2.5 (não confirmado)', false, false,
  '{"image_to_video": true, "keyframes": false, "async": true,
    "resolutions": {"16:9": {"width": 1152, "height": 640}, "9:16": {"width": 640, "height": 1152}, "1:1": {"width": 768, "height": 768}},
    "frame_rate_options": [24], "num_frames_options": [121], "default_num_frames": 121, "default_frame_rate": 24}', 90),
('video', 'agnes-video-2.5-flash', 'Agnes Video 2.5 Flash (não confirmado)', false, false,
  '{"image_to_video": true, "keyframes": false, "async": true,
    "resolutions": {"16:9": {"width": 1152, "height": 640}, "9:16": {"width": 640, "height": 1152}, "1:1": {"width": 768, "height": 768}},
    "frame_rate_options": [24], "num_frames_options": [121], "default_num_frames": 121, "default_frame_rate": 24}', 91)
on conflict (model_id) do nothing;

-- Estilos visuais do sistema. "prompt_modifier" (inglês) é anexado a todo prompt de imagem/vídeo.
insert into public.visual_styles (user_id, slug, name, description, config) values
(null, 'cinema-realista', 'Cinema realista', 'Imagem natural, fotografia de longa-metragem dramático.', $j$
{"lighting":"natural motivated light, soft window light, practical lamps","photography":"35mm full-frame, shallow depth of field, subtle film grain","palette":["#2b2b2b","#8a7f72","#c9b79c","#3f5a6c"],"textures":"skin pores, fabric weave, weathered surfaces","environments":"real locations, lived-in interiors","cinematic_language":"handheld naturalism, long takes, restrained camera moves","prompt_modifier":"photorealistic cinematic film still, natural lighting, 35mm lens, shallow depth of field, subtle film grain, realistic skin and fabric textures"}$j$),
(null, 'animacao-3d', 'Animação 3D', 'CGI estilizado com materiais suaves e iluminação de estúdio.', $j$
{"lighting":"soft global illumination with rim light","photography":"virtual camera, wide-angle lens, clean depth of field","palette":["#ff9f43","#54a0ff","#5f27cd","#feca57"],"textures":"smooth subsurface materials, stylized fabric","environments":"stylized sets, clean props","cinematic_language":"expressive staging, dynamic camera swoops","prompt_modifier":"high quality 3D animated film render, stylized CGI characters, soft global illumination, rim lighting, smooth subsurface materials"}$j$),
(null, 'animacao-2d', 'Animação 2D', 'Desenho animado tradicional com contornos e cores chapadas.', $j$
{"lighting":"flat colored light with painted shadows","photography":"2D flat camera, limited parallax","palette":["#ff6b6b","#feca57","#48dbfb","#1dd1a1"],"textures":"hand-drawn lines, flat color fills","environments":"painted backgrounds","cinematic_language":"clear silhouettes, limited animation, strong poses","prompt_modifier":"2D hand-drawn animation style, clean ink outlines, flat colors, painted backgrounds, traditional cel animation look"}$j$),
(null, 'pixar-like', 'Estilo Pixar (animação 3D familiar)', 'Personagens expressivos, luz quente, enquadramento emotivo. Inspiração genérica, sem usar personagens existentes.', $j$
{"lighting":"warm key light, soft bounce, glowing practicals","photography":"cinematic virtual camera, anamorphic feel, rich depth","palette":["#f6b93b","#e55039","#4a69bd","#78e08f"],"textures":"detailed stylized skin, soft fabrics, tactile props","environments":"cozy detailed sets","cinematic_language":"emotional close-ups, gentle push-ins, expressive acting","prompt_modifier":"family-friendly 3D animated feature film look, original characters, expressive faces, warm cinematic lighting, rich detailed sets, soft subsurface scattering"}$j$),
(null, 'anime', 'Anime', 'Animação japonesa com sombreamento cel e cenários detalhados.', $j$
{"lighting":"cel-shaded with dramatic rim light and bloom","photography":"layered anime compositing, lens flare, speed lines","palette":["#ff6b9d","#54a0ff","#feca57","#2f3542"],"textures":"cel shading, detailed painted skies","environments":"detailed urban and natural backgrounds","cinematic_language":"dynamic angles, held poses, impact frames","prompt_modifier":"anime film style, cel shading, detailed painted background, dramatic lighting, expressive eyes, crisp line art"}$j$),
(null, 'manga', 'Mangá', 'Preto e branco com retículas e traços de nanquim.', $j$
{"lighting":"high contrast ink shadows","photography":"panel-style framing, dramatic angles","palette":["#111111","#f5f5f5","#7f8c8d"],"textures":"screentone dots, ink hatching","environments":"detailed linework backgrounds","cinematic_language":"panel composition, emphasis lines, dramatic close-ups","prompt_modifier":"black and white manga illustration, ink linework, screentone shading, dramatic composition, high contrast"}$j$),
(null, 'fantasia-medieval', 'Fantasia medieval', 'Reinos, castelos, magia e criaturas.', $j$
{"lighting":"torchlight, golden hour, misty volumetric light","photography":"epic wide shots, anamorphic","palette":["#6d4c41","#c9a227","#2e4a3a","#4a3b69"],"textures":"stone, leather, chainmail, aged parchment","environments":"castles, forests, taverns, mountains","cinematic_language":"sweeping establishing shots, heroic low angles","prompt_modifier":"epic medieval fantasy film still, torchlight and volumetric mist, detailed armor and leather, castle and forest environments, anamorphic lens"}$j$),
(null, 'faroeste', 'Faroeste', 'Deserto, poeira, duelos ao entardecer.', $j$
{"lighting":"harsh midday sun, golden hour, long shadows","photography":"widescreen 2.39:1 feel, extreme close-ups on eyes","palette":["#c97b3c","#e8c07d","#6b3e26","#2f3e46"],"textures":"dust, weathered wood, worn leather","environments":"desert towns, saloons, canyons","cinematic_language":"slow zooms, extreme wide shots, tense standoffs","prompt_modifier":"classic western film still, dusty desert town, harsh sunlight with long shadows, worn leather and weathered wood, widescreen cinematic framing"}$j$),
(null, 'ficcao-cientifica', 'Ficção científica', 'Futuro limpo, tecnologia, espaço.', $j$
{"lighting":"cool LED panels, lens flares, soft ambient glow","photography":"anamorphic wide, clean symmetrical framing","palette":["#0b132b","#1c7ed6","#e9ecef","#f59f00"],"textures":"brushed metal, glass, holographic surfaces","environments":"spaceships, labs, alien landscapes","cinematic_language":"symmetry, slow tracking, scale contrasts","prompt_modifier":"science fiction film still, sleek futuristic design, cool ambient lighting, anamorphic lens flares, brushed metal and glass surfaces"}$j$),
(null, 'cyberpunk', 'Cyberpunk', 'Cidade noturna, neon, chuva e alta tecnologia decadente.', $j$
{"lighting":"neon signs, wet reflections, volumetric haze","photography":"low angles, tight lenses, rain streaks","palette":["#0d0221","#ff2a6d","#05d9e8","#d1f7ff"],"textures":"wet asphalt, chrome, holographic ads","environments":"dense neon megacity, night markets","cinematic_language":"dutch angles, tracking through crowds","prompt_modifier":"cyberpunk film still, rain-soaked neon city at night, magenta and cyan lighting, wet reflections, volumetric haze, high-tech low-life"}$j$),
(null, 'terror', 'Terror', 'Atmosfera opressiva, sombras e tensão crescente.', $j$
{"lighting":"low-key, single practical source, deep shadows","photography":"wide lenses in tight spaces, static unsettling frames","palette":["#0a0a0a","#3b1f1f","#5c6b5c","#bfae9a"],"textures":"peeling paint, damp walls, fog","environments":"abandoned houses, forests at night","cinematic_language":"slow pushes, negative space, long held shots","prompt_modifier":"horror film still, low-key lighting, deep shadows, desaturated colors, oppressive atmosphere, fog, unsettling composition"}$j$),
(null, 'suspense', 'Suspense', 'Thriller psicológico, tensão contida.', $j$
{"lighting":"chiaroscuro, blinds and window shadows","photography":"controlled framing, voyeuristic long lenses","palette":["#1b1b1b","#4f6d7a","#c0b283","#7a0c0c"],"textures":"rain on glass, cigarette smoke, worn leather","environments":"offices at night, empty streets, motels","cinematic_language":"slow dolly, reflections, off-center framing","prompt_modifier":"psychological thriller film still, chiaroscuro lighting, muted cool palette, tense composition, shallow depth of field"}$j$),
(null, 'filme-historico', 'Filmes históricos', 'Épocas passadas com figurino e direção de arte fiéis.', $j$
{"lighting":"candlelight, overcast daylight, painterly","photography":"classic composition, 35mm film look","palette":["#5a4632","#a68a64","#2f3a45","#8b2d2d"],"textures":"period fabrics, hand-forged metal, aged paper","environments":"period interiors, streets, battlefields","cinematic_language":"measured camera, painterly compositions","prompt_modifier":"historical period drama film still, authentic period costumes and set design, painterly natural lighting, 35mm film look"}$j$),
(null, 'super-herois', 'Super-heróis', 'Ação em larga escala, trajes e poderes. Apenas heróis originais.', $j$
{"lighting":"high contrast with colored rim lights, energy glows","photography":"low heroic angles, dynamic wide lenses","palette":["#e63946","#1d3557","#ffb703","#f1faee"],"textures":"high-tech suits, debris, energy effects","environments":"city skylines, rooftops, battle zones","cinematic_language":"hero shots, slow-motion impacts, dynamic tracking","prompt_modifier":"blockbuster superhero film still, original hero design, dramatic rim lighting, dynamic low-angle composition, energy effects, city environment"}$j$),
(null, 'contos-de-fadas', 'Contos de fadas', 'Mundo encantado, ilustração de livro de histórias.', $j$
{"lighting":"soft magical glow, dappled forest light","photography":"storybook compositions, gentle depth","palette":["#f8c8dc","#b5ead7","#c7ceea","#ffdac1"],"textures":"watercolor washes, embroidered fabric, moss","environments":"enchanted forests, cottages, towers","cinematic_language":"gentle pans, whimsical framing","prompt_modifier":"fairy tale storybook illustration style, soft magical lighting, watercolor textures, enchanted forest, whimsical and warm"}$j$),
(null, 'stop-motion', 'Stop Motion', 'Bonecos e miniaturas com movimento quadro a quadro.', $j$
{"lighting":"miniature set lighting with warm practical lamps","photography":"macro lens, shallow focus, tactile frame stutter","palette":["#b5651d","#6b705c","#a5a58d","#cb997e"],"textures":"visible fingerprints, felt, clay, wood, wire","environments":"handmade miniature sets","cinematic_language":"deliberate camera, held poses, charming imperfections","prompt_modifier":"stop-motion animation look, handmade puppets and miniature sets, visible material textures like felt and clay, warm tabletop lighting, macro lens"}$j$),
(null, 'massinha-3d', 'Massinha 3D', 'Personagens de massa de modelar, acabamento artesanal.', $j$
{"lighting":"bright soft studio light","photography":"macro-like close framing, shallow focus","palette":["#ff6b6b","#4ecdc4","#ffe66d","#a29bfe"],"textures":"modeling clay, thumbprints, matte plasticine","environments":"colorful clay sets","cinematic_language":"playful framing, bouncy motion","prompt_modifier":"claymation plasticine characters, visible thumbprints and clay texture, bright soft studio lighting, colorful handmade clay set, macro lens"}$j$),
(null, 'documentario', 'Documentário', 'Observacional, luz disponível, câmera na mão.', $j$
{"lighting":"available light, mixed color temperatures","photography":"handheld, 24-70mm zoom feel, grab-the-moment framing","palette":["#3d3d3d","#8c7a5b","#5b7c8d","#d9d4c7"],"textures":"real locations, natural imperfections","environments":"real-world locations","cinematic_language":"observational handheld, interview framing, B-roll","prompt_modifier":"documentary film still, handheld camera feel, available natural light, candid realistic moment, slight grain"}$j$),
(null, 'hollywood', 'Cinematográfico Hollywood', 'Superprodução com iluminação polida e composição épica.', $j$
{"lighting":"polished three-point lighting, teal-and-orange grade","photography":"anamorphic 2.39:1, shallow depth, lens flares","palette":["#0f4c5c","#e36414","#fb8b24","#1b1b1e"],"textures":"high production value, pristine detail","environments":"large-scale sets and locations","cinematic_language":"crane and dolly moves, hero close-ups, epic wides","prompt_modifier":"Hollywood blockbuster cinematography, anamorphic widescreen, teal and orange color grade, polished lighting, epic composition, high production value"}$j$),
(null, 'infantil', 'Infantil', 'Colorido, amigável e seguro para crianças.', $j$
{"lighting":"bright, even and cheerful","photography":"simple clear framing, eye-level camera","palette":["#ff6b6b","#feca57","#48dbfb","#1dd1a1"],"textures":"rounded shapes, soft felt, glossy toys","environments":"playgrounds, bedrooms, gardens","cinematic_language":"slow clear action, bouncy rhythm","prompt_modifier":"children's animation style, bright cheerful colors, rounded friendly shapes, simple clear composition, soft lighting, child-safe and gentle mood"}$j$)
on conflict do nothing;
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
