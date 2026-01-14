-- Sprint-2C: leave + attendance integration enhancements

alter table public.erp_hr_leave_types
  add column if not exists allows_half_day boolean not null default false,
  add column if not exists requires_approval boolean not null default true,
  add column if not exists counts_weekly_off boolean not null default false,
  add column if not exists counts_holiday boolean not null default false,
  add column if not exists display_order int not null default 100;

alter table public.erp_hr_leave_requests
  add column if not exists submitted_at timestamptz null,
  add column if not exists cancelled_at timestamptz null,
  add column if not exists cancel_note text null,
  add column if not exists start_session text null,
  add column if not exists end_session text null,
  add column if not exists updated_by uuid null;

update public.erp_hr_leave_requests
   set status = 'submitted'
 where status = 'pending';

alter table public.erp_hr_leave_requests
  drop constraint if exists erp_hr_leave_requests_status_check;

alter table public.erp_hr_leave_requests
  add constraint erp_hr_leave_requests_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled'));

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_hr_leave_requests_date_range_check'
       and conrelid = 'public.erp_hr_leave_requests'::regclass
  ) then
    alter table public.erp_hr_leave_requests
      add constraint erp_hr_leave_requests_date_range_check
      check (date_to >= date_from);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_hr_leave_requests_start_session_check'
       and conrelid = 'public.erp_hr_leave_requests'::regclass
  ) then
    alter table public.erp_hr_leave_requests
      add constraint erp_hr_leave_requests_start_session_check
      check (start_session is null or start_session in ('full', 'half_am', 'half_pm'));
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'erp_hr_leave_requests_end_session_check'
       and conrelid = 'public.erp_hr_leave_requests'::regclass
  ) then
    alter table public.erp_hr_leave_requests
      add constraint erp_hr_leave_requests_end_session_check
      check (end_session is null or end_session in ('full', 'half_am', 'half_pm'));
  end if;
end
$$;

create table if not exists public.erp_hr_leave_request_days (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id(),
  leave_request_id uuid not null references public.erp_hr_leave_requests(id) on delete cascade,
  leave_date date not null,
  day_fraction numeric(3,2) not null default 1.0,
  is_weekly_off boolean not null default false,
  is_holiday boolean not null default false,
  created_at timestamptz not null default now(),
  constraint erp_hr_leave_request_days_company_request_date_key
    unique (company_id, leave_request_id, leave_date),
  constraint erp_hr_leave_request_days_fraction_check
    check (day_fraction in (0.5, 1.0))
);

create index if not exists erp_hr_leave_request_days_company_id_idx
  on public.erp_hr_leave_request_days (company_id);

create index if not exists erp_hr_leave_request_days_leave_request_id_idx
  on public.erp_hr_leave_request_days (leave_request_id);

create index if not exists erp_hr_leave_request_days_leave_date_idx
  on public.erp_hr_leave_request_days (leave_date);

create index if not exists erp_hr_leave_request_days_company_leave_date_idx
  on public.erp_hr_leave_request_days (company_id, leave_date);

alter table public.erp_hr_leave_request_days enable row level security;
alter table public.erp_hr_leave_request_days force row level security;

do $$
begin
  drop policy if exists erp_hr_leave_request_days_select on public.erp_hr_leave_request_days;
  drop policy if exists erp_hr_leave_request_days_write on public.erp_hr_leave_request_days;

  create policy erp_hr_leave_request_days_select
    on public.erp_hr_leave_request_days
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or public.erp_is_hr_reader(auth.uid())
        or exists (
          select 1
            from public.erp_hr_leave_requests lr
            join public.erp_employees e
              on e.id = lr.employee_id
           where lr.id = erp_hr_leave_request_days.leave_request_id
             and e.company_id = erp_hr_leave_request_days.company_id
             and e.user_id = auth.uid()
        )
        or exists (
          select 1
            from public.erp_hr_leave_requests lr
            join public.erp_employee_users eu
              on eu.employee_id = lr.employee_id
           where lr.id = erp_hr_leave_request_days.leave_request_id
             and eu.user_id = auth.uid()
             and coalesce(eu.is_active, true)
        )
      )
    );

  create policy erp_hr_leave_request_days_write
    on public.erp_hr_leave_request_days
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

-- Smoke test (manual)
-- insert into public.erp_hr_leave_request_days (leave_request_id, leave_date, day_fraction)
-- values ('00000000-0000-0000-0000-000000000000', current_date, 1.0);
-- select *
--   from public.erp_hr_leave_request_days
--  where leave_date = current_date;
