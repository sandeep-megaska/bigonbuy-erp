import type { NextApiRequest, NextApiResponse } from "next";
import Papa from "papaparse";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: unknown };
type SuccessResponse = {
  ok: true;
  data: {
    parsed_count: number;
    attempted_count: number;
    inserted_count: number;
    updated_count: number;
    skipped_count: number;
    failed_count: number;
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

type RowError = {
  line: number;
  settlement_id: string | null;
  reason: string;
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

function parseDateValue(value: unknown): { value: string | null; error: string | null } {
  if (!value) return { value: null, error: null };
  const raw = String(value).trim();
  if (!raw) return { value: null, error: null };

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isNaN(numeric)) {
      const millis = raw.length >= 13 ? numeric : numeric * 1000;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return { value: date.toISOString(), error: null };
    }
  }

  const dayFirstMatch = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?$/
  );
  if (dayFirstMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw, secondRaw] = dayFirstMatch;
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    const hour = Number(hourRaw ?? 0);
    const minute = Number(minuteRaw ?? 0);
    const second = Number(secondRaw ?? 0);
    const parsedDayFirst = new Date(year, month - 1, day, hour, minute, second);
    if (
      !Number.isNaN(parsedDayFirst.getTime()) &&
      parsedDayFirst.getFullYear() === year &&
      parsedDayFirst.getMonth() === month - 1 &&
      parsedDayFirst.getDate() === day
    ) {
      return { value: parsedDayFirst.toISOString(), error: null };
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, error: `Unable to parse date "${raw}"` };
  }
  return { value: parsed.toISOString(), error: null };
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
    return { error: "CSV missing settlement id column", mappedRows: [] as MappedRow[], rowErrors: [] as RowError[] };
  }

  const utrHeader = findHeader(headers, headerAliases.utr);
  const settlementUtrHeader = findHeader(headers, headerAliases.settlementUtr);
  const amountHeader = findHeader(headers, headerAliases.amount);
  const statusHeader = findHeader(headers, headerAliases.status);
  const currencyHeader = findHeader(headers, headerAliases.currency);
  const settledAtHeader = findHeader(headers, headerAliases.settledAt);

  const rowErrors: RowError[] = [];
  const mappedRows = rows.map((row, index) => {
    const settledRaw = settledAtHeader ? row[settledAtHeader] : "";
    const parsedSettledAt = parseDateValue(settledRaw);
    if (parsedSettledAt.error && settledRaw) {
      rowErrors.push({
        line: index + 1,
        settlement_id: settlementIdHeader ? String(row[settlementIdHeader] ?? "").trim() || null : null,
        reason: parsedSettledAt.error,
      });
    }
    const currencyRaw = currencyHeader ? String(row[currencyHeader] ?? "").trim() : "";
    const currency = currencyRaw || "INR";

    return {
      settlement_id: settlementIdHeader ? String(row[settlementIdHeader] ?? "").trim() || null : null,
      utr: utrHeader ? String(row[utrHeader] ?? "").trim() || null : null,
      settlement_utr: settlementUtrHeader ? String(row[settlementUtrHeader] ?? "").trim() || null : null,
      amount: amountHeader ? String(row[amountHeader] ?? "").trim() || null : null,
      status: statusHeader ? String(row[statusHeader] ?? "").trim() || null : null,
      currency,
      settled_at: parsedSettledAt.value,
      raw: row,
    };
  });

  return { error: null, mappedRows, rowErrors };
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

  const { error: mappingError, mappedRows, rowErrors } = mapRows(rows);
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

  const rpcErrors = (data?.errors ?? []) as RowError[];
  const combinedErrors = [...rowErrors, ...rpcErrors];

  return res.status(200).json({
    ok: true,
    data: {
      parsed_count: rows.length,
      attempted_count: aggregatedRows.length,
      inserted_count: data?.inserted_count ?? 0,
      updated_count: data?.updated_count ?? 0,
      skipped_count: data?.skipped_count ?? 0,
      failed_count: combinedErrors.length,
      errors: combinedErrors,
    },
  });
}
