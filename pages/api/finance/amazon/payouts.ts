import type { NextApiRequest, NextApiResponse } from "next";
import { amazonListReports } from "../../../../lib/oms/adapters/amazonSpApi";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type SettlementReportSummary = {
  eventId: string;
  createdTime?: string;
  processingStatus?: string;
  marketplaceIds?: string[];
  normalizedBatchId?: string | null;
};

type ApiResponse =
  | { ok: true; reports: SettlementReportSummary[]; nextToken?: string }
  | { ok: false; error: string };

const REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE";

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const nextToken = typeof req.query.nextToken === "string" ? req.query.nextToken : undefined;

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { reports, nextToken: responseNextToken } = await amazonListReports(
      nextToken
        ? { reportTypes: [], nextToken }
        : {
            reportTypes: [REPORT_TYPE],
          }
    );

    const reportIds = reports.map((report) => report.reportId).filter(Boolean);
    const reportLinks = reportIds.length
      ? await userClient
          .from("erp_marketplace_settlement_report_links")
          .select("report_id, batch_id")
          .in("report_id", reportIds)
      : { data: [], error: null };

    if (reportLinks.error) {
      return res.status(400).json({ ok: false, error: reportLinks.error.message || "Unable to load links" });
    }

    const linksByReportId = new Map(
      (reportLinks.data ?? []).map((link) => [link.report_id, link.batch_id])
    );

    const summaries = reports.map((report) => ({
      eventId: report.reportId,
      createdTime: report.createdTime,
      processingStatus: report.processingStatus,
      marketplaceIds: report.marketplaceIds,
      normalizedBatchId: linksByReportId.get(report.reportId) ?? null,
    }));

    return res.status(200).json({ ok: true, reports: summaries, nextToken: responseNextToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
