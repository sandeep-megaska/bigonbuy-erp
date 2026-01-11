-- Employee job effective-dated table + current job view
create table if not exists public.erp_employee_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  employee_id uuid not null references public.erp_employees (id) on delete cascade,
  effective_from date not null default current_date,
  effective_to date null,
  manager_employee_id uuid null references public.erp_employees (id) on delete set null,
  department_id uuid null references public.erp_hr_departments (id) on delete set null,
  designation_id uuid null references public.erp_hr_designations (id) on delete set null,
  grade_id uuid null references public.erp_hr_grades (id) on delete set null,
  location_id uuid null references public.erp_hr_locations (id) on delete set null,
  cost_center_id uuid null references public.erp_hr_cost_centers (id) on delete set null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'erp_employee_jobs_effective_check'
      and conrelid = 'public.erp_employee_jobs'::regclass
  ) then
    alter table public.erp_employee_jobs
      add constraint erp_employee_jobs_effective_check
      check (effective_to is null or effective_to >= effective_from);
  end if;
end
$$;

create index if not exists erp_employee_jobs_employee_effective_idx
  on public.erp_employee_jobs (employee_id, effective_from desc);

create or replace view public.erp_employee_current_jobs as
select distinct on (j.employee_id)
  j.id,
  j.company_id,
  j.employee_id,
  j.effective_from,
  j.effective_to,
  j.manager_employee_id,
  j.department_id,
  j.designation_id,
  j.grade_id,
  j.location_id,
  j.cost_center_id,
  j.notes,
  j.created_at,
  j.created_by,
  j.updated_at,
  j.updated_by
from public.erp_employee_jobs j
where j.effective_from <= current_date
  and (j.effective_to is null or j.effective_to >= current_date)
order by j.employee_id, j.effective_from desc, j.created_at desc;

-- updated_at trigger helper
create or replace function public.erp_hr_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists erp_employee_jobs_set_updated on public.erp_employee_jobs;
create trigger erp_employee_jobs_set_updated
before update on public.erp_employee_jobs
for each row
execute function public.erp_hr_set_updated();

-- RLS
alter table public.erp_employee_jobs enable row level security;
alter table public.erp_employee_jobs force row level security;

do $$
begin
  drop policy if exists erp_employee_jobs_select on public.erp_employee_jobs;
  drop policy if exists erp_employee_jobs_write on public.erp_employee_jobs;

  create policy erp_employee_jobs_select
    on public.erp_employee_jobs
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_admin(auth.uid())
        or exists (
          select 1
          from public.erp_employees e
          where e.id = employee_id
            and e.company_id = public.erp_current_company_id()
            and e.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.erp_employee_users eu
          where eu.employee_id = employee_id
            and eu.user_id = auth.uid()
            and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_employee_jobs_write
    on public.erp_employee_jobs
    for all
    using (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    )
    with check (
      company_id = public.erp_current_company_id()
      and (auth.role() = 'service_role' or public.erp_is_hr_admin(auth.uid()))
    );
end
$$;

notify pgrst, 'reload schema';
