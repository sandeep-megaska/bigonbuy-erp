begin;

-- Step 2: Inspect source columns via information_schema and wire canonical ASC source.
do $asc$
declare
  v_activation_has_company_id boolean;
  v_activation_has_sku_identifier boolean;
  v_activation_has_decision_like boolean;
  v_activation_has_confidence boolean;
begin
  select exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'erp_mkt_activation_scale_skus_v1'
             and column_name = 'company_id'
         )
    into v_activation_has_company_id;

  select exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'erp_mkt_activation_scale_skus_v1'
             and column_name in ('sku_code', 'sku_id')
         )
    into v_activation_has_sku_identifier;

  select exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'erp_mkt_activation_scale_skus_v1'
             and column_name in ('decision', 'action', 'scale_flag', 'should_scale', 'tier', 'bucket')
         )
    into v_activation_has_decision_like;

  select exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'erp_mkt_activation_scale_skus_v1'
             and column_name in ('confidence_score', 'score', 'probability')
         )
    into v_activation_has_confidence;

  if v_activation_has_company_id and v_activation_has_sku_identifier and v_activation_has_decision_like then
    -- Preferred path: activation view already has decision-like signal.
    execute $sql$
      create or replace view public.erp_mkt_asc_scale_skus_source_v1 as
      select
        a.company_id::uuid as company_id,
        coalesce(to_jsonb(a)->>'sku_id', to_jsonb(a)->>'sku_code')::text as sku_id,
        case
          when lower(coalesce(to_jsonb(a)->>'decision', to_jsonb(a)->>'action')) in ('scale', 'reduce', 'pause', 'hold')
            then lower(coalesce(to_jsonb(a)->>'decision', to_jsonb(a)->>'action'))
          when lower(coalesce(to_jsonb(a)->>'scale_flag', to_jsonb(a)->>'should_scale')) in ('true', 't', '1') then 'scale'
          when lower(coalesce(to_jsonb(a)->>'scale_flag', to_jsonb(a)->>'should_scale')) in ('false', 'f', '0') then 'hold'
          when lower(coalesce(to_jsonb(a)->>'tier', to_jsonb(a)->>'bucket')) in ('high', 'a', 'hot', 'priority') then 'scale'
          when lower(coalesce(to_jsonb(a)->>'tier', to_jsonb(a)->>'bucket')) in ('low', 'c', 'cold') then 'reduce'
          else 'hold'
        end::text as decision,
        case
          when nullif(to_jsonb(a)->>'confidence_score', '') is not null then round((to_jsonb(a)->>'confidence_score')::numeric, 2)
          when nullif(to_jsonb(a)->>'score', '') is not null then round((to_jsonb(a)->>'score')::numeric, 2)
          when nullif(to_jsonb(a)->>'probability', '') is not null then round((to_jsonb(a)->>'probability')::numeric, 2)
          else null::numeric
        end::numeric(6,2) as confidence_score,
        null::text as reason
      from public.erp_mkt_activation_scale_skus_v1 a
      where a.company_id = public.erp_current_company_id();
    $sql$;
  else
    -- Fallback path from demand+scores because activation scale view does not expose decision fields.
    -- Mapping rationale:
    -- 1) Explicit do-not-scale flags (guardrail tags) -> pause.
    -- 2) High velocity + high profitability -> scale.
    -- 3) Low profitability -> reduce/hold based on velocity.
    -- 4) Otherwise use demand decision defaults.
    execute $sql$
      create or replace view public.erp_mkt_asc_scale_skus_source_v1 as
      with base as (
        select
          d.company_id,
          d.sku::text as sku_id,
          d.decision as demand_decision,
          d.confidence_score,
          d.guardrail_tags,
          s.velocity_30d,
          s.profitability_score
        from public.erp_mkt_sku_demand_latest_v1 d
        left join public.erp_mkt_sku_scores s
          on s.company_id = d.company_id
         and s.sku_code = d.sku
        where d.company_id = public.erp_current_company_id()
      )
      select
        b.company_id::uuid as company_id,
        b.sku_id::text as sku_id,
        case
          when 'DO_NOT_SCALE' = any(coalesce(b.guardrail_tags, '{}'::text[]))
            or 'PAUSE' = any(coalesce(b.guardrail_tags, '{}'::text[]))
            or 'LOW_INVENTORY' = any(coalesce(b.guardrail_tags, '{}'::text[])) then 'pause'
          when coalesce(b.velocity_30d, 0) >= 20 and coalesce(b.profitability_score, 0) >= 0.60 then 'scale'
          when coalesce(b.profitability_score, 0) < 0.25 and coalesce(b.velocity_30d, 0) < 5 then 'reduce'
          when coalesce(b.profitability_score, 0) < 0.25 then 'hold'
          when upper(coalesce(b.demand_decision, 'HOLD')) = 'SCALE' then 'scale'
          when upper(coalesce(b.demand_decision, 'HOLD')) = 'REDUCE' then 'reduce'
          else 'hold'
        end::text as decision,
        round(coalesce(b.confidence_score, 0)::numeric, 2)::numeric(6,2) as confidence_score,
        case
          when 'DO_NOT_SCALE' = any(coalesce(b.guardrail_tags, '{}'::text[]))
            or 'PAUSE' = any(coalesce(b.guardrail_tags, '{}'::text[])) then 'Explicit do-not-scale guardrail'
          when 'LOW_INVENTORY' = any(coalesce(b.guardrail_tags, '{}'::text[])) then 'Low inventory guardrail'
          when coalesce(b.velocity_30d, 0) >= 20 and coalesce(b.profitability_score, 0) >= 0.60 then 'High velocity + high profitability'
          when coalesce(b.profitability_score, 0) < 0.25 and coalesce(b.velocity_30d, 0) < 5 then 'Low profitability + low velocity'
          when coalesce(b.profitability_score, 0) < 0.25 then 'Low profitability'
          else 'Demand steering carry-forward'
        end::text as reason
      from base b;
    $sql$;
  end if;

  raise notice
    'ASC source wiring | activation(company_id=% sku=% decision_like=% confidence=%)',
    v_activation_has_company_id,
    v_activation_has_sku_identifier,
    v_activation_has_decision_like,
    v_activation_has_confidence;
