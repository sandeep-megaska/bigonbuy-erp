-- 0019_fix_hr_employees_alignment.sql
-- Fix / complete employee alignment for canonical single-company ERP

ALTER TABLE public.erp_employees
  ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE public.erp_employees
   SET company_id = public.erp_current_company_id()
 WHERE company_id IS NULL;

ALTER TABLE public.erp_employees
  ALTER COLUMN company_id SET DEFAULT public.erp_current_company_id();

ALTER TABLE public.erp_employees
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.erp_employees
  ADD COLUMN IF NOT EXISTS employee_code text;

UPDATE public.erp_employees
   SET employee_code = public.erp_next_employee_code()
 WHERE employee_code IS NULL OR employee_code = '';

ALTER TABLE public.erp_employees
  ALTER COLUMN employee_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'erp_employees_company_employee_code_uk'
  ) THEN
    ALTER TABLE public.erp_employees
      ADD CONSTRAINT erp_employees_company_employee_code_uk
      UNIQUE (company_id, employee_code);
  END IF;
END $$;
