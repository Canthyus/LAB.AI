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
