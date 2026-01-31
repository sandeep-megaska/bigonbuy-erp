-- 0340_ap_vendor_bills_core.sql
-- Vendor bills on GST purchase invoices + AP posting config + GRN links

alter table public.erp_gst_purchase_invoices
  add column if not exists due_date date,
  add column if not exists po_id uuid null references public.erp_purchase_orders (id) on delete set null,
  add column if not exists grn_id uuid null references public.erp_grns (id) on delete set null,
  add column if not exists subtotal numeric not null default 0,
  add column if not exists gst_total numeric not null default 0,
  add column if not exists total numeric not null default 0,
  add column if not exists tds_section text null,
  add column if not exists tds_rate numeric(6,4) null,
  add column if not exists tds_amount numeric not null default 0,
  add column if not exists net_payable numeric not null default 0,
  add column if not exists status text not null default 'draft',
  add column if not exists finance_journal_id uuid null references public.erp_fin_journals (id);

alter table public.erp_gst_purchase_invoices
  drop constraint if exists erp_gst_purchase_invoices_status_check;

alter table public.erp_gst_purchase_invoices
  add constraint erp_gst_purchase_invoices_status_check
  check (status in ('draft', 'approved', 'posted', 'void'));

create unique index if not exists erp_gst_purchase_invoices_company_vendor_bill_no_key
  on public.erp_gst_purchase_invoices (company_id, vendor_id, invoice_no)
  where is_void = false;

alter table public.erp_gst_purchase_invoice_lines
  add column if not exists variant_id uuid null references public.erp_variants (id) on delete set null,
  add column if not exists unit_rate numeric null,
  add column if not exists gst_rate numeric null,
  add column if not exists line_amount numeric null;

create index if not exists erp_gst_purchase_invoice_lines_variant_idx
  on public.erp_gst_purchase_invoice_lines (company_id, variant_id);

create table if not exists public.erp_ap_vendor_bill_grn_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  bill_id uuid not null references public.erp_gst_purchase_invoices (id) on delete restrict,
  grn_id uuid not null references public.erp_grns (id) on delete restrict,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create unique index if not exists erp_ap_vendor_bill_grn_links_unique_active
  on public.erp_ap_vendor_bill_grn_links (company_id, bill_id, grn_id)
  where is_void = false;

create index if not exists erp_ap_vendor_bill_grn_links_company_bill_idx
  on public.erp_ap_vendor_bill_grn_links (company_id, bill_id);

alter table public.erp_ap_vendor_bill_grn_links enable row level security;
alter table public.erp_ap_vendor_bill_grn_links force row level security;

do $$
begin
  drop policy if exists erp_ap_vendor_bill_grn_links_select on public.erp_ap_vendor_bill_grn_links;
  drop policy if exists erp_ap_vendor_bill_grn_links_write on public.erp_ap_vendor_bill_grn_links;

  create policy erp_ap_vendor_bill_grn_links_select
    on public.erp_ap_vendor_bill_grn_links
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_ap_vendor_bill_grn_links_write
    on public.erp_ap_vendor_bill_grn_links
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
            and cu.role_key in ('owner', 'admin', 'finance')
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end $$;

create table if not exists public.erp_vendor_tds_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  vendor_id uuid not null references public.erp_vendors (id) on delete restrict,
  tds_section text not null,
  tds_rate numeric(6,4) not null,
  threshold_amount numeric null,
  effective_from date not null,
  effective_to date null,
  is_void boolean not null default false,
  void_reason text null,
  voided_at timestamptz null,
  voided_by uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid()
);

create index if not exists erp_vendor_tds_profiles_company_vendor_idx
  on public.erp_vendor_tds_profiles (company_id, vendor_id, effective_from desc);

alter table public.erp_vendor_tds_profiles enable row level security;
alter table public.erp_vendor_tds_profiles force row level security;

do $$
begin
  drop policy if exists erp_vendor_tds_profiles_select on public.erp_vendor_tds_profiles;
  drop policy if exists erp_vendor_tds_profiles_write on public.erp_vendor_tds_profiles;

  create policy erp_vendor_tds_profiles_select
    on public.erp_vendor_tds_profiles
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_vendor_tds_profiles_write
    on public.erp_vendor_tds_profiles
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
            and cu.role_key in ('owner', 'admin', 'finance')
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end $$;

create table if not exists public.erp_ap_finance_posting_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  inventory_account_id uuid not null references public.erp_gl_accounts (id),
  gst_input_account_id uuid not null references public.erp_gl_accounts (id),
  vendor_payable_account_id uuid not null references public.erp_gl_accounts (id),
  tds_payable_account_id uuid null references public.erp_gl_accounts (id),
  vendor_advances_account_id uuid null references public.erp_gl_accounts (id),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  constraint erp_ap_finance_posting_config_company_unique unique (company_id)
);

alter table public.erp_ap_finance_posting_config enable row level security;
alter table public.erp_ap_finance_posting_config force row level security;

