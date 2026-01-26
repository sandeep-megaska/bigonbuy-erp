import type { NextApiRequest, NextApiResponse } from "next";
import {
  amazonDownloadReportDocument,
  amazonGetReport,
  amazonGetReportDocument,
} from "../../../../../lib/oms/adapters/amazonSpApi";

type PreviewRow = Record<string, string>;

type ApiResponse =
  | {
      ok: true;
      report: {
        reportId: string;
        createdTime?: string;
        processingStatus?: string;
      };
      rawHeader: string[];
      columns: string[];
      rows: PreviewRow[];
      totalsByCurrency: Record<string, number>;
      rowCount: number;
      sampleCount: number;
    }
  | { ok: false; error: string };

const HEADER_CANDIDATES = [
  "settlement-id",
  "settlement-start-date",
  "settlement-end-date",
  "posted-date",
  "amount",
  "total-amount",
  "amount-type",
  "transaction-type",
  "order-id",
  "currency",
  "amount-currency",
];

const AMOUNT_HEADERS = ["amount", "total-amount"];
const CURRENCY_HEADERS = ["currency", "amount-currency", "currency-code"];
const MAX_PREVIEW_ROWS = 200;

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function findHeaderIndex(headers: string[], candidates: string[]): number | null {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const matchIndex = normalized.indexOf(normalizeHeader(candidate));
    if (matchIndex >= 0) return matchIndex;
  }
  return null;
}

function detectHeaderRow(rows: string[][]): number {
  let fallbackIndex = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const trimmed = row.map((cell) => cell.trim());
    const nonEmpty = trimmed.filter((cell) => cell.length > 0);
    if (nonEmpty.length <= 1) continue;
    if (fallbackIndex === -1) fallbackIndex = index;

    const normalized = trimmed.map(normalizeHeader);
    const matchCount = HEADER_CANDIDATES.reduce((count, candidate) => {
      return normalized.includes(normalizeHeader(candidate)) ? count + 1 : count;
    }, 0);

    if (matchCount >= 2 || (matchCount >= 1 && nonEmpty.length >= 10)) {
      return index;
    }
  }

  return fallbackIndex === -1 ? 0 : fallbackIndex;
}

function buildRecords(columns: string[], rows: string[][]): PreviewRow[] {
  return rows.map((row) => {
    const record: PreviewRow = {};
    columns.forEach((column, index) => {
      record[column] = row[index]?.trim() ?? "";
    });
    return record;
  });
}

function parseSettlementText(text: string) {
  const lines = text.replace(/\uFEFF/g, "").split(/\r?\n/);
  const rawHeader = lines.slice(0, 20);
  const rows = lines
    .map((line) => line.split("\t"))
    .filter((row) => row.some((cell) => cell.trim().length > 0));

  if (rows.length === 0) {
    return {
      rawHeader,
      columns: [],
      rows: [],
      totalsByCurrency: {},
      rowCount: 0,
      sampleCount: 0,
    };
  }

  const headerIndex = detectHeaderRow(rows);
  const columns = rows[headerIndex].map((cell) => cell.trim());
  const dataRows = rows.slice(headerIndex + 1);

  const amountIndex = findHeaderIndex(columns, AMOUNT_HEADERS);
  const currencyIndex = findHeaderIndex(columns, CURRENCY_HEADERS);

  const totalsByCurrency: Record<string, number> = {};
  if (amountIndex !== null) {
    dataRows.forEach((row) => {
      const amountRaw = row[amountIndex] ?? "";
      const amount = parseAmount(amountRaw);
      if (amount === null) return;
      const currency = currencyIndex !== null ? (row[currencyIndex]?.trim() || "UNKNOWN") : "UNKNOWN";
      totalsByCurrency[currency] = (totalsByCurrency[currency] ?? 0) + amount;
    });
  }

  const previewRows = buildRecords(columns, dataRows.slice(0, MAX_PREVIEW_ROWS));

  return {
    rawHeader,
    columns,
    rows: previewRows,
    totalsByCurrency,
    rowCount: dataRows.length,
    sampleCount: previewRows.length,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const reportId = typeof req.query.reportId === "string" ? req.query.reportId : null;
  if (!reportId) {
    return res.status(400).json({ ok: false, error: "Missing reportId" });
  }

  try {
    const report = await amazonGetReport({ reportId });
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

    const parsed = parseSettlementText(text);

    return res.status(200).json({
      ok: true,
      report: {
        reportId: report.reportId,
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
