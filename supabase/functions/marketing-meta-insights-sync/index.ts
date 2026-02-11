
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
  const AD_ACCOUNT = Deno.env.get("META_AD_ACCOUNT_ID");

  const url =
    `https://graph.facebook.com/v19.0/act_${AD_ACCOUNT}/insights` +
    `?fields=campaign_id,adset_id,ad_id,impressions,clicks,spend,reach,frequency,actions,action_values` +
    `&time_increment=1` +
    `&date_preset=yesterday` +
    `&access_token=${META_TOKEN}`;

  const resp = await fetch(url);
  const data = await resp.json();

  if (!data.data) {
    return new Response(JSON.stringify(data), { status: 500 });
  }

  for (const row of data.data) {
    const purchases =
      row.actions?.find((a: any) => a.action_type === "purchase")?.value ?? 0;

    const purchase_value =
      row.action_values?.find((a: any) => a.action_type === "purchase")?.value ?? 0;

    await supabase.from("erp_mkt_meta_insights_daily").upsert({
      company_id: Deno.env.get("COMPANY_ID"),
      insight_date: row.date_start,
      meta_campaign_id: row.campaign_id,
      meta_adset_id: row.adset_id,
      meta_ad_id: row.ad_id,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: row.spend,
      reach: row.reach,
      frequency: row.frequency,
      purchases,
      purchase_value,
      raw_json: row
    });
  }

  return new Response(JSON.stringify({ status: "ok" }));
});
