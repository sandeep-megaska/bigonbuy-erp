import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- env vars (support both old + new names) ----
  const COMPANY_ID = Deno.env.get("COMPANY_ID");
  const AD_ACCOUNT_RAW = Deno.env.get("META_AD_ACCOUNT_ID");

  // Prefer Marketing token if you add it later; fallback to existing
  const META_TOKEN =
    Deno.env.get("META_MARKETING_ACCESS_TOKEN") ??
    Deno.env.get("META_CAPI_ACCESS_TOKEN") ??
    Deno.env.get("META_ACCESS_TOKEN"); // legacy support

  if (!COMPANY_ID) {
    return new Response(JSON.stringify({ error: "Missing COMPANY_ID" }), { status: 500 });
  }
  if (!AD_ACCOUNT_RAW) {
    return new Response(JSON.stringify({ error: "Missing META_AD_ACCOUNT_ID" }), { status: 500 });
  }
  if (!META_TOKEN) {
    return new Response(JSON.stringify({
      error: "Missing Meta token env var",
      expected_any_of: ["META_MARKETING_ACCESS_TOKEN", "META_CAPI_ACCESS_TOKEN", "META_ACCESS_TOKEN"],
    }), { status: 500 });
  }

  // Normalize ad account id: accept "act_123" or "123"
  const AD_ACCOUNT = AD_ACCOUNT_RAW.startsWith("act_")
    ? AD_ACCOUNT_RAW
    : `act_${AD_ACCOUNT_RAW}`;

  const url =
    `https://graph.facebook.com/v19.0/${AD_ACCOUNT}/insights` +
    `?fields=campaign_id,adset_id,ad_id,date_start,impressions,clicks,spend,reach,frequency,actions,action_values` +
    `&time_increment=1` +
    `&date_preset=yesterday` +
    `&access_token=${encodeURIComponent(META_TOKEN)}`;

  const resp = await fetch(url);
  const json = await resp.json();
  console.log("META_INSIGHTS_HTTP_STATUS", resp.status);
console.log("META_INSIGHTS_RESPONSE", JSON.stringify(json));

console.log("META_STATUS", resp.status);
console.log("META_JSON", JSON.stringify(json));

  if (!resp.ok || !json?.data) {
    return new Response(JSON.stringify({
      error: "Meta insights fetch failed",
      http_status: resp.status,
      response: json,
      used_ad_account: AD_ACCOUNT,
    }), { status: 500 });
  }

  let upserts = 0;

  for (const row of json.data) {
    const purchases =
      row.actions?.find((a: any) => a.action_type === "purchase")?.value ?? 0;

    const purchase_value =
      row.action_values?.find((a: any) => a.action_type === "purchase")?.value ?? 0;

    const payload = {
      company_id: COMPANY_ID,
      insight_date: row.date_start, // ISO date string is fine; column is date
      meta_campaign_id: row.campaign_id ?? null,
      meta_adset_id: row.adset_id ?? null,
      meta_ad_id: row.ad_id ?? null,
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      spend: row.spend ?? 0,
      reach: row.reach ?? 0,
      frequency: row.frequency ?? null,
      purchases,
      purchase_value,
      raw_json: row,
    };

    const { error } = await supabase
      .from("erp_mkt_meta_insights_daily")
      .upsert(payload, { onConflict: "company_id,insight_date,meta_ad_id" });

    if (error) {
      return new Response(JSON.stringify({
        error: "DB upsert failed",
        db_error: error,
        row_sample: payload,
      }), { status: 500 });
    }

    upserts++;
  }
if (!resp.ok || !json?.data) {
  console.log("META_INSIGHTS_FAILED_AD_ACCOUNT", AD_ACCOUNT);
  return new Response(JSON.stringify({
    error: "Meta insights fetch failed",
    http_status: resp.status,
    response: json,
    used_ad_account: AD_ACCOUNT,
  }), { status: 500 });
}

  return new Response(JSON.stringify({ status: "ok", upserts }), { status: 200 });
});
