import type { NextApiRequest, NextApiResponse } from "next";
import {
  amazonDownloadReportDocument,
  amazonGetReport,
  amazonGetReportDocument,
} from "../../../../../lib/oms/adapters/amazonSpApi";
import { parseAmazonSettlementReportText } from "../../../../../lib/erp/amazonSettlementReport";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ApiResponse =
  | {
      ok: true;
      report: {
        eventId: string;
        createdTime?: string;
        processingStatus?: string;
      };
      rawHeader: string[];
      columns: string[];
      rows: Record<string, string>[];
      totalsByCurrency: Record<string, number>;
      rowCount: number;
      sampleCount: number;
    }
  | { ok: false; error: string };

const MAX_PREVIEW_ROWS = 200;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const eventId = typeof req.query.eventId === "string" ? req.query.eventId : null;
  if (!eventId) {
    return res.status(400).json({ ok: false, error: "Missing eventId" });
  }

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

    const report = await amazonGetReport({ reportId: eventId });
    const processingStatus = report.processingStatus ?? "UNKNOWN";

    if (processingStatus !== "DONE") {
      return res
        .status(400)
        .json({ ok: false, error: `Report status is ${processingStatus}. Try again later.` });
    }

    if (!report.reportDocumentId) {
      return res.status(400).json({ ok: false, error: "Missing reportDocumentId." });
    }

    const reportDocument = await amazonGetReportDocument({
      reportDocumentId: report.reportDocumentId,
    });
    const text = await amazonDownloadReportDocument({ reportDocument });

    const parsed = parseAmazonSettlementReportText(text, { maxRows: MAX_PREVIEW_ROWS });

    return res.status(200).json({
      ok: true,
      report: {
        eventId: report.reportId,
        createdTime: report.createdTime,
        processingStatus: report.processingStatus,
      },
      rawHeader: parsed.rawHeader,
      columns: parsed.columns,
      rows: parsed.rows,
      totalsByCurrency: parsed.totalsByCurrency,
      rowCount: parsed.rowCount,
      sampleCount: parsed.sampleCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
