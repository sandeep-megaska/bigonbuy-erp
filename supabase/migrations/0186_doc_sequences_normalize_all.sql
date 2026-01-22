-- 0186_doc_sequences_normalize_all.sql
-- Normalize erp_doc_sequences legacy columns to canonical (fiscal_year, doc_key)
-- and keep legacy NOT NULL columns satisfied.
-- Safety: trigger function is GENERATED dynamically so it never references missing columns (e.g., fy_end).

DO $bb$
DECLARE
  v_cols text;

  has_doc_type boolean;
  has_fy_label boolean;
  has_fy_start boolean;
  has_fy_end boolean;
  has_updated_at boolean;

  v_fn_sql text;
  v_body text := '';
BEGIN
  -- Log current columns for debugging (shows in supabase db push output)
  SELECT string_agg(
           format('%s %s%s',
             c.column_name,
             c.data_type,
             CASE WHEN c.is_nullable='NO' THEN ' not null' ELSE '' END
           ),
           ', ' ORDER BY c.ordinal_position
         )
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema='public' AND c.table_name='erp_doc_sequences';

  RAISE NOTICE 'erp_doc_sequences columns: %', v_cols;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='erp_doc_sequences' AND column_name='doc_type'
  ) INTO has_doc_type;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='erp_doc_sequences' AND column_name='fy_label'
  ) INTO has_fy_label;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='erp_doc_sequences' AND column_name='fy_start'
  ) INTO has_fy_start;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='erp_doc_sequences' AND column_name='fy_end'
  ) INTO has_fy_end;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='erp_doc_sequences' AND column_name='updated_at'
  ) INTO has_updated_at;

  -- Backfill legacy columns to satisfy NOT NULL constraints (only if they exist)
  IF has_doc_type THEN
    EXECUTE 'UPDATE public.erp_doc_sequences SET doc_type = doc_key WHERE doc_type IS NULL';
  END IF;

  IF has_fy_label THEN
    EXECUTE 'UPDATE public.erp_doc_sequences SET fy_label = fiscal_year WHERE fy_label IS NULL';
  END IF;

  IF has_fy_start THEN
    -- Derive FY start from fiscal_year label like FY25-26 => 2025-04-01 (Indian FY).
    EXECUTE $sql$
      UPDATE public.erp_doc_sequences
         SET fy_start = make_date(2000 + substring(fiscal_year from 3 for 2)::int, 4, 1)
       WHERE fy_start IS NULL
         AND fiscal_year ~ '^FY[0-9]{2}-[0-9]{2}$'
    $sql$;
  END IF;

  IF has_fy_end THEN
    -- FY end = start + 1 year - 1 day
    EXECUTE $sql$
      UPDATE public.erp_doc_sequences
         SET fy_end = (make_date(2000 + substring(fiscal_year from 3 for 2)::int, 4, 1) + interval '1 year - 1 day')::date
       WHERE fy_end IS NULL
         AND fiscal_year ~ '^FY[0-9]{2}-[0-9]{2}$'
    $sql$;
  END IF;

  IF has_updated_at THEN
    EXECUTE 'UPDATE public.erp_doc_sequences SET updated_at = now() WHERE updated_at IS NULL';
  END IF;

  -- Build trigger body dynamically (avoid referencing missing columns)
  IF has_doc_type THEN
    v_body := v_body || E'\n  IF NEW.doc_type IS NULL THEN NEW.doc_type := NEW.doc_key; END IF;';
  END IF;

  IF has_fy_label THEN
    v_body := v_body || E'\n  IF NEW.fy_label IS NULL THEN NEW.fy_label := NEW.fiscal_year; END IF;';
    v_body := v_body || E'\n  IF NEW.fiscal_year IS NULL THEN NEW.fiscal_year := NEW.fy_label; END IF;';
  END IF;

  IF has_fy_start THEN
    v_body := v_body || E'\n  IF NEW.fy_start IS NULL AND NEW.fiscal_year ~ ''^FY[0-9]{2}-[0-9]{2}$'' THEN';
    v_body := v_body || E'\n    NEW.fy_start := make_date(2000 + substring(NEW.fiscal_year from 3 for 2)::int, 4, 1);';
    v_body := v_body || E'\n  END IF;';
  END IF;

  IF has_fy_end THEN
    v_body := v_body || E'\n  IF NEW.fy_end IS NULL AND NEW.fiscal_year ~ ''^FY[0-9]{2}-[0-9]{2}$'' THEN';
    v_body := v_body || E'\n    NEW.fy_end := (make_date(2000 + substring(NEW.fiscal_year from 3 for 2)::int, 4, 1) + interval ''1 year - 1 day'')::date;';
    v_body := v_body || E'\n  END IF;';
  END IF;

  IF has_updated_at THEN
    v_body := v_body || E'\n  IF NEW.updated_at IS NULL THEN NEW.updated_at := now(); END IF;';
  END IF;

  v_fn_sql :=
    'CREATE OR REPLACE FUNCTION public.erp_doc_sequences_sync_legacy_all() ' ||
    'RETURNS trigger LANGUAGE plpgsql AS $fn$ ' ||
    'BEGIN ' || v_body || E'\n  RETURN NEW;\nEND; $fn$;';

  EXECUTE v_fn_sql;

  -- Install trigger
  EXECUTE 'DROP TRIGGER IF EXISTS trg_erp_doc_sequences_sync_legacy_all ON public.erp_doc_sequences';
  EXECUTE 'CREATE TRIGGER trg_erp_doc_sequences_sync_legacy_all ' ||
          'BEFORE INSERT OR UPDATE ON public.erp_doc_sequences ' ||
          'FOR EACH ROW EXECUTE FUNCTION public.erp_doc_sequences_sync_legacy_all()';

  -- Helpful index for allocator lookups
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_erp_doc_sequences_company_fy_key ' ||
          'ON public.erp_doc_sequences(company_id, fiscal_year, doc_key)';
END
$bb$;
