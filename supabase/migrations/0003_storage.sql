-- Buckets privados. Convenção de caminho: <user_id>/<project_id|library>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)   -- 50 MB por arquivo (limite do plano gratuito)
on conflict (id) do nothing;

create policy "media_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
