-- Enforce FY-based global document numbering and disable legacy generators

create or replace function public.erp_doc_no_is_valid(p_doc_no text, p_doc_key text default null)
returns boolean
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_doc_no text := trim(coalesce(p_doc_no, ''));
  v_doc_key text := upper(trim(coalesce(p_doc_key, '')));
  v_pattern text;
begin
  if v_doc_no = '' then
    return false;
  end if;

  if v_doc_key = '' then
    return v_doc_no ~ '^FY\d{2}-\d{2}/[A-Z0-9_-]+/\d{6}$';
  end if;

  v_pattern := '^FY\d{2}-\d{2}/' || regexp_replace(v_doc_key, '[^A-Z0-9_-]', '', 'g') || '/\d{6}$';
  return v_doc_no ~ v_pattern;
end;
$$;

revoke all on function public.erp_doc_no_is_valid(text, text) from public;
grant execute on function public.erp_doc_no_is_valid(text, text) to authenticated;

drop function if exists public.erp_doc_allocate_number(text, date);

create or replace function public.erp_doc_allocate_number(p_doc_id uuid, p_doc_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_key text := upper(trim(p_doc_key));
  v_doc_date date;
  v_fiscal_year text;
  v_seq int;
begin
  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_doc_id is null then
    raise exception 'doc_id is required';
  end if;

  if v_doc_key = '' then
    raise exception 'doc_key is required';
  end if;

  case v_doc_key
    when 'PO' then
      select order_date
        into v_doc_date
        from public.erp_purchase_orders
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Purchase order not found';
      end if;
    when 'GRN' then
      select received_at::date
        into v_doc_date
        from public.erp_grns
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'GRN not found';
      end if;
    when 'CN', 'DN' then
      select note_date
        into v_doc_date
        from public.erp_notes
        where id = p_doc_id
          and company_id = v_company_id;
      if not found then
        raise exception 'Note not found';
      end if;
    else
      raise exception 'Unsupported document key: %', v_doc_key;
  end case;

  if v_doc_date is null then
    v_doc_date := current_date;
  end if;

  v_fiscal_year := public.erp_fiscal_year(v_doc_date);

  insert into public.erp_doc_sequences (company_id, fiscal_year, doc_key, next_seq)
  values (v_company_id, v_fiscal_year, v_doc_key, 1)
  on conflict (company_id, fiscal_year, doc_key) do nothing;

  select next_seq
    into v_seq
    from public.erp_doc_sequences
    where company_id = v_company_id
      and fiscal_year = v_fiscal_year
      and doc_key = v_doc_key
    for update;

  update public.erp_doc_sequences
  set next_seq = next_seq + 1
  where company_id = v_company_id
    and fiscal_year = v_fiscal_year
    and doc_key = v_doc_key;

  return v_fiscal_year || '/' || v_doc_key || '/' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.erp_doc_allocate_number(uuid, text) from public;
grant execute on function public.erp_doc_allocate_number(uuid, text) to authenticated;

create or replace function public.erp_note_allocate_number(p_note_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_doc_no text;
  v_note_kind text;
  v_doc_key text;
  v_note_date date;
  v_fiscal_year text;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select note_number, note_kind, note_date
    into v_doc_no, v_note_kind, v_note_date
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_doc_no is not null then
    return v_doc_no;
  end if;

  v_doc_key := case v_note_kind
    when 'credit' then 'CN'
    when 'debit' then 'DN'
    else 'NT'
  end;

  v_doc_no := public.erp_doc_allocate_number(p_note_id, v_doc_key);
  v_fiscal_year := public.erp_fiscal_year(coalesce(v_note_date, current_date));

  update public.erp_notes
  set
    doc_no = coalesce(doc_no, v_doc_no),
    note_number = coalesce(note_number, v_doc_no),
    note_no = coalesce(note_no, v_doc_no),
    fiscal_year = coalesce(fiscal_year, v_fiscal_year),
    updated_at = now()
  where id = p_note_id
    and note_number is null;

  return v_doc_no;
end;
$$;

revoke all on function public.erp_note_allocate_number(uuid) from public;
grant execute on function public.erp_note_allocate_number(uuid) to authenticated;

create or replace function public.erp_note_approve(p_note_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_status text;
  v_note_number text;
  v_note_kind text;
  v_note_date date;
  v_doc_key text;
  v_fiscal_year text;
  v_exists boolean;
begin
  perform public.erp_require_finance_writer();

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  select status, note_number, note_kind, note_date
    into v_status, v_note_number, v_note_kind, v_note_date
    from public.erp_notes
    where id = p_note_id
      and company_id = v_company_id
    for update;

  if not found then
    raise exception 'Note not found';
  end if;

  if v_status = 'approved' then
    return v_note_number;
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft notes can be approved';
  end if;

  v_doc_key := case v_note_kind
    when 'credit' then 'CN'
    when 'debit' then 'DN'
    else 'NT'
  end;

  if v_note_number is null then
    v_note_number := public.erp_note_allocate_number(p_note_id);
    v_fiscal_year := public.erp_fiscal_year(coalesce(v_note_date, current_date));

    update public.erp_notes
    set
      note_number = v_note_number,
      note_no = coalesce(note_no, v_note_number),
      doc_no = coalesce(doc_no, v_note_number),
      fiscal_year = coalesce(fiscal_year, v_fiscal_year),
      updated_at = now()
    where id = p_note_id
      and note_number is null;
  end if;

  if not public.erp_doc_no_is_valid(v_note_number, v_doc_key) then
    raise exception 'Invalid note number format. Expected FYxx-xx/%/000001', v_doc_key;
  end if;

  select exists(
    select 1
    from public.erp_notes n
    where n.company_id = v_company_id
      and n.note_number = v_note_number
      and n.id <> p_note_id
  ) into v_exists;

  if v_exists then
    raise exception 'Note number already in use';
  end if;

  update public.erp_notes
  set
    status = 'approved',
    approved_at = now(),
    approved_by = auth.uid(),
    updated_at = now()
  where id = p_note_id;

  return v_note_number;
end;
$$;

revoke all on function public.erp_note_approve(uuid) from public;
grant execute on function public.erp_note_approve(uuid) to authenticated;

create or replace function public.erp_proc_po_approve(p_po_id uuid)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_status text;
  v_doc_no text;
  v_order_date date;
  v_exists boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select po.company_id, po.status, po.doc_no, po.order_date
    into v_company_id, v_status, v_doc_no, v_order_date
    from public.erp_purchase_orders po
    where po.id = p_po_id
    for update;

  if v_company_id is null then
    raise exception 'Purchase order not found';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'procurement')
  ) then
    raise exception 'Not authorized';
  end if;

  if v_status <> 'draft' then
    raise exception 'Purchase order is not in draft status';
  end if;

  if v_doc_no is null or v_doc_no = '' then
    v_doc_no := public.erp_doc_allocate_number(p_po_id, 'PO');
  end if;

  if not public.erp_doc_no_is_valid(v_doc_no, 'PO') then
    raise exception 'Invalid PO number format. Expected FYxx-xx/PO/000001';
  end if;

  select exists(
    select 1
    from public.erp_purchase_orders po
    where po.company_id = v_company_id
      and po.doc_no = v_doc_no
      and po.id <> p_po_id
  ) into v_exists;

  if v_exists then
    raise exception 'PO number already in use';
  end if;

  update public.erp_purchase_orders as po
     set status = 'approved',
         doc_no = v_doc_no,
         po_no = coalesce(po.po_no, v_doc_no),
         updated_at = now()
   where po.id = p_po_id
     and po.company_id = v_company_id;

  return query
  select po.id, po.status
  from public.erp_purchase_orders po
  where po.id = p_po_id;
end;
$$;

revoke all on function public.erp_proc_po_approve(uuid) from public;
grant execute on function public.erp_proc_po_approve(uuid) to authenticated;

create or replace function public.erp_post_grn(p_grn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_grn record;
  v_grn_no text;
  v_exists boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_grn_id is null then
    raise exception 'grn_id is required';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = public.erp_current_company_id()
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin')
  ) then
    raise exception 'Only owner/admin can post GRNs';
  end if;

  select * into v_grn
    from public.erp_grns
   where id = p_grn_id
  for update;

  if v_grn.id is null then
    raise exception 'GRN not found';
  end if;

  if v_grn.status <> 'draft' then
    raise exception 'Only draft GRNs can be posted';
  end if;

  if exists (
    select 1
      from public.erp_grn_lines gl
     where gl.grn_id = p_grn_id
       and gl.received_qty > 0
       and exists (
        select 1
          from public.erp_purchase_order_lines pol
         where pol.id = gl.purchase_order_line_id
           and (coalesce(pol.received_qty, 0) + gl.received_qty > pol.ordered_qty)
       )
  ) then
    raise exception 'GRN quantities exceed ordered quantities';
  end if;

  if not exists (
    select 1
    from public.erp_grn_lines gl
    where gl.grn_id = p_grn_id
  ) then
    raise exception 'GRN has no lines to post';
  end if;

  insert into public.erp_inventory_ledger (
    company_id,
    warehouse_id,
    variant_id,
    qty_in,
    qty_out,
    unit_cost,
    entry_type,
    reference,
    created_by
  )
  select
    gl.company_id,
    gl.warehouse_id,
    gl.variant_id,
    gl.received_qty,
    0,
    gl.unit_cost,
    'grn_in',
    'GRN Receipt',
    'GRN:' || p_grn_id::text,
    v_actor
  from public.erp_grn_lines gl
  where gl.grn_id = p_grn_id;

  update public.erp_purchase_order_lines pol
     set received_qty = coalesce(pol.received_qty, 0) + gl.received_qty,
         updated_at = now()
    from public.erp_grn_lines gl
   where gl.grn_id = p_grn_id
     and pol.id = gl.purchase_order_line_id;

  update public.erp_purchase_orders po
     set status = case
                    when (
                      select count(*)
                      from public.erp_purchase_order_lines pol
                      where pol.purchase_order_id = po.id
                        and coalesce(pol.received_qty, 0) < pol.ordered_qty
                    ) = 0 then 'received'
                    when po.status = 'approved' then 'partially_received'
                    else po.status
                  end,
         updated_at = now()
   where po.id = v_grn.purchase_order_id;

  v_grn_no := coalesce(v_grn.grn_no, public.erp_doc_allocate_number(p_grn_id, 'GRN'));

  if not public.erp_doc_no_is_valid(v_grn_no, 'GRN') then
    raise exception 'Invalid GRN number format. Expected FYxx-xx/GRN/000001';
  end if;

  select exists(
    select 1
    from public.erp_grns g
    where g.company_id = v_grn.company_id
      and g.grn_no = v_grn_no
      and g.id <> p_grn_id
  ) into v_exists;

  if v_exists then
    raise exception 'GRN number already in use';
  end if;

  update public.erp_grns
     set status = 'posted',
         grn_no = v_grn_no,
         received_at = now(),
         updated_at = now()
   where id = p_grn_id;

  return jsonb_build_object('status', 'posted', 'grn_id', p_grn_id);
end;
$$;

revoke all on function public.erp_post_grn(uuid) from public;
grant execute on function public.erp_post_grn(uuid) to authenticated;

create or replace function public.erp_next_document_number(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Legacy document numbering is disabled. Use erp_doc_allocate_number instead.';
end;
$$;

revoke all on function public.erp_next_document_number(text) from public;
grant execute on function public.erp_next_document_number(text) to authenticated;

create or replace function public.erp_next_doc_no(p_doc_type text, p_for_date date default current_date)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Legacy document numbering is disabled. Use erp_doc_allocate_number instead.';
end;
$$;

revoke all on function public.erp_next_doc_no(text, date) from public;
grant execute on function public.erp_next_doc_no(text, date) to authenticated;

create or replace function public.erp_next_grn_no(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Legacy GRN numbering is disabled. Use erp_doc_allocate_number instead.';
end;
$$;

create or replace function public.erp_next_grn_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Legacy GRN numbering is disabled. Use erp_doc_allocate_number instead.';
end;
$$;

revoke all on function public.erp_next_grn_no(uuid) from public;
revoke all on function public.erp_next_grn_no() from public;
grant execute on function public.erp_next_grn_no(uuid) to authenticated;
grant execute on function public.erp_next_grn_no() to authenticated;
