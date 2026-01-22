-- 0200_fix_gmail_sync_service_role.sql
-- Purpose:
-- Gmail sync runs from server using service_role, so auth.uid() is NULL.
-- Existing RPCs call erp_require_finance_writer() which raises "Not authenticated".
-- Fix: add a service-aware gate and patch only Gmail ingestion-related RPCs to use it.

-- 1) Add new service-aware finance writer gate
create or replace function public.erp_require_finance_writer_or_service()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow server-side integrations that run with service_role
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return;
  end if;

  -- Otherwise enforce normal human user permission
  perform public.erp_require_finance_writer();
end;
$$;

grant execute on function public.erp_require_finance_writer_or_service() to authenticated;
grant execute on function public.erp_require_finance_writer_or_service() to service_role;


-- 2) Patch ONLY these 4 functions by rewriting their source:
--    - erp_email_ingest_batch_create_or_get
--    - erp_email_ingest_batch_mark
--    - erp_settlement_batch_create
--    - erp_settlement_event_insert
--
-- We do not need to know their exact signatures. We fetch the current function DDL
-- and replace the permission check line, then re-create them.

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'erp_email_ingest_batch_create_or_get',
        'erp_email_ingest_batch_mark',
        'erp_settlement_batch_create',
        'erp_settlement_event_insert'
      )
  loop
    v_def := pg_get_functiondef(r.oid);

    -- Replace either schema-qualified or unqualified perform call
    v_new := v_def;

    v_new := regexp_replace(
      v_new,
      E'perform\\s+public\\.erp_require_finance_writer\\(\\)\\s*;\\s*',
      E'perform public.erp_require_finance_writer_or_service();\n',
      'g'
    );

    v_new := regexp_replace(
      v_new,
      E'perform\\s+erp_require_finance_writer\\(\\)\\s*;\\s*',
      E'perform public.erp_require_finance_writer_or_service();\n',
      'g'
    );

    if v_new = v_def then
      raise notice 'No change needed or pattern not found in %.%', r.nspname, r.proname;
    else
      execute v_new;
      raise notice 'Patched function %.%', r.nspname, r.proname;
    end if;
  end loop;
end $$;

-- Re-grant execute just to be safe (harmless if already granted)
do $$
begin
  begin
    grant execute on function public.erp_email_ingest_batch_create_or_get to authenticated;
  exception when others then null;
  end;

  begin
    grant execute on function public.erp_email_ingest_batch_mark to authenticated;
  exception when others then null;
  end;

  begin
    grant execute on function public.erp_settlement_batch_create to authenticated;
  exception when others then null;
  end;

  begin
    grant execute on function public.erp_settlement_event_insert to authenticated;
  exception when others then null;
  end;
end $$;
