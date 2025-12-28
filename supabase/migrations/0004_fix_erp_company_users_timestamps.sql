-- Ensure timestamp columns exist on erp_company_users
ALTER TABLE public.erp_company_users
ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.erp_company_users
ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Generic trigger function to maintain updated_at
CREATE OR REPLACE FUNCTION public.erp_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Ensure trigger is present on erp_company_users
DROP TRIGGER IF EXISTS erp_set_updated_at ON public.erp_company_users;

CREATE TRIGGER erp_set_updated_at
BEFORE UPDATE ON public.erp_company_users
FOR EACH ROW
EXECUTE FUNCTION public.erp_set_updated_at();
