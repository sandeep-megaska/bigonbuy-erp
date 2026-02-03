-- Expense -> Finance bridge (journals + posting tracking)

create table if not exists public.erp_expense_finance_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.erp_current_company_id() references public.erp_companies (id) on delete cascade,
  expense_id uuid not null references public.erp_expenses (id) on delete restrict,
  finance_doc_type text not null,
  finance_doc_id uuid not null,
  status text not null default 'posted',
  posted_at timestamptz not null default now(),
  posted_by_user_id uuid null,
  meta jsonb not null default '{}'::jsonb,
  idempotency_key uuid null,
  constraint erp_expense_finance_posts_status_check check (status in ('posted', 'void'))
);

alter table public.erp_expense_categories
  add column if not exists expense_account_code text null;

alter table public.erp_company_settings
  add column if not exists default_expense_account_code text null;

create unique index if not exists erp_expense_finance_posts_company_expense_key
  on public.erp_expense_finance_posts (company_id, expense_id);

create unique index if not exists erp_expense_finance_posts_company_idempotency_key
  on public.erp_expense_finance_posts (company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists erp_expense_finance_posts_company_doc_idx
  on public.erp_expense_finance_posts (company_id, finance_doc_type, finance_doc_id);

alter table public.erp_expense_finance_posts enable row level security;
alter table public.erp_expense_finance_posts force row level security;

do $$
begin
  drop policy if exists erp_expense_finance_posts_select on public.erp_expense_finance_posts;
  drop policy if exists erp_expense_finance_posts_write on public.erp_expense_finance_posts;

  create policy erp_expense_finance_posts_select
    on public.erp_expense_finance_posts
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

  create policy erp_expense_finance_posts_write
    on public.erp_expense_finance_posts
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
end;
$$;

create or replace function public.erp_expense_finance_posting_get(
  p_expense_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.erp_current_company_id();
  v_post record;
  v_doc_no text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.erp_company_users cu
    where cu.company_id = v_company_id
      and cu.user_id = v_actor
      and coalesce(cu.is_active, true)
      and cu.role_key in ('owner', 'admin', 'finance')
  ) then
    raise exception 'Not authorized';
  end if;

  select p.*, j.doc_no
    into v_post
    from public.erp_expense_finance_posts p
    left join public.erp_fin_journals j
      on j.id = p.finance_doc_id
     and j.company_id = v_company_id
    where p.company_id = v_company_id
      and p.expense_id = p_expense_id;

  if v_post.id is null then
    return jsonb_build_object('posted', false);
  end if;

  v_doc_no := v_post.doc_no;

  return jsonb_build_object(
    'posted', true,
    'finance_doc_id', v_post.finance_doc_id,
    'finance_doc_type', v_post.finance_doc_type,
    'posted_at', v_post.posted_at,
    'posted_by_user_id', v_post.posted_by_user_id,
    'journal_no', v_doc_no,
    'link', format('/erp/finance/journals/%s', v_post.finance_doc_id)
  );
end;
$$;

revoke all on function public.erp_expense_finance_posting_get(uuid) from public;
grant execute on function public.erp_expense_finance_posting_get(uuid) to authenticated;

create or replace function public.erp_expense_finance_posting_summary(
  p_from date,
  p_to date
) returns table (
  total_count int,
  posted_count int,
  missing_count int,
  total_amount numeric,
  posted_amount numeric,
  missing_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  perform public.erp_require_finance_reader();

  if p_from is null or p_to is null then
    raise exception 'from/to dates are required';
  end if;

  return query
  with expense_base as (
    select e.id, e.amount
    from public.erp_expenses e
    where e.company_id = v_company_id
      and e.expense_date between p_from and p_to
  )
  select
    count(*)::int as total_count,
    count(p.expense_id)::int as posted_count,
    (count(*) - count(p.expense_id))::int as missing_count,
    coalesce(sum(e.amount), 0) as total_amount,
    coalesce(sum(case when p.expense_id is not null then e.amount end), 0) as posted_amount,
    coalesce(sum(case when p.expense_id is null then e.amount end), 0) as missing_amount
  from expense_base e
  left join public.erp_expense_finance_posts p
    on p.company_id = v_company_id
   and p.expense_id = e.id
   and p.status = 'posted';
end;
$$;

revoke all on function public.erp_expense_finance_posting_summary(date, date) from public;
grant execute on function public.erp_expense_finance_posting_summary(date, date) to authenticated;

create or replace function public.erp_expense_post_to_finance(
  p_company_id uuid,
  p_expense_id uuid,
  p_posted_by_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_actor uuid := auth.uid();
  v_expense public.erp_expenses%rowtype;
  v_category record;
  v_default_expense_account_code text;
  v_existing_doc_id uuid;
  v_journal_id uuid;
  v_doc_no text;
  v_expense_account record;
  v_payment_account record;
  v_payment_account_id uuid;
  v_vendor_name text;
  v_narration text;
  v_expense_account_code text;
begin
  if auth.role() <> 'service_role' then
    perform public.erp_require_finance_writer();
  end if;

  if v_company_id is null then
    raise exception 'No active company';
  end if;

  if p_company_id is null or p_company_id <> v_company_id then
    raise exception 'Invalid company scope';
  end if;

  select *
    into v_expense
    from public.erp_expenses e
    where e.company_id = v_company_id
      and e.id = p_expense_id
    for update;

  if v_expense.id is null then
    raise exception 'Expense not found';
  end if;

  if coalesce(v_expense.is_capitalizable, false)
    or v_expense.applies_to_type in ('grn', 'stock_transfer')
    or v_expense.applied_to_inventory_at is not null
    or v_expense.applied_inventory_ref is not null then
    raise exception 'Capitalizable/inventory-linked expense must be posted via landed-cost/GRN workflow (avoid double posting).';
  end if;

  if v_expense.applies_to_type in ('ap_bill', 'vendor_bill', 'ap_vendor_bill') then
    raise exception 'Expense is linked to an AP bill and should not be posted directly';
  end if;

  select j.id
    into v_existing_doc_id
    from public.erp_fin_journals j
    where j.company_id = v_company_id
      and j.reference_type = 'expense'
      and j.reference_id = p_expense_id
    order by j.created_at desc
    limit 1;

  if v_existing_doc_id is not null then
    insert into public.erp_expense_finance_posts (
      company_id,
      expense_id,
      finance_doc_type,
      finance_doc_id,
      status,
      posted_at,
      posted_by_user_id,
      meta,
      idempotency_key
    ) values (
      v_company_id,
      p_expense_id,
      'journal',
      v_existing_doc_id,
      'posted',
      now(),
      coalesce(p_posted_by_user_id, v_actor),
      '{}'::jsonb,
      p_expense_id
    )
    on conflict (company_id, expense_id)
    do update set finance_doc_id = public.erp_expense_finance_posts.finance_doc_id
    returning finance_doc_id into v_existing_doc_id;

    return v_existing_doc_id;
  end if;

  select c.code, c.name, c.expense_account_code
    into v_category
    from public.erp_expense_categories c
    where c.company_id = v_company_id
      and c.id = v_expense.category_id;

  if v_category.code is null then
    raise exception 'Expense category not found';
  end if;

  v_expense_account_code := v_category.expense_account_code;

  select cs.default_expense_account_code
    into v_default_expense_account_code
    from public.erp_company_settings cs
    where cs.company_id = v_company_id;

  v_expense_account_code := coalesce(
    nullif(btrim(v_expense_account_code), ''),
    nullif(btrim(v_default_expense_account_code), '')
  );

  if v_expense_account_code is null then
    raise exception 'Missing expense account mapping';
  end if;

  select a.code, a.name
    into v_expense_account
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.account_type = 'expense'
      and a.code = v_expense_account_code
    limit 1;

  if v_expense_account.code is null then
    raise exception 'Missing expense account mapping';
  end if;

  v_payment_account_id := public.erp_fin_account_by_role('bank_main');
  select a.code, a.name
    into v_payment_account
    from public.erp_gl_accounts a
    where a.company_id = v_company_id
      and a.id = v_payment_account_id;

  if v_payment_account.code is null then
    raise exception 'Bank account mapping missing';
  end if;

  if v_expense.vendor_id is not null then
    select v.legal_name
      into v_vendor_name
      from public.erp_vendors v
      where v.company_id = v_company_id
        and v.id = v_expense.vendor_id;
  end if;

  v_narration := coalesce(
    nullif(v_expense.description, ''),
    nullif(v_expense.reference, ''),
    nullif(v_vendor_name, ''),
    nullif(v_expense.payee_name, ''),
    v_category.name,
    v_expense.id::text
  );

  perform public.erp_require_fin_open_period(v_company_id, v_expense.expense_date);

  v_journal_id := gen_random_uuid();

  insert into public.erp_expense_finance_posts (
    company_id,
    expense_id,
    finance_doc_type,
    finance_doc_id,
    status,
    posted_at,
    posted_by_user_id,
    meta,
    idempotency_key
  ) values (
    v_company_id,
    v_expense.id,
    'journal',
    v_journal_id,
    'posted',
    now(),
    coalesce(p_posted_by_user_id, v_actor),
    '{}'::jsonb,
    v_expense.id
  )
  on conflict (company_id, expense_id)
  do update set finance_doc_id = public.erp_expense_finance_posts.finance_doc_id
  returning finance_doc_id into v_existing_doc_id;

  if v_existing_doc_id <> v_journal_id then
    return v_existing_doc_id;
  end if;

  insert into public.erp_fin_journals (
    id,
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
    v_journal_id,
    v_company_id,
    v_expense.expense_date,
    'posted',
    v_narration,
    'expense',
    v_expense.id,
    v_expense.amount,
    v_expense.amount,
    coalesce(p_posted_by_user_id, v_actor)
  ) returning id into v_journal_id;

  insert into public.erp_fin_journal_lines (
    company_id,
    journal_id,
    line_no,
    account_code,
    account_name,
    description,
    debit,
    credit
  ) values
    (
      v_company_id,
      v_journal_id,
      1,
      v_expense_account.code,
      v_expense_account.name,
      coalesce(v_category.name, 'Expense'),
      v_expense.amount,
      0
    ),
    (
      v_company_id,
      v_journal_id,
      2,
      v_payment_account.code,
      v_payment_account.name,
      'Expense payment',
      0,
      v_expense.amount
    );

  v_doc_no := public.erp_doc_allocate_number(v_journal_id, 'JRN');

  update public.erp_fin_journals
  set doc_no = v_doc_no
  where id = v_journal_id
    and company_id = v_company_id;

  update public.erp_expense_finance_posts
  set meta = jsonb_build_object('journal_no', v_doc_no),
      posted_at = now(),
      posted_by_user_id = coalesce(p_posted_by_user_id, v_actor)
  where company_id = v_company_id
    and expense_id = v_expense.id
    and finance_doc_id = v_journal_id;

  return v_journal_id;
end;
$$;

revoke all on function public.erp_expense_post_to_finance(uuid, uuid, uuid) from public;
grant execute on function public.erp_expense_post_to_finance(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
