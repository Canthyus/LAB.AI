-- Lab.AI — prévias (imagens reais) dos universos visuais, geradas pela Agnes por usuário
create table if not exists public.style_previews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  style_id uuid not null references public.visual_styles(id) on delete cascade,
  storage_path text not null,
  job_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, style_id)
);
alter table public.style_previews enable row level security;
create policy style_previews_select on public.style_previews for select using (user_id = auth.uid());
create policy style_previews_delete on public.style_previews for delete using (user_id = auth.uid());
