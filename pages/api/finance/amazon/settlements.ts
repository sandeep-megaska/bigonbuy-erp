import type { NextApiRequest, NextApiResponse } from "next";
import { amazonListReports } from "../../../../lib/oms/adapters/amazonSpApi";

type SettlementReportSummary = {
  reportId: string;
  createdTime?: string;
  processingStatus?: string;
  marketplaceIds?: string[];
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

  try {
    const { reports, nextToken: responseNextToken } = await amazonListReports({
      reportTypes: [REPORT_TYPE],
      nextToken,
    });

    const summaries = reports.map((report) => ({
      reportId: report.reportId,
      createdTime: report.createdTime,
      processingStatus: report.processingStatus,
      marketplaceIds: report.marketplaceIds,
    }));

    return res.status(200).json({ ok: true, reports: summaries, nextToken: responseNextToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