end;
$asc$;

-- Step 3: Patch ASC decision RPC to read canonical ASC source view.
create or replace function public.erp_mkt_meta_scaling_run_v1()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  if to_regclass('public.erp_mkt_asc_scale_skus_source_v1') is null then
    raise notice 'Skipping scaling run: public.erp_mkt_asc_scale_skus_source_v1 is missing';
    return;
  end if;

  insert into public.erp_mkt_meta_scaling_decisions_daily (
    company_id,
    decision_date,
    entity_type,
    entity_id,
    decision,
    confidence_score,
    target_budget_multiplier,
    decision_reason
  )
  select
    v_company_id,
    current_date,
    'sku'::text,
    src.sku_id,
    src.decision,
    src.confidence_score,
    case src.decision
      when 'scale' then 1.20::numeric(6,2)
      when 'hold' then 1.00::numeric(6,2)
      when 'reduce' then 0.85::numeric(6,2)
      when 'pause' then 0.00::numeric(6,2)
      else 1.00::numeric(6,2)
    end as target_budget_multiplier,
    coalesce(nullif(src.reason, ''), 'ASC source decision')
  from public.erp_mkt_asc_scale_skus_source_v1 src
  where src.company_id = v_company_id
    and src.decision in ('scale', 'hold', 'reduce', 'pause')
  on conflict (company_id, decision_date, entity_type, entity_id)
  do update
    set decision = excluded.decision,
        confidence_score = excluded.confidence_score,
        target_budget_multiplier = excluded.target_budget_multiplier,
        decision_reason = excluded.decision_reason;
end;
$$;

-- Step 4: Update CSV export RPC to export today's scale decisions from decisions table.
create or replace function public.erp_mkt_meta_export_scale_skus_csv_v1()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.erp_current_company_id();
  v_rows text;
begin
  if v_company_id is null then
    raise exception 'No company in context (erp_current_company_id() returned null)';
  end if;

  select string_agg(
           concat(
             '"', replace(d.entity_id, '"', '""'), '",',
             '"', d.decision, '",',
             coalesce(d.target_budget_multiplier::text, '')
           ),
           E'\n'
           order by d.entity_id
         )
    into v_rows
  from public.erp_mkt_meta_scaling_decisions_daily d
  where d.company_id = v_company_id
    and d.decision_date = current_date
    and d.entity_type = 'sku'
    and d.decision = 'scale';

  return concat('sku_id,decision,target_budget_multiplier', E'\n', coalesce(v_rows, ''));
end;
$$;

commit;

-- Step 5 — Acceptance tests (run manually)
-- select * from public.erp_mkt_asc_scale_skus_source_v1 where company_id = erp_current_company_id() limit 20;
-- select public.erp_mkt_meta_scaling_run_v1();
-- select *
-- from public.erp_mkt_meta_scaling_decisions_daily
-- where company_id = erp_current_company_id()
--   and decision_date = current_date
-- order by decision, entity_id
-- limit 50;
-- select public.erp_mkt_meta_export_scale_skus_csv_v1();