do $$
begin
  drop policy if exists erp_ap_finance_posting_config_select on public.erp_ap_finance_posting_config;
  drop policy if exists erp_ap_finance_posting_config_write on public.erp_ap_finance_posting_config;

  create policy erp_ap_finance_posting_config_select
    on public.erp_ap_finance_posting_config
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );

  create policy erp_ap_finance_posting_config_write
    on public.erp_ap_finance_posting_config
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
            and cu.role_key in ('owner', 'admin', 'finance')
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
            and cu.role_key in ('owner', 'admin', 'finance')
        )
      )
    );
end $$;

create or replace function public.erp_ap_finance_posting_config_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.erp_ap_finance_posting_config;
begin
  perform public.erp_require_finance_reader();

  select *
    into v_row
    from public.erp_ap_finance_posting_config c
    where c.company_id = public.erp_current_company_id();

  return jsonb_build_object(
    'inventory_account_id', v_row.inventory_account_id,
    'gst_input_account_id', v_row.gst_input_account_id,
    'vendor_payable_account_id', v_row.vendor_payable_account_id,
    'tds_payable_account_id', v_row.tds_payable_account_id,
    'vendor_advances_account_id', v_row.vendor_advances_account_id
  );
end;
$$;

revoke all on function public.erp_ap_finance_posting_config_get() from public;
grant execute on function public.erp_ap_finance_posting_config_get() to authenticated;

create or replace function public.erp_ap_finance_posting_config_upsert(
  p_inventory_account_id uuid,
  p_gst_input_account_id uuid,
  p_vendor_payable_account_id uuid,
  p_tds_payable_account_id uuid default null,
  p_vendor_advances_account_id uuid default null,
  p_updated_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_row public.erp_ap_finance_posting_config;
begin
  perform public.erp_require_finance_writer();

  insert into public.erp_ap_finance_posting_config (
    company_id,
    inventory_account_id,
    gst_input_account_id,
    vendor_payable_account_id,
    tds_payable_account_id,
    vendor_advances_account_id,
    created_by,
    updated_by
  ) values (
    v_company_id,
    p_inventory_account_id,
    p_gst_input_account_id,
    p_vendor_payable_account_id,
    p_tds_payable_account_id,
    p_vendor_advances_account_id,
    coalesce(p_updated_by, v_actor),
    coalesce(p_updated_by, v_actor)
  )
  on conflict (company_id)
  do update set
    inventory_account_id = excluded.inventory_account_id,
    gst_input_account_id = excluded.gst_input_account_id,
    vendor_payable_account_id = excluded.vendor_payable_account_id,
    tds_payable_account_id = excluded.tds_payable_account_id,
    vendor_advances_account_id = excluded.vendor_advances_account_id,
    updated_at = now(),
    updated_by = coalesce(p_updated_by, v_actor)
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id
  );
end;
$$;

