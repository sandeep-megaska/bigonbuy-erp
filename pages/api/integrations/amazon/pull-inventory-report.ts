import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertSupportedReportType,
  getAmazonAccessToken,
  spApiSignedFetch,
} from "../../../../lib/amazonSpApi";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type ApiResponse =
  | { ok: true; batchId: string }
  | { ok: false; error: string; details?: string };

const requestSchema = z.object({
  marketplaceId: z.string().optional(),
  companyId: z.string().uuid().optional(),
});

const reportCreateSchema = z
  .object({
    reportId: z.string(),
  })
  .passthrough();

const MARKETPLACE_IDS = ["A21TJRUUN4KGV"];
const REPORT_TYPE = "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA";
const ALLOWED_ROLE_KEYS = ["owner", "admin", "inventory", "finance"] as const;

async function resolveCompanyClient(
  req: NextApiRequest,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string
): Promise<{ companyId: string; client: SupabaseClient }> {
  const internalToken = req.headers["x-internal-token"];
  const internalTokenValue = Array.isArray(internalToken) ? internalToken[0] : internalToken;
  const expectedToken = process.env.INTERNAL_ADMIN_TOKEN ?? null;
  const usingInternalToken = expectedToken && internalTokenValue === expectedToken;

  let companyId: string | null = null;
  let dataClient: SupabaseClient = createUserClient(supabaseUrl, anonKey, "");

  if (usingInternalToken) {
    const parseResult = requestSchema.safeParse(req.body ?? {});
    if (!parseResult.success || !parseResult.data.companyId) {
      throw new Error("companyId is required when using internal token");
    }

    companyId = parseResult.data.companyId;
    dataClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  } else {
    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      throw new Error("Missing Authorization: Bearer token");
    }

    dataClient = createUserClient(supabaseUrl, anonKey, bearerToken);
    const { data: userData, error: userError } = await dataClient.auth.getUser();
    if (userError || !userData?.user) {
      throw new Error("Not authenticated");
    }

    const { data: membership, error: membershipError } = await dataClient
      .from("erp_company_users")
      .select("company_id, role_key")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    if (!membership?.company_id) {
      throw new Error("No active company membership");
    }

    if (!ALLOWED_ROLE_KEYS.includes(membership.role_key as (typeof ALLOWED_ROLE_KEYS)[number])) {
      throw new Error("Not authorized to pull inventory");
    }

    companyId = membership.company_id;
  }

  if (!companyId) {
    throw new Error("Missing companyId");
  }

  return { companyId, client: dataClient };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const parseResult = requestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    return res.status(400).json({ ok: false, error: "Invalid request body" });
  }

  try {
    const accessToken = await getAmazonAccessToken();
    const marketplaceId = MARKETPLACE_IDS[0];
    const { companyId, client } = await resolveCompanyClient(
      req,
      supabaseUrl,
      anonKey,
      serviceRoleKey
    );

    assertSupportedReportType(REPORT_TYPE);

    const response = await spApiSignedFetch({
      method: "POST",
      path: "/reports/2021-06-30/reports",
      accessToken,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reportType: REPORT_TYPE,
        marketplaceIds: MARKETPLACE_IDS,
      }),
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(500).json({ ok: false, error: `SP-API error: ${JSON.stringify(json)}` });
    }

    const parsedReport = reportCreateSchema.safeParse(json);
    const reportId = parsedReport.success ? parsedReport.data.reportId : (json as { reportId?: string })?.reportId;
    if (!reportId) {
      return res.status(500).json({ ok: false, error: "Missing reportId in SP-API response" });
    }

    const { data: batch, error: batchError } = await client
      .from("erp_external_inventory_batches")
      .insert({
        company_id: companyId,
        channel_key: "amazon",
        marketplace_id: marketplaceId,
        type: "report",
        status: "requested",
        external_report_id: reportId,
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      return res.status(500).json({ ok: false, error: batchError?.message || "Failed to create batch" });
    }

    return res.status(200).json({ ok: true, batchId: batch.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
