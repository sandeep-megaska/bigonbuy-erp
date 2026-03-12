import type { SupabaseClient } from "@supabase/supabase-js";

type MetaEntityType = "campaigns" | "adsets" | "ads";

type MetaCampaignRow = {
  company_id: string;
  meta_campaign_id: string;
  campaign_name: string | null;
  objective: string | null;
  status: string | null;
  created_time: string | null;
  updated_time: string | null;
  raw_json: Record<string, unknown>;
  updated_at: string;
};

type MetaAdsetRow = {
  company_id: string;
  meta_adset_id: string;
  meta_campaign_id: string;
  adset_name: string | null;
  optimization_goal: string | null;
  billing_event: string | null;
  status: string | null;
  raw_json: Record<string, unknown>;
  updated_at: string;
};

type MetaAdRow = {
  company_id: string;
  meta_ad_id: string;
  meta_adset_id: string;
  ad_name: string | null;
  status: string | null;
  creative_id: string | null;
  raw_json: Record<string, unknown>;
  updated_at: string;
};

type MetaSyncWarning = {
  type: MetaEntityType;
  message: string;
};

export type MetaSyncResult = {
  campaigns_upserted: number;
  adsets_upserted: number;
  ads_upserted: number;
  pages_fetched: number;
  warnings: MetaSyncWarning[];
};

const META_GRAPH_VERSION = "v19.0";
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const MAX_PAGES_PER_ENTITY = 200;

function normalizeAdAccountId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function fetchMetaEntityPages(options: {
  adAccountId: string;
  accessToken: string;
  endpoint: MetaEntityType;
  fields: string;
}): Promise<{ rows: Record<string, unknown>[]; pagesFetched: number }> {
  const { adAccountId, accessToken, endpoint, fields } = options;
  const firstUrl =
    `${META_GRAPH_BASE_URL}/${encodeURIComponent(adAccountId)}/${endpoint}` +
    `?fields=${encodeURIComponent(fields)}` +
    `&limit=250` +
    `&access_token=${encodeURIComponent(accessToken)}`;

  const allRows: Record<string, unknown>[] = [];
  let pagesFetched = 0;
  let nextUrl: string | null = firstUrl;

  while (nextUrl) {
    if (pagesFetched >= MAX_PAGES_PER_ENTITY) {
      throw new Error(`Meta ${endpoint} pagination exceeded max page limit (${MAX_PAGES_PER_ENTITY})`);
    }

    const response = await fetch(nextUrl);
    const json = (await response.json().catch(() => null)) as
      | { data?: unknown[]; paging?: { next?: string }; error?: { message?: string; code?: number } }
      | null;

    if (!response.ok || json?.error) {
      throw new Error(
        `Meta ${endpoint} fetch failed (status ${response.status}): ${JSON.stringify(json?.error ?? json ?? {})}`,
      );
    }

    const pageRows = Array.isArray(json?.data) ? json.data.map((row) => toRecord(row)) : [];
    allRows.push(...pageRows);
    pagesFetched += 1;

    const next = typeof json?.paging?.next === "string" ? json.paging.next : null;
    nextUrl = next && next.length > 0 ? next : null;
  }

  return { rows: allRows, pagesFetched };
}

async function upsertCampaigns(supabase: SupabaseClient, rows: MetaCampaignRow[]) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("erp_mkt_meta_campaigns")
    .upsert(rows, { onConflict: "company_id,meta_campaign_id" });
  if (error) throw new Error(`Failed to upsert campaigns: ${error.message}`);
}

async function upsertAdsets(supabase: SupabaseClient, rows: MetaAdsetRow[]) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("erp_mkt_meta_adsets")
    .upsert(rows, { onConflict: "company_id,meta_adset_id" });
  if (error) throw new Error(`Failed to upsert adsets: ${error.message}`);
}

async function upsertAds(supabase: SupabaseClient, rows: MetaAdRow[]) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("erp_mkt_meta_ads").upsert(rows, { onConflict: "company_id,meta_ad_id" });
  if (error) throw new Error(`Failed to upsert ads: ${error.message}`);
}