revoke all on function public.erp_ap_finance_posting_config_upsert(uuid, uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function public.erp_ap_finance_posting_config_upsert(uuid, uuid, uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.erp_ap_finance_posting_config_seed_minimal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_inventory_id uuid;
  v_gst_input_id uuid;
  v_vendor_payable_id uuid;
  v_tds_payable_id uuid;
  v_vendor_advances_id uuid;
  v_inserted int := 0;
begin
  perform public.erp_require_finance_writer();

  with seed_rows as (
    select * from (
      values
        ('1301', 'Inventory', 'asset', 'debit'),
        ('1401', 'Input GST', 'asset', 'debit'),
        ('2102', 'Vendor Payable', 'liability', 'credit'),
        ('2103', 'TDS Payable', 'liability', 'credit'),
        ('1201', 'Vendor Advances', 'asset', 'debit')
    ) as v(code, name, account_type, normal_balance)
  ),
  inserted as (
    insert into public.erp_gl_accounts (
      company_id,
      code,
      name,
      account_type,
      normal_balance,
      is_active,
      created_by_user_id,
      updated_by_user_id
    )
    select
      v_company_id,
      s.code,
      s.name,
      s.account_type,
      s.normal_balance,
      true,
      v_actor,
      v_actor
    from seed_rows s
    on conflict (company_id, code) do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  select id into v_inventory_id from public.erp_gl_accounts
    where company_id = v_company_id and code = '1301';
  select id into v_gst_input_id from public.erp_gl_accounts
    where company_id = v_company_id and code = '1401';
  select id into v_vendor_payable_id from public.erp_gl_accounts
    where company_id = v_company_id and code = '2102';
  select id into v_tds_payable_id from public.erp_gl_accounts
    where company_id = v_company_id and code = '2103';
  select id into v_vendor_advances_id from public.erp_gl_accounts
    where company_id = v_company_id and code = '1201';

  if v_inventory_id is null or v_gst_input_id is null or v_vendor_payable_id is null then
    raise exception 'Required AP GL accounts missing';
  end if;

  perform public.erp_ap_finance_posting_config_upsert(
    v_inventory_id,
    v_gst_input_id,
    v_vendor_payable_id,
    v_tds_payable_id,
    v_vendor_advances_id,
    v_actor
  );

  return jsonb_build_object(
    'inserted', v_inserted
  );
end;
$$;

revoke all on function public.erp_ap_finance_posting_config_seed_minimal() from public;
grant execute on function public.erp_ap_finance_posting_config_seed_minimal() to authenticated;

create or replace function public.erp_ap_vendor_bill_upsert(p_bill jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_bill_id uuid;
  v_status text;
  v_vendor_id uuid := nullif(p_bill->>'vendor_id', '')::uuid;
  v_bill_no text := nullif(trim(coalesce(p_bill->>'bill_no', p_bill->>'invoice_no', '')), '');
  v_bill_date date := coalesce(nullif(p_bill->>'bill_date', '')::date, nullif(p_bill->>'invoice_date', '')::date, current_date);
  v_due_date date := nullif(p_bill->>'due_date', '')::date;
  v_vendor_gstin text := nullif(trim(coalesce(p_bill->>'vendor_gstin', '')), '');
  v_place_of_supply text := nullif(trim(coalesce(p_bill->>'place_of_supply_state_code', '')), '');
  v_po_id uuid := nullif(p_bill->>'po_id', '')::uuid;
  v_grn_id uuid := nullif(p_bill->>'grn_id', '')::uuid;
  v_note text := nullif(trim(coalesce(p_bill->>'note', '')), '');
  v_tds_section text := nullif(trim(coalesce(p_bill->>'tds_section', '')), '');
  v_tds_rate numeric := nullif(p_bill->>'tds_rate', '')::numeric;
  v_actor uuid := auth.uid();
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_vendor_id is null then
    raise exception 'vendor_id is required';
  end if;

  if v_bill_no is null then
    raise exception 'bill_no is required';
  end if;

  if (p_bill ? 'id') and nullif(p_bill->>'id', '') is not null then
    v_bill_id := (p_bill->>'id')::uuid;

    select status
      into v_status
      from public.erp_gst_purchase_invoices
      where id = v_bill_id
        and company_id = v_company_id
      for update;

    if not found then
      raise exception 'Vendor bill not found';
    end if;

    if v_status not in ('draft', 'approved') then
      raise exception 'Only draft/approved bills can be edited';
    end if;

    update public.erp_gst_purchase_invoices
       set vendor_id = v_vendor_id,
           invoice_no = v_bill_no,
           invoice_date = v_bill_date,
           due_date = v_due_date,
           vendor_gstin = v_vendor_gstin,
           place_of_supply_state_code = v_place_of_supply,
           po_id = v_po_id,
           grn_id = v_grn_id,
           note = v_note,
           tds_section = v_tds_section,
           tds_rate = v_tds_rate,
           updated_at = now(),
           updated_by = v_actor
     where id = v_bill_id
       and company_id = v_company_id
    returning id into v_bill_id;
  else
    insert into public.erp_gst_purchase_invoices (
      company_id,
      vendor_id,
      invoice_no,
      invoice_date,
      due_date,
      vendor_gstin,
      vendor_state_code,
      place_of_supply_state_code,
      note,
      source,
      po_id,
      grn_id,
      tds_section,
      tds_rate,
      status,
      created_by,
      updated_by
    ) values (
      v_company_id,
      v_vendor_id,
      v_bill_no,
      v_bill_date,
      v_due_date,
      v_vendor_gstin,
      public.erp_vendor_state_code_from_gstin(v_vendor_gstin),
      v_place_of_supply,
      v_note,
      'manual_entry',
      v_po_id,
      v_grn_id,
      v_tds_section,
      v_tds_rate,
      'draft',
      v_actor,
      v_actor
    ) returning id into v_bill_id;
  end if;

  return v_bill_id;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_upsert(jsonb) from public;
grant execute on function public.erp_ap_vendor_bill_upsert(jsonb) to authenticated;

create or replace function public.erp_ap_vendor_bill_line_upsert(p_line jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_line_id uuid;
  v_invoice_id uuid := nullif(p_line->>'bill_id', '')::uuid;
  v_line_no int := coalesce(nullif(p_line->>'line_no', '')::int, 1);
  v_variant_id uuid := nullif(p_line->>'variant_id', '')::uuid;
  v_description text := nullif(p_line->>'description', '');
  v_hsn text := nullif(p_line->>'hsn', '');
  v_qty numeric := coalesce(nullif(p_line->>'qty', '')::numeric, 0);
  v_unit_rate numeric := coalesce(nullif(p_line->>'unit_rate', '')::numeric, 0);
  v_line_amount numeric := coalesce(nullif(p_line->>'line_amount', '')::numeric, v_qty * v_unit_rate);
  v_taxable_value numeric := coalesce(nullif(p_line->>'taxable_value', '')::numeric, v_line_amount);
  v_gst_rate numeric := nullif(p_line->>'gst_rate', '')::numeric;
  v_cgst numeric := coalesce(nullif(p_line->>'cgst', '')::numeric, 0);
  v_sgst numeric := coalesce(nullif(p_line->>'sgst', '')::numeric, 0);
  v_igst numeric := coalesce(nullif(p_line->>'igst', '')::numeric, 0);
  v_cess numeric := coalesce(nullif(p_line->>'cess', '')::numeric, 0);
  v_itc_eligible boolean := coalesce(nullif(p_line->>'itc_eligible', '')::boolean, true);
  v_itc_reason text := nullif(p_line->>'itc_reason', '');
  v_status text;
  v_actor uuid := auth.uid();
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if v_invoice_id is null then
    raise exception 'bill_id is required';
  end if;

  select status
    into v_status
    from public.erp_gst_purchase_invoices
    where id = v_invoice_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Vendor bill not found';
  end if;

  if v_status not in ('draft', 'approved') then
    raise exception 'Only draft/approved bills can be edited';
  end if;

  if (p_line ? 'id') and nullif(p_line->>'id', '') is not null then
    v_line_id := (p_line->>'id')::uuid;

    update public.erp_gst_purchase_invoice_lines
       set line_no = v_line_no,
           variant_id = v_variant_id,
           description = v_description,
           hsn = coalesce(v_hsn, hsn),
           qty = v_qty,
           unit_rate = v_unit_rate,
           line_amount = v_line_amount,
           taxable_value = v_taxable_value,
           gst_rate = v_gst_rate,
           cgst = v_cgst,
           sgst = v_sgst,
           igst = v_igst,
           cess = v_cess,
           itc_eligible = v_itc_eligible,
           itc_reason = v_itc_reason,
           updated_at = now(),
           updated_by = v_actor
     where id = v_line_id
       and invoice_id = v_invoice_id
    returning id into v_line_id;

    if v_line_id is null then
      raise exception 'Vendor bill line not found';
    end if;
  else
    select id
      into v_line_id
      from public.erp_gst_purchase_invoice_lines
      where invoice_id = v_invoice_id
        and line_no = v_line_no
        and company_id = v_company_id
        and is_void = false;

    if v_line_id is null then
      insert into public.erp_gst_purchase_invoice_lines (
        company_id,
        invoice_id,
        line_no,
        variant_id,
        description,
        hsn,
        qty,
        uom,
        taxable_value,
        cgst,
        sgst,
        igst,
        cess,
        itc_eligible,
        itc_reason,
        unit_rate,
        gst_rate,
        line_amount,
        created_by,
        updated_by
      ) values (
        v_company_id,
        v_invoice_id,
        v_line_no,
        v_variant_id,
        v_description,
        coalesce(v_hsn, 'NA'),
        v_qty,
        null,
        v_taxable_value,
        v_cgst,
        v_sgst,
        v_igst,
        v_cess,
        v_itc_eligible,
        v_itc_reason,
        v_unit_rate,
        v_gst_rate,
        v_line_amount,
        v_actor,
        v_actor
      ) returning id into v_line_id;
    else
      update public.erp_gst_purchase_invoice_lines
         set variant_id = v_variant_id,
             description = v_description,
             hsn = coalesce(v_hsn, hsn),
             qty = v_qty,
             unit_rate = v_unit_rate,
             line_amount = v_line_amount,
             taxable_value = v_taxable_value,
             gst_rate = v_gst_rate,
             cgst = v_cgst,
             sgst = v_sgst,
             igst = v_igst,
             cess = v_cess,
             itc_eligible = v_itc_eligible,
             itc_reason = v_itc_reason,
             updated_at = now(),
             updated_by = v_actor
       where id = v_line_id
      returning id into v_line_id;
    end if;
  end if;

  return v_line_id;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_line_upsert(jsonb) from public;
grant execute on function public.erp_ap_vendor_bill_line_upsert(jsonb) to authenticated;

create or replace function public.erp_ap_vendor_bill_line_void(
  p_line_id uuid,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_invoice_id uuid;
  v_status text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.erp_require_finance_writer();

  select invoice_id
    into v_invoice_id
    from public.erp_gst_purchase_invoice_lines
    where id = p_line_id
      and company_id = v_company_id
      and is_void = false;

  if v_invoice_id is null then
    raise exception 'Vendor bill line not found';
  end if;

  select status
    into v_status
    from public.erp_gst_purchase_invoices
    where id = v_invoice_id
      and company_id = v_company_id
    for update;

  if v_status not in ('draft', 'approved') then
    raise exception 'Only draft/approved bills can be edited';
  end if;

  update public.erp_gst_purchase_invoice_lines
     set is_void = true,
         void_reason = v_reason,
         voided_at = now(),
         voided_by = v_actor,
         updated_at = now(),
         updated_by = v_actor
   where id = p_line_id
     and company_id = v_company_id;

  return true;
end;
$$;

revoke all on function public.erp_ap_vendor_bill_line_void(uuid, text) from public;
grant execute on function public.erp_ap_vendor_bill_line_void(uuid, text) to authenticated;

create or replace function public.erp_ap_vendor_bills_list(
  p_from date,
  p_to date,
  p_vendor_id uuid default null,
  p_status text default null,
  p_q text default null,
  p_limit int default 50,
  p_offset int default 0
) returns table (
  bill_id uuid,
  bill_no text,
  bill_date date,
  vendor_id uuid,
  vendor_name text,
  total numeric,
  tds_amount numeric,
  net_payable numeric,
  status text,
  is_void boolean,
  posted_doc_no text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  return query
  select
    i.id as bill_id,
    i.invoice_no as bill_no,
    i.invoice_date as bill_date,
    i.vendor_id,
    v.legal_name as vendor_name,
    i.total,
    i.tds_amount,
    i.net_payable,
    i.status,
    i.is_void,
    j.doc_no as posted_doc_no
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v
    on v.id = i.vendor_id
    and v.company_id = i.company_id
  left join public.erp_fin_journals j
    on j.id = i.finance_journal_id
    and j.company_id = i.company_id
  where i.company_id = v_company_id
    and i.invoice_date between p_from and p_to
    and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    and (p_status is null or i.status = p_status)
    and (
      p_q is null
      or btrim(p_q) = ''
      or coalesce(i.invoice_no, '') ilike ('%' || p_q || '%')
      or coalesce(v.legal_name, '') ilike ('%' || p_q || '%')
    )
  order by i.invoice_date desc, i.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.erp_ap_vendor_bills_list(date, date, uuid, text, text, int, int) from public;
grant execute on function public.erp_ap_vendor_bills_list(date, date, uuid, text, text, int, int) to authenticated;

create or replace function public.erp_ap_vendor_bill_detail(
  p_bill_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_header jsonb;
  v_lines jsonb;
begin
  perform public.erp_require_finance_reader();

  select jsonb_build_object(
    'id', i.id,
    'bill_no', i.invoice_no,
    'bill_date', i.invoice_date,
    'due_date', i.due_date,
    'vendor_id', i.vendor_id,
    'vendor_name', v.legal_name,
    'vendor_gstin', i.vendor_gstin,
    'place_of_supply_state_code', i.place_of_supply_state_code,
    'po_id', i.po_id,
    'grn_id', i.grn_id,
    'note', i.note,
    'subtotal', i.subtotal,
    'gst_total', i.gst_total,
    'total', i.total,
    'tds_section', i.tds_section,
    'tds_rate', i.tds_rate,
    'tds_amount', i.tds_amount,
    'net_payable', i.net_payable,
    'status', i.status,
    'finance_journal_id', i.finance_journal_id,
    'is_void', i.is_void,
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into v_header
  from public.erp_gst_purchase_invoices i
  join public.erp_vendors v on v.id = i.vendor_id
  where i.company_id = v_company_id
    and i.id = p_bill_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', l.id,
        'line_no', l.line_no,
        'variant_id', l.variant_id,
        'description', l.description,
        'hsn', l.hsn,
        'qty', l.qty,
        'unit_rate', l.unit_rate,
        'line_amount', l.line_amount,
        'taxable_value', l.taxable_value,
        'gst_rate', l.gst_rate,
        'cgst', l.cgst,
        'sgst', l.sgst,
        'igst', l.igst,
        'cess', l.cess,
        'total_tax', l.total_tax,
        'line_total', l.line_total,
        'itc_eligible', l.itc_eligible,
        'itc_reason', l.itc_reason,
        'is_void', l.is_void
      )
      order by l.line_no
    ),
    '[]'::jsonb
  )
  into v_lines
  from public.erp_gst_purchase_invoice_lines l
  where l.company_id = v_company_id
    and l.invoice_id = p_bill_id
    and l.is_void = false;

  return jsonb_build_object(
    'header', v_header,
    'lines', v_lines
  );
end;
$$;

revoke all on function public.erp_ap_vendor_bill_detail(uuid) from public;
grant execute on function public.erp_ap_vendor_bill_detail(uuid) to authenticated;

create or replace function public.erp_ap_vendor_bill_post_preview(
  p_bill_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_bill record;
  v_config record;
  v_inventory record;
  v_gst_input record;
  v_vendor_payable record;
  v_tds_payable record;
  v_subtotal numeric := 0;
  v_gst_total numeric := 0;
  v_total numeric := 0;
  v_tds_section text := null;
  v_tds_rate numeric := 0;
  v_tds_amount numeric := 0;
  v_net_payable numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_received_source text := null;
  v_has_links boolean := false;
  v_invalid_qty boolean := false;
  v_missing_variant boolean := false;
  v_vendor_mismatch boolean := false;
  v_bill_qty record;
  v_received_qty numeric;
  v_grn_ids uuid[] := '{}';
  v_po_vendor_id uuid;
begin
  perform public.erp_require_finance_reader();

  select i.*, v.legal_name as vendor_name
    into v_bill
    from public.erp_gst_purchase_invoices i
    join public.erp_vendors v on v.id = i.vendor_id
    where i.company_id = v_company_id
      and i.id = p_bill_id;

  if v_bill.id is null then
    return jsonb_build_object('errors', jsonb_build_array('Vendor bill not found'), 'can_post', false);
  end if;

  select
    coalesce(sum(l.taxable_value), 0) as subtotal,
    coalesce(sum(l.cgst + l.sgst + l.igst + l.cess), 0) as gst_total
  into v_subtotal, v_gst_total
  from public.erp_gst_purchase_invoice_lines l
  where l.company_id = v_company_id
    and l.invoice_id = v_bill.id
    and l.is_void = false;

  v_total := round(v_subtotal + v_gst_total, 2);

  if v_bill.tds_rate is not null then
    v_tds_rate := v_bill.tds_rate;
    v_tds_section := v_bill.tds_section;
  else
    select t.tds_section, t.tds_rate
      into v_tds_section, v_tds_rate
      from public.erp_vendor_tds_profiles t
      where t.company_id = v_company_id
        and t.vendor_id = v_bill.vendor_id
        and t.is_void = false
        and t.effective_from <= coalesce(v_bill.invoice_date, current_date)
        and (t.effective_to is null or t.effective_to >= coalesce(v_bill.invoice_date, current_date))
      order by t.effective_from desc
      limit 1;
  end if;

  v_tds_rate := coalesce(v_tds_rate, 0);
  v_tds_amount := round(v_subtotal * v_tds_rate / 100, 2);
  v_net_payable := round(v_total - v_tds_amount, 2);

  select c.* into v_config
    from public.erp_ap_finance_posting_config c
    where c.company_id = v_company_id;

  if v_config.company_id is null then
    v_errors := v_errors || jsonb_build_array('AP posting config missing');
  else
    select id, code, name into v_inventory
      from public.erp_gl_accounts a
      where a.id = v_config.inventory_account_id;
    select id, code, name into v_gst_input
      from public.erp_gl_accounts a
      where a.id = v_config.gst_input_account_id;
    select id, code, name into v_vendor_payable
      from public.erp_gl_accounts a
      where a.id = v_config.vendor_payable_account_id;
    if v_config.tds_payable_account_id is not null then
      select id, code, name into v_tds_payable
        from public.erp_gl_accounts a
        where a.id = v_config.tds_payable_account_id;
    end if;
  end if;

  if v_inventory.id is null or v_gst_input.id is null or v_vendor_payable.id is null then
    v_errors := v_errors || jsonb_build_array('AP posting accounts missing');
  end if;

  if v_tds_amount > 0 and v_tds_payable.id is null then
    v_errors := v_errors || jsonb_build_array('TDS payable account missing');
  end if;

  if v_bill.po_id is not null then
    v_has_links := true;
    select vendor_id
      into v_po_vendor_id
      from public.erp_purchase_orders
      where id = v_bill.po_id
        and company_id = v_company_id;
    if v_po_vendor_id is null then
      v_errors := v_errors || jsonb_build_array('Linked PO not found');
    elsif v_po_vendor_id <> v_bill.vendor_id then
      v_vendor_mismatch := true;
    end if;
  end if;

  select array_agg(grn_id)
    into v_grn_ids
    from public.erp_ap_vendor_bill_grn_links
    where company_id = v_company_id
      and bill_id = v_bill.id
      and is_void = false;

  if v_bill.grn_id is not null then
    v_grn_ids := array_append(coalesce(v_grn_ids, '{}'), v_bill.grn_id);
  end if;

  if array_length(v_grn_ids, 1) is not null then
    v_has_links := true;
    v_received_source := 'grn';
    if exists (
      select 1
      from public.erp_grns g
      join public.erp_purchase_orders po
        on po.id = g.purchase_order_id
       and po.company_id = g.company_id
      where g.company_id = v_company_id
        and g.id = any (v_grn_ids)
        and po.vendor_id <> v_bill.vendor_id
    ) then
      v_vendor_mismatch := true;
    end if;
  elsif v_bill.po_id is not null then
    v_received_source := 'po';
  end if;

  if v_vendor_mismatch then
    v_errors := v_errors || jsonb_build_array('Vendor mismatch with linked PO/GRN');
  end if;

  if v_has_links then
    if exists (
      select 1
      from public.erp_gst_purchase_invoice_lines l
      where l.company_id = v_company_id
        and l.invoice_id = v_bill.id
        and l.is_void = false
        and l.variant_id is null
    ) then
      v_missing_variant := true;
    end if;

    for v_bill_qty in
      select l.variant_id, coalesce(sum(l.qty), 0) as bill_qty
      from public.erp_gst_purchase_invoice_lines l
      where l.company_id = v_company_id
        and l.invoice_id = v_bill.id
        and l.is_void = false
        and l.variant_id is not null
      group by l.variant_id
    loop
      if v_received_source = 'grn' then
        select coalesce(sum(gl.received_qty), 0)
          into v_received_qty
          from public.erp_grn_lines gl
          where gl.company_id = v_company_id
            and gl.grn_id = any (v_grn_ids)
            and gl.variant_id = v_bill_qty.variant_id;
      else
        select coalesce(sum(pol.received_qty), 0)
          into v_received_qty
          from public.erp_purchase_order_lines pol
          where pol.company_id = v_company_id
            and pol.purchase_order_id = v_bill.po_id
            and pol.variant_id = v_bill_qty.variant_id;
      end if;

      if v_bill_qty.bill_qty > coalesce(v_received_qty, 0) then
        v_invalid_qty := true;
      end if;
    end loop;

    if v_missing_variant then
      v_errors := v_errors || jsonb_build_array('Variant is required for 3-way match');
    end if;

    if v_invalid_qty then
      v_errors := v_errors || jsonb_build_array('Bill quantities exceed received quantities');
    end if;
  end if;

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'memo', 'Inventory purchases',
      'amount', v_subtotal,
      'account_id', v_inventory.id,
      'account_code', v_inventory.code,
      'account_name', v_inventory.name,
      'debit', v_subtotal,
      'credit', 0
    )
  );

  if v_gst_total > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'Input GST',
        'amount', v_gst_total,
        'account_id', v_gst_input.id,
        'account_code', v_gst_input.code,
        'account_name', v_gst_input.name,
        'debit', v_gst_total,
        'credit', 0
      )
    );
  end if;

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'memo', 'Vendor payable',
      'amount', v_net_payable,
      'account_id', v_vendor_payable.id,
      'account_code', v_vendor_payable.code,
      'account_name', v_vendor_payable.name,
      'debit', 0,
      'credit', v_net_payable
    )
  );

  if v_tds_amount > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'memo', 'TDS payable',
        'amount', v_tds_amount,
        'account_id', v_tds_payable.id,
        'account_code', v_tds_payable.code,
        'account_name', v_tds_payable.name,
        'debit', 0,
        'credit', v_tds_amount
      )
    );
  end if;

  return jsonb_build_object(
    'totals', jsonb_build_object(
      'subtotal', v_subtotal,
      'gst_total', v_gst_total,
      'total', v_total,
    'tds_section', v_tds_section,
    'tds_rate', v_tds_rate,
      'tds_amount', v_tds_amount,
      'net_payable', v_net_payable
    ),
    'journal_lines', v_lines,
    'errors', v_errors,
    'can_post', jsonb_array_length(v_errors) = 0
  );
