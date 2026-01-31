import type { NextApiRequest, NextApiResponse } from "next";
import { IncomingForm } from "formidable";
import { promises as fs } from "fs";
import Papa from "papaparse";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

export const config = {
  api: {
    bodyParser: false,
  },
};

type ErrorResponse = { ok: false; error: string; details?: unknown };
type SuccessResponse = {
  ok: true;
  data: {
    inserted_count: number;
    updated_count: number;
    skipped_count: number;
    errors: unknown[];
  };
};

type ApiResponse = ErrorResponse | SuccessResponse;

type ParsedRow = Record<string, string>;

type MappedRow = {
  settlement_id: string | null;
  settlement_utr: string | null;
  amount: string | null;
  status: string | null;
  currency: string | null;
  settled_at: string | null;
  raw: ParsedRow;
};

const headerAliases = {
  settlementId: ["settlement_id", "settlementid", "id", "settlement"],
  utr: ["utr", "bank_utr", "utr_number", "bankutr"],
  amount: ["amount", "settled_amount", "net_amount", "netamount"],
  status: ["status", "settlement_status"],
  currency: ["currency", "curr", "settlement_currency"],
  settledAt: ["settled_at", "settlement_date", "created_at", "createdat", "settleddate", "date"],
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeader(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const aliasKey = normalizeHeader(alias);
    const index = normalized.indexOf(aliasKey);
    if (index >= 0) return headers[index];
  }
  return null;
}

function parseDateValue(value: unknown) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isNaN(numeric)) {
      const millis = raw.length >= 13 ? numeric : numeric * 1000;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseForm(req: NextApiRequest) {
  const form = new IncomingForm({ multiples: false });
  return new Promise<{ fields: Record<string, string>; files: Record<string, any> }>((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else {
        const normalizedFields = Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [
            key,
            Array.isArray(value) ? value[0] ?? "" : value ?? "",
          ]),
        );
        resolve({ fields: normalizedFields, files });
      }
    });
  });
}

function getFileFromForm(files: Record<string, any>) {
  const fileEntries = Object.values(files);
  if (!fileEntries.length) return null;
  const file = Array.isArray(fileEntries[0]) ? fileEntries[0][0] : fileEntries[0];
  return file || null;
}

async function readJsonBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) return null;
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch (error) {
    return null;
  }
}

function mapRows(rows: ParsedRow[]) {
  const headers = Object.keys(rows[0] || {});
  const settlementIdHeader = findHeader(headers, headerAliases.settlementId);
  if (!settlementIdHeader) {
    return { error: "CSV missing settlement id column", mappedRows: [] as MappedRow[] };
  }

  const utrHeader = findHeader(headers, headerAliases.utr);
  const amountHeader = findHeader(headers, headerAliases.amount);
  const statusHeader = findHeader(headers, headerAliases.status);
  const currencyHeader = findHeader(headers, headerAliases.currency);
  const settledAtHeader = findHeader(headers, headerAliases.settledAt);

  const mappedRows = rows.map((row) => {
    const settledRaw = settledAtHeader ? row[settledAtHeader] : "";
    const settledAt = parseDateValue(settledRaw) ?? (settledRaw ? String(settledRaw).trim() : null);

    return {
      settlement_id: settlementIdHeader ? String(row[settlementIdHeader] ?? "").trim() || null : null,
      settlement_utr: utrHeader ? String(row[utrHeader] ?? "").trim() || null : null,
      amount: amountHeader ? String(row[amountHeader] ?? "").trim() || null : null,
      status: statusHeader ? String(row[statusHeader] ?? "").trim() || null : null,
      currency: currencyHeader ? String(row[currencyHeader] ?? "").trim() || null : null,
      settled_at: settledAt,
      raw: row,
    };
  });

  return { error: null, mappedRows };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
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

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  let csvText = "";

  if (req.headers["content-type"]?.includes("multipart/form-data")) {
    try {
      const formData = await parseForm(req);
      const uploadFile = getFileFromForm(formData.files);
      if (!uploadFile) {
        return res.status(400).json({ ok: false, error: "CSV file is required" });
      }
      const buffer = await fs.readFile(uploadFile.filepath);
      csvText = buffer.toString("utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid upload";
      return res.status(400).json({ ok: false, error: message });
    }
  } else {
    const body = await readJsonBody(req);
    const csvBase64 = body?.csv_base64 ? String(body.csv_base64) : "";
    const csvRaw = body?.csv_text ? String(body.csv_text) : "";
    if (!csvBase64 && !csvRaw) {
      return res.status(400).json({ ok: false, error: "CSV content is required" });
    }
    csvText = csvBase64 ? Buffer.from(csvBase64, "base64").toString("utf8") : csvRaw;
  }

  const parsed = Papa.parse<ParsedRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors?.length) {
    return res.status(400).json({ ok: false, error: "Unable to parse CSV", details: parsed.errors });
  }

  const rows = parsed.data || [];
  if (!rows.length) {
    return res.status(400).json({ ok: false, error: "CSV is empty" });
  }

  const { error: mappingError, mappedRows } = mapRows(rows);
  if (mappingError) {
    return res.status(400).json({ ok: false, error: mappingError });
  }

  const { data, error } = await userClient.rpc("erp_razorpay_settlement_upsert_from_csv", {
    p_rows: mappedRows,
  });

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Failed to import settlements",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({
    ok: true,
    data: {
      inserted_count: data?.inserted_count ?? 0,
      updated_count: data?.updated_count ?? 0,
      skipped_count: data?.skipped_count ?? 0,
      errors: data?.errors ?? [],
    },
  });
}
