-- 0105_fix_attendance_period_month_column.sql
-- Fix: attendance period column is "month" (not month_start)

-- Index fix (if any older code attempted month_start index)
drop index if exists public.erp_hr_attendance_periods_company_month_idx;

create index if not exists erp_hr_attendance_periods_company_month_idx
  on public.erp_hr_attendance_periods (company_id, month);

-- Period frozen helper (must use month)
create or replace function public.erp_attendance_period_is_frozen(p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.erp_hr_attendance_periods p
    where p.company_id = public.erp_current_company_id()
      and p.month = date_trunc('month', p_day)::date
      and p.status = 'frozen'
  );
$$;

-- Freeze month
create or replace function public.erp_attendance_freeze_month(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  -- Add your existing HR/admin gate here if your repo uses it:
  -- perform public.erp_require_hr_writer();

  insert into public.erp_hr_attendance_periods (company_id, month, status, created_at, updated_at)
  values (public.erp_current_company_id(), v_month, 'open', now(), now())
  on conflict (company_id, month) do nothing;

  update public.erp_hr_attendance_periods
  set status = 'frozen',
      frozen_at = now(),
      frozen_by = auth.uid(),
      updated_at = now()
  where company_id = public.erp_current_company_id()
    and month = v_month;
end;
$$;

-- Unfreeze month
create or replace function public.erp_attendance_unfreeze_month(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  -- Add your owner/admin gate here if your repo uses it

  update public.erp_hr_attendance_periods
  set status = 'open',
      frozen_at = null,
      frozen_by = null,
      updated_at = now()
  where company_id = public.erp_current_company_id()
    and month = v_month;
end;
$$;