end;
$$;

revoke all on function public.erp_ap_vendor_bill_post_preview(uuid) from public;
grant execute on function public.erp_ap_vendor_bill_post_preview(uuid) to authenticated;

create or replace function public.erp_ap_vendor_bill_post(
  p_bill_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_bill record;
  v_preview jsonb;
  v_errors jsonb;
  v_totals jsonb;
  v_lines jsonb;
  v_journal_id uuid;
  v_doc_no text;
  v_line jsonb;
  v_line_no int := 1;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_tds_section text;
  v_tds_rate numeric;
  v_tds_amount numeric;
  v_net_payable numeric;
  v_subtotal numeric;
  v_gst_total numeric;
  v_total numeric;
  v_posted_doc text;
begin
  perform public.erp_require_finance_writer();

  select i.*, j.doc_no as posted_doc
    into v_bill
    from public.erp_gst_purchase_invoices i
    left join public.erp_fin_journals j
      on j.id = i.finance_journal_id
     and j.company_id = i.company_id
    where i.company_id = v_company_id
      and i.id = p_bill_id
    for update;

  if v_bill.id is null then
    raise exception 'Vendor bill not found';
  end if;

  if v_bill.is_void then
    raise exception 'Vendor bill is void';
  end if;

  if v_bill.finance_journal_id is not null then
    return jsonb_build_object(
      'journal_id', v_bill.finance_journal_id,
      'doc_no', v_bill.posted_doc
    );
  end if;

  v_preview := public.erp_ap_vendor_bill_post_preview(p_bill_id);
  v_errors := coalesce(v_preview->'errors', '[]'::jsonb);

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'Posting blocked: %', v_errors::text;
  end if;

  v_totals := v_preview->'totals';
  v_lines := v_preview->'journal_lines';

  v_subtotal := coalesce((v_totals->>'subtotal')::numeric, 0);
  v_gst_total := coalesce((v_totals->>'gst_total')::numeric, 0);
  v_total := coalesce((v_totals->>'total')::numeric, 0);
  v_tds_section := nullif(v_totals->>'tds_section', '');
  v_tds_rate := coalesce((v_totals->>'tds_rate')::numeric, 0);
  v_tds_amount := coalesce((v_totals->>'tds_amount')::numeric, 0);
  v_net_payable := coalesce((v_totals->>'net_payable')::numeric, 0);

  insert into public.erp_fin_journals (
    company_id,
    journal_date,
    status,
    narration,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) values (
    v_company_id,
    v_bill.invoice_date,
    'posted',
    format('Vendor bill %s', v_bill.invoice_no),
    'vendor_bill',
    v_bill.id,
    0,
    0,
    v_actor
  ) returning id into v_journal_id;

  for v_line in
    select * from jsonb_array_elements(v_lines)
  loop
    insert into public.erp_fin_journal_lines (
      company_id,
      journal_id,
      line_no,
      account_code,
      account_name,
      description,
      debit,
      credit
    ) values (
      v_company_id,
      v_journal_id,
      v_line_no,
      v_line->>'account_code',
      v_line->>'account_name',
      v_line->>'memo',
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0)
    );

    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
    v_line_no := v_line_no + 1;
  end loop;

  if v_total_debit <> v_total_credit then
    raise exception 'Journal totals must be balanced';
  end if;

  update public.erp_fin_journals
  set total_debit = v_total_debit,
      total_credit = v_total_credit
  where id = v_journal_id
    and company_id = v_company_id;

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  update public.erp_gst_purchase_invoices
     set finance_journal_id = v_journal_id,
         status = 'posted',
         subtotal = v_subtotal,
         gst_total = v_gst_total,
         total = v_total,
         tds_section = coalesce(v_tds_section, tds_section),
         tds_rate = v_tds_rate,
         tds_amount = v_tds_amount,
         net_payable = v_net_payable,
         updated_at = now(),
         updated_by = v_actor
   where id = v_bill.id
     and company_id = v_company_id;

  return jsonb_build_object(
    'journal_id', v_journal_id,
    'doc_no', v_doc_no
  );
