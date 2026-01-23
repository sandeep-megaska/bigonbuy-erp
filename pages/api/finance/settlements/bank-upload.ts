import type { NextApiRequest, NextApiResponse } from "next";
import { IncomingForm } from "formidable";
import { promises as fs } from "fs";
import Papa from "papaparse";
import { getBearerToken, getSupabaseEnv, createServiceRoleClient, createUserClient } from "../../../../lib/serverSupabase";

export const config = {
  api: {
    bodyParser: false,
  },
};

const headerAliases = {
  date: ["date", "transactiondate", "valuedate", "txnDate", "transaction_date"],
  description: ["description", "narration", "particulars", "details"],
  amount: ["amount", "amt", "transactionamount", "transaction_amount"],
  credit: ["credit", "creditamount", "cramount", "deposit", "credit_amount"],
  debit: ["debit", "debitamount", "dramount", "withdrawal", "debit_amount"],
  creditDebit: ["creditdebit", "crdr", "drcr", "type", "transactiontype"],
  reference: ["utr", "refno", "referencenumber", "utrrefno", "utrref", "refnumber", "rrn", "transactionid"],
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

function parseAmount(value: unknown) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function parseDateValue(value: unknown) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const match = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    let year = Number.parseInt(match[3], 10);
    if (year < 100) year += 2000;
    const iso = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(iso.getTime())) {
      return iso.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function isCreditIndicator(value: unknown) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("credit") || normalized === "cr" || normalized === "c") return true;
  if (normalized.includes("debit") || normalized === "dr" || normalized === "d") return false;
  return null;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res.status(500).json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const userClient = createUserClient(supabaseUrl!, anonKey!, accessToken);
  const { error: authError } = await userClient.rpc("erp_require_finance_writer");
  if (authError) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  let formData;
  try {
    formData = await parseForm(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid upload";
    return res.status(400).json({ ok: false, error: message });
  }

  const uploadFile = getFileFromForm(formData.files);
  if (!uploadFile) {
    return res.status(400).json({ ok: false, error: "CSV file is required" });
  }

  const buffer = await fs.readFile(uploadFile.filepath);
  const csvText = buffer.toString("utf8");

  const parsed = Papa.parse<Record<string, string>>(csvText, {
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

  const headers = Object.keys(rows[0] || {});
  const dateHeader = findHeader(headers, headerAliases.date);
  const amountHeader = findHeader(headers, headerAliases.amount);
  const creditHeader = findHeader(headers, headerAliases.credit);
  const debitHeader = findHeader(headers, headerAliases.debit);
  const creditDebitHeader = findHeader(headers, headerAliases.creditDebit);
  const referenceHeader = findHeader(headers, headerAliases.reference);
  const descriptionHeader = findHeader(headers, headerAliases.description);

  if (!dateHeader || (!amountHeader && !creditHeader)) {
    return res.status(400).json({
      ok: false,
      error: "CSV missing required columns",
      details: { dateHeader, amountHeader, creditHeader },
    });
  }

  const events = rows.flatMap((row) => {
    const eventDate = parseDateValue(row[dateHeader]);
    if (!eventDate) return [];

    const creditIndicator = creditDebitHeader ? isCreditIndicator(row[creditDebitHeader]) : null;
    const creditAmount = creditHeader ? parseAmount(row[creditHeader]) : null;
    const debitAmount = debitHeader ? parseAmount(row[debitHeader]) : null;
    const baseAmount = amountHeader ? parseAmount(row[amountHeader]) : null;

    let amount = creditAmount ?? baseAmount;
    if (amount === null) return [];

    if (creditIndicator === false) return [];
    if (creditIndicator === null && debitAmount && debitAmount > 0 && !creditAmount) return [];

    amount = Math.abs(amount);
    if (!Number.isFinite(amount) || amount <= 0) return [];

    const referenceNo = referenceHeader ? String(row[referenceHeader] ?? "").trim() : "";
    const narration = descriptionHeader ? String(row[descriptionHeader] ?? "").trim() : "";

    return [
      {
        date: eventDate,
        amount,
        reference_no: referenceNo || null,
        narration: narration || null,
      },
    ];
  });

  if (!events.length) {
    return res.status(400).json({ ok: false, error: "No credit entries found in CSV" });
  }

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
      details: companyError?.details || companyError?.hint || companyError?.code,
    });
  }

  const serviceClient = createServiceRoleClient(supabaseUrl!, serviceRoleKey!);
  const { data: importResult, error: importError } = await serviceClient.rpc(
    "erp_settlement_bank_csv_import",
    {
      p_company_id: companyId,
      p_rows: events,
    }
  );

  if (importError) {
    return res.status(400).json({
      ok: false,
      error: importError.message,
      details: importError.details || importError.hint || importError.code,
    });
  }

  return res.status(200).json({
    ok: true,
    batch_id: importResult?.batch_id || null,
    inserted_count: importResult?.inserted || 0,
    skipped_count: importResult?.skipped || 0,
    error_count: importResult?.errors || 0,
  });
}
