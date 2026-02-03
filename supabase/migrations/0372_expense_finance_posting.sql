-- 0372_expense_finance_posting.sql
-- Add guardrail to prevent posting capitalizable/inventory-linked expenses via direct finance posting.

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_guard text;
begin
  select p.oid, n.nspname, p.proname
    into r
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'erp_expense_post_to_finance'
   limit 1;

  if not found then
    raise notice 'Function public.erp_expense_post_to_finance not found; skipping guardrail patch.';
    return;
  end if;

  v_def := pg_get_functiondef(r.oid);

  if position('Capitalizable/inventory-linked expense must be posted via landed-cost/GRN workflow (avoid double posting).' in v_def) > 0 then
    raise notice 'Guardrail already present in %.%', r.nspname, r.proname;
    return;
  end if;

  v_guard := E'begin\n'
    || E'  if exists (\n'
    || E'    select 1\n'
    || E'    from public.erp_expenses e\n'
    || E'    where e.id = $1\n'
    || E'      and (\n'
    || E'        e.is_capitalizable is true\n'
    || E'        or e.applies_to_type in (''grn'', ''stock_transfer'')\n'
    || E'        or e.applied_to_inventory_at is not null\n'
    || E'        or e.applied_inventory_ref is not null\n'
    || E'      )\n'
    || E'  ) then\n'
    || E'    raise exception ''Capitalizable/inventory-linked expense must be posted via landed-cost/GRN workflow (avoid double posting).'';\n'
    || E'  end if;\n';

  v_new := regexp_replace(v_def, E'\\bbegin\\b', v_guard, 1, 1, 'in');

  if v_new = v_def then
    raise notice 'No change applied to %.%', r.nspname, r.proname;
  else
    execute v_new;
    raise notice 'Patched function %.%', r.nspname, r.proname;
  end if;
end $$;
