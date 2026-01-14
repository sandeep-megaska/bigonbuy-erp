-- 0080_add_salary_structures_audit_cols.sql
-- Add audit columns expected by RPC/UI

begin;

alter table public.erp_salary_structures
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid;

-- backfill created_by if you want (optional; safe no-op)
-- update public.erp_salary_structures set created_by = auth.uid() where created_by is null;

commit;
