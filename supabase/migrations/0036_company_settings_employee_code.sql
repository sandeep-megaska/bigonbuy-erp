-- Company settings, counters, and BB-prefixed employee codes
create table if not exists public.erp_company_settings (
  company_id uuid primary key references public.erp_companies (id) on delete cascade,
  employee_code_prefix text not null default 'BB',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create table if not exists public.erp_company_counters (
  company_id uuid primary key references public.erp_companies (id) on delete cascade,
  employee_code_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.erp_company_settings (company_id, created_by, updated_by)
select c.id,
       coalesce(
         (select cu.user_id
            from public.erp_company_users cu
           where cu.company_id = c.id
             and cu.role_key = 'owner'
           limit 1),
         auth.uid(),
         '00000000-0000-0000-0000-000000000000'::uuid
       ),
       coalesce(
         (select cu.user_id
            from public.erp_company_users cu
           where cu.company_id = c.id
             and cu.role_key = 'owner'
           limit 1),
         auth.uid(),
         '00000000-0000-0000-0000-000000000000'::uuid
       )
from public.erp_companies c
on conflict (company_id) do nothing;

create or replace function public.erp_next_employee_code(p_company_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(p_company_id, public.erp_current_company_id());
  v_seq bigint;
  v_prefix text;
begin
  if v_company_id is null then
    raise exception 'company_id is required';
  end if;

  insert into public.erp_company_counters (company_id, employee_code_seq, updated_at)
  values (v_company_id, 1, now())
  on conflict (company_id)
  do update set employee_code_seq = public.erp_company_counters.employee_code_seq + 1,
                updated_at = now()
  returning employee_code_seq into v_seq;

  select employee_code_prefix
    into v_prefix
    from public.erp_company_settings
   where company_id = v_company_id;

  v_prefix := coalesce(nullif(trim(v_prefix), ''), 'BB');

  return v_prefix || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.erp_next_employee_code()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select public.erp_next_employee_code(public.erp_current_company_id())
$$;

revoke all on function public.erp_next_employee_code(uuid) from public;
grant execute on function public.erp_next_employee_code(uuid) to authenticated;

revoke all on function public.erp_next_employee_code() from public;
grant execute on function public.erp_next_employee_code() to authenticated;

-- Normalize existing employee codes to BB000001 format when possible
update public.erp_employees
   set employee_code = 'BB' || lpad(nullif(regexp_replace(employee_code, '\\D', '', 'g'), '')::text, 6, '0')
 where employee_code is not null
   and employee_code <> ''
   and employee_code !~ '^BB[0-9]{6}$'
   and nullif(regexp_replace(employee_code, '\\D', '', 'g'), '') is not null;

update public.erp_employees
   set employee_code = public.erp_next_employee_code(company_id)
 where employee_code is null
    or employee_code = '';

insert into public.erp_company_counters (company_id, employee_code_seq, updated_at)
select e.company_id,
       coalesce(
  max(nullif(regexp_replace(e.employee_code, '[^0-9]', '', 'g'), '')::bigint),
  0
),

       now()
  from public.erp_employees e
 where e.company_id is not null
 group by e.company_id
on conflict (company_id)
  do update set employee_code_seq = greatest(public.erp_company_counters.employee_code_seq, excluded.employee_code_seq),
                updated_at = now();

-- Ensure employee code trigger uses new generator
create or replace function public.erp_employees_set_code()
returns trigger
language plpgsql
as $$
begin
  if new.employee_code is null or new.employee_code = '' then
    new.employee_code := public.erp_next_employee_code(new.company_id);
  end if;
  return new;
end;
$$;

drop trigger if exists erp_employees_set_code on public.erp_employees;
create trigger erp_employees_set_code
before insert on public.erp_employees
for each row
execute function public.erp_employees_set_code();

-- RLS
alter table public.erp_company_settings enable row level security;
alter table public.erp_company_settings force row level security;

alter table public.erp_company_counters enable row level security;
alter table public.erp_company_counters force row level security;

do $$
begin
  drop policy if exists erp_company_settings_select on public.erp_company_settings;
  drop policy if exists erp_company_settings_write on public.erp_company_settings;
  drop policy if exists erp_company_counters_select on public.erp_company_counters;
  drop policy if exists erp_company_counters_write on public.erp_company_counters;

  create policy erp_company_settings_select
    on public.erp_company_settings
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_company_settings_write
    on public.erp_company_settings
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_company_counters_select
    on public.erp_company_counters
    for select
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    );

  create policy erp_company_counters_write
    on public.erp_company_counters
    for all
    using (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    )
    with check (
      company_id = public.erp_current_company_id()
      and (
        auth.role() = 'service_role'
        or exists (
          select 1
          from public.erp_company_users cu
          where cu.company_id = public.erp_current_company_id()
            and cu.user_id = auth.uid()
            and coalesce(cu.is_active, true)
            and cu.role_key in ('owner', 'admin')
        )
      )
    );
end
$$;

notify pgrst, 'reload schema';
