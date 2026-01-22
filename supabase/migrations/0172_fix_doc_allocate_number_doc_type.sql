-- 0172_fix_doc_allocate_number_doc_type.sql
-- Fix erp_doc_allocate_number() to use new erp_doc_sequences schema (doc_type, fy_label, fy_start)

begin;

-- Ensure unique constraint exists for ON CONFLICT target
-- (safe if already exists)
create unique index if not exists erp_doc_sequences_company_fy_doc_type_key
  on public.erp_doc_sequences (company_id, fy_label, doc_type);

-- Drop old function (signature matters)
drop function if exists public.erp_doc_allocate_number(text, date);

create function public.erp_doc_allocate_number(p_doc_key text, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_type text := upper(trim(p_doc_key));
  v_fy_label text;
  v_fy_start date;
  v_seq int;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  -- FY starts Apr 1 (India FY)
  v_fy_start := make_date(
    case when extract(month from p_date) >= 4 then extract(year from p_date)::int else (extract(year from p_date)::int - 1) end,
    4,
    1
  );

  -- Use your existing label function, but store it in fy_label
  v_fy_label := public.erp_fiscal_year(p_date);  -- eg: FY25-26

  -- Create sequence row if missing
  insert into public.erp_doc_sequences (company_id, doc_type, fy_label, fy_start, next_seq, updated_at, fiscal_year, doc_key)
  values (v_company_id, v_doc_type, v_fy_label, v_fy_start, 1, now(), v_fy_label, v_doc_type)
  on conflict (company_id, fy_label, doc_type) do nothing;

  -- Lock row and fetch next seq
  select s.next_seq
    into v_seq
    from public.erp_doc_sequences s
    where s.company_id = v_company_id
      and s.fy_label = v_fy_label
      and s.doc_type = v_doc_type
    for update;

  -- Increment
  update public.erp_doc_sequences s
  set next_seq = s.next_seq + 1,
      updated_at = now(),
      fiscal_year = coalesce(s.fiscal_year, v_fy_label),
      doc_key = coalesce(s.doc_key, v_doc_type)
  where s.company_id = v_company_id
    and s.fy_label = v_fy_label
    and s.doc_type = v_doc_type;

  return v_fy_label || '/' || v_doc_type || '/' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.erp_doc_allocate_number(text, date) from public;
grant execute on function public.erp_doc_allocate_number(text, date) to authenticated;

commit;
