import type { NextApiRequest, NextApiResponse } from "next";
import Papa from "papaparse";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

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

type ParsedRow = Record<string, unknown>;

type MappedRow = {
  settlement_id: string | null;
  utr: string | null;
  settlement_utr: string | null;
  amount: string | null;
  status: string | null;
  currency: string | null;
  settled_at: string | null;
  raw: ParsedRow;
};

type AggregatedRow = {
  settlement_id: string | null;
  utr: string | null;
  settlement_utr: string | null;
  amount: string | null;
  currency: string | null;
  settled_at: string | null;
  raw: ParsedRow[];
};

const headerAliases = {
  settlementId: ["settlement_id", "settlementid", "id", "settlement"],
  utr: ["utr", "bank_utr", "utr_number", "bankutr", "payout_utr", "bank_reference", "rrn"],
  settlementUtr: ["additional_utr", "additionalutr", "settlement_utr", "settlementutr"],
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

function parseAmount(value: string | null) {
  if (!value) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (Number.isNaN(numeric)) return null;
  return numeric;
}

function aggregateRows(rows: MappedRow[]): AggregatedRow[] {
  const grouped = new Map<string, AggregatedRow>();

  for (const row of rows) {
    const key = row.settlement_id ?? "";
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        settlement_id: row.settlement_id,
        utr: row.utr,
        settlement_utr: row.settlement_utr,
        amount: row.amount,
        currency: row.currency,
        settled_at: row.settled_at,
        raw: [row.raw],
      });
      continue;
    }

    const currentAmount = parseAmount(existing.amount);
    const rowAmount = parseAmount(row.amount);
    if (rowAmount !== null || currentAmount !== null) {
      const total = (currentAmount ?? 0) + (rowAmount ?? 0);
      existing.amount = total.toString();
    }

    if (!existing.currency && row.currency) {
      existing.currency = row.currency;
    }

    if (!existing.utr && row.utr) {
      existing.utr = row.utr;
    }

    if (!existing.settlement_utr && row.settlement_utr) {
      existing.settlement_utr = row.settlement_utr;
    }

    if (row.settled_at) {
      if (!existing.settled_at) {
        existing.settled_at = row.settled_at;
      } else {
        const existingTime = new Date(existing.settled_at).getTime();
        const rowTime = new Date(row.settled_at).getTime();
        if (!Number.isNaN(rowTime) && (Number.isNaN(existingTime) || rowTime > existingTime)) {
          existing.settled_at = row.settled_at;
        }
      }
    }

    existing.raw.push(row.raw);
  }

  return Array.from(grouped.values());
}

function mapRows(rows: ParsedRow[]) {
  const headers = Object.keys(rows[0] || {});
  const settlementIdHeader = findHeader(headers, headerAliases.settlementId);
  if (!settlementIdHeader) {
    return { error: "CSV missing settlement id column", mappedRows: [] as MappedRow[] };
  }

  const utrHeader = findHeader(headers, headerAliases.utr);
  const settlementUtrHeader = findHeader(headers, headerAliases.settlementUtr);
  const amountHeader = findHeader(headers, headerAliases.amount);
  const statusHeader = findHeader(headers, headerAliases.status);
  const currencyHeader = findHeader(headers, headerAliases.currency);
  const settledAtHeader = findHeader(headers, headerAliases.settledAt);

  const mappedRows = rows.map((row) => {
    const settledRaw = settledAtHeader ? row[settledAtHeader] : "";
    const settledAt = parseDateValue(settledRaw) ?? (settledRaw ? String(settledRaw).trim() : null);

    return {
      settlement_id: settlementIdHeader ? String(row[settlementIdHeader] ?? "").trim() || null : null,
      utr: utrHeader ? String(row[utrHeader] ?? "").trim() || null : null,
      settlement_utr: settlementUtrHeader ? String(row[settlementUtrHeader] ?? "").trim() || null : null,
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

  const providedRows: unknown[] | null = Array.isArray(req.body?.rows) ? req.body.rows : null;
  let rows: ParsedRow[] = [];

  if (providedRows?.length) {
    rows = providedRows.filter((row: unknown): row is ParsedRow => !!row && typeof row === "object");
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "Rows payload is empty" });
    }
  } else {
    const csvContent = req.body?.csvContent ? String(req.body.csvContent) : "";
    if (!csvContent) {
      return res.status(400).json({ ok: false, error: "CSV content is required" });
    }

    const parsed = Papa.parse<ParsedRow>(csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      return res.status(400).json({ ok: false, error: "Unable to parse CSV", details: parsed.errors });
    }

    rows = parsed.data || [];
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "CSV is empty" });
    }
  }

  const { error: mappingError, mappedRows } = mapRows(rows);
  if (mappingError) {
    return res.status(400).json({ ok: false, error: mappingError });
  }

  const aggregatedRows = aggregateRows(mappedRows);

  const { data, error } = await userClient.rpc("erp_razorpay_settlement_upsert_from_csv", {
    p_rows: aggregatedRows,
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
