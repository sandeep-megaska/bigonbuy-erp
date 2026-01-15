-- 0117_create_erp_assets_bucket_and_policies.sql

insert into storage.buckets (id, name, public)
values ('erp-assets', 'erp-assets', false)
on conflict (id) do nothing;

drop policy if exists "erp-assets read" on storage.objects;
create policy "erp-assets read"
on storage.objects
for select
to authenticated
using (bucket_id = 'erp-assets');

drop policy if exists "erp-assets insert" on storage.objects;
create policy "erp-assets insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'erp-assets');

drop policy if exists "erp-assets update" on storage.objects;
create policy "erp-assets update"
on storage.objects
for update
to authenticated
using (bucket_id = 'erp-assets')
with check (bucket_id = 'erp-assets');

drop policy if exists "erp-assets delete" on storage.objects;
create policy "erp-assets delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'erp-assets');
