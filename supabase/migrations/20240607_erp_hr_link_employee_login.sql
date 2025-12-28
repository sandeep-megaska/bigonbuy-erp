-- Option B HR employee login linkage migration

-- Ensure UUID generation support
create extension if not exists "pgcrypto";

-- Company user memberships
create table if not exists public.erp_company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null references public.erp_roles (key),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint erp_company_users_company_id_user_id_key unique (company_id, user_id)
);

-- Employee login links
create table if not exists public.erp_employee_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint erp_employee_users_employee_id_key unique (employee_id),
  constraint erp_employee_users_user_id_key unique (user_id)
);

-- Optionally add foreign keys when masters are available
DO $$
BEGIN
  IF to_regclass('public.erp_companies') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.erp_company_users'::regclass
        AND conname = 'erp_company_users_company_id_fkey'
    ) THEN
      ALTER TABLE public.erp_company_users
        ADD CONSTRAINT erp_company_users_company_id_fkey
        FOREIGN KEY (company_id) REFERENCES public.erp_companies (id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.erp_employee_users'::regclass
        AND conname = 'erp_employee_users_company_id_fkey'
    ) THEN
      ALTER TABLE public.erp_employee_users
        ADD CONSTRAINT erp_employee_users_company_id_fkey
        FOREIGN KEY (company_id) REFERENCES public.erp_companies (id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF to_regclass('public.erp_employees') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.erp_employee_users'::regclass
        AND conname = 'erp_employee_users_employee_id_fkey'
    ) THEN
      ALTER TABLE public.erp_employee_users
        ADD CONSTRAINT erp_employee_users_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.erp_employees (id) ON DELETE CASCADE;
    END IF;
  END IF;
END
$$;

-- RLS enforcement
alter table public.erp_company_users enable row level security;
alter table public.erp_company_users force row level security;

alter table public.erp_employee_users enable row level security;
alter table public.erp_employee_users force row level security;

-- Restrict write access; only RPC/service paths should mutate
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'erp_company_users' AND p.policyname IN (
      'erp_company_users_insert_admins',
      'erp_company_users_update_admins',
      'erp_company_users_delete_admins'
    )
  ) THEN
    DROP POLICY IF EXISTS erp_company_users_insert_admins ON public.erp_company_users;
    DROP POLICY IF EXISTS erp_company_users_update_admins ON public.erp_company_users;
    DROP POLICY IF EXISTS erp_company_users_delete_admins ON public.erp_company_users;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'erp_employee_users' AND p.policyname IN (
      'erp_employee_users_insert_admins',
      'erp_employee_users_update_admins',
      'erp_employee_users_delete_admins'
    )
  ) THEN
    DROP POLICY IF EXISTS erp_employee_users_insert_admins ON public.erp_employee_users;
    DROP POLICY IF EXISTS erp_employee_users_update_admins ON public.erp_employee_users;
    DROP POLICY IF EXISTS erp_employee_users_delete_admins ON public.erp_employee_users;
  END IF;
END
$$;

-- Authenticated members can read their company records
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'erp_company_users' AND p.policyname = 'erp_company_users_select_members'
  ) THEN
    CREATE POLICY erp_company_users_select_members
      ON public.erp_company_users
      FOR SELECT
      USING (
        auth.role() = 'service_role'
        OR EXISTS (
          SELECT 1
          FROM public.erp_company_users cu
          WHERE cu.company_id = erp_company_users.company_id
            AND cu.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'erp_employee_users' AND p.policyname = 'erp_employee_users_select_members'
  ) THEN
    CREATE POLICY erp_employee_users_select_members
      ON public.erp_employee_users
      FOR SELECT
      USING (
        auth.role() = 'service_role'
        OR EXISTS (
          SELECT 1
          FROM public.erp_company_users cu
          WHERE cu.company_id = erp_employee_users.company_id
            AND cu.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Seed required roles
insert into public.erp_roles (key, name) values
  ('owner', 'Owner'),
  ('admin', 'Administrator'),
  ('hr', 'HR Manager'),
  ('employee', 'Employee')
on conflict (key) do nothing;

-- RPC to link employee login
CREATE OR REPLACE FUNCTION public.erp_link_employee_login(
  p_company_id uuid,
  p_employee_id uuid,
  p_auth_user_id uuid,
  p_employee_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_user_id uuid;
  v_company_user_id uuid;
  v_constraint_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.erp_company_users cu
    WHERE cu.company_id = p_company_id
      AND cu.user_id = auth.uid()
      AND cu.role_key IN ('owner', 'admin', 'hr')
  ) THEN
    RAISE EXCEPTION 'Forbidden: requires owner/admin/hr for company';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.erp_roles r WHERE r.key = 'employee'
  ) THEN
    RAISE EXCEPTION 'Missing role: create employee role in HR Roles module';
  END IF;

  BEGIN
    INSERT INTO public.erp_employee_users (company_id, employee_id, user_id, email)
    VALUES (p_company_id, p_employee_id, p_auth_user_id, p_employee_email)
    ON CONFLICT (employee_id) DO UPDATE
      SET company_id = EXCLUDED.company_id,
          user_id = EXCLUDED.user_id,
          email = EXCLUDED.email,
          updated_at = now()
    RETURNING id INTO v_employee_user_id;

    INSERT INTO public.erp_company_users (company_id, user_id, role_key)
    VALUES (p_company_id, p_auth_user_id, 'employee')
    ON CONFLICT (company_id, user_id) DO UPDATE
      SET role_key = EXCLUDED.role_key,
          updated_at = now()
    RETURNING id INTO v_company_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'employee_user_map_id', v_employee_user_id,
      'company_user_id', v_company_user_id
    );
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name = 'erp_employee_users_user_id_key' THEN
        RAISE EXCEPTION 'Conflict: auth user already linked to another employee';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.erp_link_employee_login(uuid, uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.erp_link_employee_login(uuid, uuid, uuid, text) TO authenticated;