export async function syncMetaEntityRegistry(options: {
  supabase: SupabaseClient;
  companyId: string;
  accessToken: string;
  adAccountId: string;
}): Promise<MetaSyncResult> {
  const { supabase, companyId, accessToken } = options;
  const adAccountId = normalizeAdAccountId(options.adAccountId);

  if (!companyId) throw new Error("Missing companyId for Meta entity sync");
  if (!accessToken?.trim()) throw new Error("Missing Meta access token");
  if (!adAccountId) throw new Error("Missing Meta ad account ID");

  const nowIso = new Date().toISOString();
  const warnings: MetaSyncWarning[] = [];
  let pagesFetched = 0;

  const campaignFetch = await fetchMetaEntityPages({
    adAccountId,
    accessToken,
    endpoint: "campaigns",
    fields: "id,name,objective,status,created_time,updated_time",
  });
  pagesFetched += campaignFetch.pagesFetched;

  const campaigns: MetaCampaignRow[] = campaignFetch.rows
    .map((row) => ({
      company_id: companyId,
      meta_campaign_id: toText(row.id),
      campaign_name: toText(row.name),
      objective: toText(row.objective),
      status: toText(row.status),
      created_time: toText(row.created_time),
      updated_time: toText(row.updated_time),
      raw_json: row,
      updated_at: nowIso,
    }))
    .filter((row): row is MetaCampaignRow => Boolean(row.meta_campaign_id));

  if (campaignFetch.rows.length > campaigns.length) {
    warnings.push({
      type: "campaigns",
      message: `Skipped ${campaignFetch.rows.length - campaigns.length} campaign rows without id`,
    });
  }

  await upsertCampaigns(supabase, campaigns);

  const adsetFetch = await fetchMetaEntityPages({
    adAccountId,
    accessToken,
    endpoint: "adsets",
    fields: "id,campaign_id,name,optimization_goal,billing_event,status",
  });
  pagesFetched += adsetFetch.pagesFetched;

  const adsets: MetaAdsetRow[] = adsetFetch.rows
    .map((row) => ({
      company_id: companyId,
      meta_adset_id: toText(row.id),
      meta_campaign_id: toText(row.campaign_id),
      adset_name: toText(row.name),
      optimization_goal: toText(row.optimization_goal),
      billing_event: toText(row.billing_event),
      status: toText(row.status),
      raw_json: row,
      updated_at: nowIso,
    }))
    .filter((row): row is MetaAdsetRow => Boolean(row.meta_adset_id && row.meta_campaign_id));

  if (adsetFetch.rows.length > adsets.length) {
    warnings.push({
      type: "adsets",
      message: `Skipped ${adsetFetch.rows.length - adsets.length} adset rows without id/campaign_id`,
    });
  }

  await upsertAdsets(supabase, adsets);

  const adFetch = await fetchMetaEntityPages({
    adAccountId,
    accessToken,
    endpoint: "ads",
    fields: "id,adset_id,name,status,creative{id}",
  });
  pagesFetched += adFetch.pagesFetched;

  const ads: MetaAdRow[] = adFetch.rows
    .map((row) => ({
      company_id: companyId,
      meta_ad_id: toText(row.id),
      meta_adset_id: toText(row.adset_id),
      ad_name: toText(row.name),
      status: toText(row.status),
      creative_id: toText(toRecord(row.creative).id),
      raw_json: row,
      updated_at: nowIso,
    }))
    .filter((row): row is MetaAdRow => Boolean(row.meta_ad_id && row.meta_adset_id));

  if (adFetch.rows.length > ads.length) {
    warnings.push({
      type: "ads",
      message: `Skipped ${adFetch.rows.length - ads.length} ad rows without id/adset_id`,
    });
  }

  await upsertAds(supabase, ads);

  return {
    campaigns_upserted: campaigns.length,
    adsets_upserted: adsets.length,
    ads_upserted: ads.length,
    pages_fetched: pagesFetched,
    warnings,
  };
}