end;
$$;

revoke all on function public.erp_ap_vendor_bill_post(uuid) from public;
grant execute on function public.erp_ap_vendor_bill_post(uuid) to authenticated;

create or replace function public.erp_ap_invoices_outstanding_list(
  p_vendor_id uuid,
  p_from date,
  p_to date,
  p_q text,
  p_limit int,
  p_offset int
)
returns table (
  invoice_id uuid,
  vendor_id uuid,
  vendor_name text,
  invoice_no text,
  invoice_date date,
  invoice_total numeric,
  allocated_total numeric,
  outstanding_amount numeric,
  currency text,
  source text,
  validation_status text,
  is_void boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  return query
  with allocations as (
    select
      a.invoice_id,
      a.company_id,
      coalesce(sum(a.allocated_amount), 0) as allocated_total
    from public.erp_ap_vendor_payment_allocations a
    where a.company_id = v_company_id
      and a.is_void = false
    group by a.invoice_id, a.company_id
  )
  select
    i.id as invoice_id,
    i.vendor_id,
    v.legal_name as vendor_name,
    i.invoice_no,
    i.invoice_date,
    coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) as invoice_total,
    coalesce(a.allocated_total, 0) as allocated_total,
    greatest(
      coalesce(i.net_payable, i.computed_invoice_total, i.computed_taxable + i.computed_total_tax) - coalesce(a.allocated_total, 0),
      0
    ) as outstanding_amount,
    coalesce(i.currency, 'INR') as currency,
    i.source,
    i.validation_status,
    i.is_void
  from public.erp_gst_purchase_invoices i
  left join public.erp_vendors v
    on v.id = i.vendor_id
    and v.company_id = i.company_id
  left join allocations a
    on a.invoice_id = i.id
    and a.company_id = i.company_id
  where i.company_id = v_company_id
    and (p_vendor_id is null or i.vendor_id = p_vendor_id)
    and (p_from is null or i.invoice_date >= p_from)
    and (p_to is null or i.invoice_date <= p_to)
    and (
      p_q is null
      or btrim(p_q) = ''
      or coalesce(i.invoice_no, '') ilike ('%' || p_q || '%')
      or coalesce(i.note, '') ilike ('%' || p_q || '%')
      or coalesce(i.source_ref, '') ilike ('%' || p_q || '%')
      or coalesce(v.legal_name, '') ilike ('%' || p_q || '%')
    )
  order by i.invoice_date desc, i.created_at desc
  limit p_limit
  offset p_offset;
end;
$$;

revoke all on function public.erp_ap_invoices_outstanding_list(uuid, date, date, text, int, int) from public;
grant execute on function public.erp_ap_invoices_outstanding_list(uuid, date, date, text, int, int) to authenticated;
