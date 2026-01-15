-- 0116_storage_bucket_erp_assets.sql
-- Ensure ERP assets storage bucket exists

insert into storage.buckets (id, name, public)
values ('erp-assets', 'erp-assets', true)
on conflict (id) do nothing;
