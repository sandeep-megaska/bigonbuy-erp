import type { NextApiRequest, NextApiResponse } from "next";
import { OWNER_ADMIN_ROLE_KEYS, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";
import { syncMetaEntityRegistry } from "../../../../lib/erp/marketing/metaEntitySync";

type ApiResponse =
  | {
      ok: true;
      campaigns_upserted: number;
      adsets_upserted: number;
      ads_upserted: number;
      pages_fetched: number;
      warnings: Array<{ type: "campaigns" | "adsets" | "ads"; message: string }>;
    }
  | { ok: false; error: string; details?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req, res);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  if (!OWNER_ADMIN_ROLE_KEYS.has(context.roleKey)) {
    return res.status(403).json({ ok: false, error: "Only owner/admin can sync Meta entities" });
  }

  const { data: settings, error: settingsError } = await context.serviceClient
    .from("erp_mkt_settings")
    .select("meta_access_token, meta_ad_account_id")
    .eq("company_id", context.companyId)
    .maybeSingle();

  if (settingsError) {
    return res.status(500).json({ ok: false, error: "Failed to load Meta settings", details: settingsError.message });
  }

  const accessToken = settings?.meta_access_token ?? process.env.META_MARKETING_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? null;
  const adAccountId = settings?.meta_ad_account_id ?? process.env.META_AD_ACCOUNT_ID ?? null;

  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "Missing Meta access token in erp_mkt_settings.meta_access_token" });
  }

  if (!adAccountId) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing Meta ad account ID in erp_mkt_settings.meta_ad_account_id" });
  }

  try {
    const result = await syncMetaEntityRegistry({
      supabase: context.serviceClient,
      companyId: context.companyId,
      accessToken,
      adAccountId,
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (error: unknown) {
    return res.status(502).json({
      ok: false,
      error: "Meta entity sync failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
