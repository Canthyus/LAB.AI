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
