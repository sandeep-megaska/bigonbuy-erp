import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import Papa from "papaparse";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type GmailSyncError = { messageId: string; error: string };
type GmailSyncResponse = {
  ok: boolean;
  scanned: number;
  imported: number;
  skipped: number;
  errors: GmailSyncError[];
  last_synced_at: string | null;
  error?: string;
};

const DEFAULT_QUERY = "subject:(Settlement OR disbursement OR payout) newer_than:30d";
const MAX_MESSAGES = 50;

type CsvEvent = {
  event_type: "AMAZON_SETTLEMENT" | "INDIFI_DISBURSEMENT";
  event_date: string;
  amount: number;
  reference_no: string | null;
  payload: Record<string, string>;
  platform: "amazon" | "indifi";
  party: "amazon" | "indifi";
};

const amazonHeaderAliases = {
  date: ["settlement date", "settlement_date", "transaction date", "posted date", "date"],
  amount: ["amount", "total amount", "net amount", "total", "payout amount", "settlement amount"],
  credit: ["credit", "credit amount", "credit_amount"],
  debit: ["debit", "debit amount", "debit_amount"],
  creditDebit: ["credit/debit", "crdr", "drcr", "type", "transaction type"],
  reference: ["settlement id", "settlement_id", "settlementid", "reference", "reference_no"],
};

const indifiHeaderAliases = {
  date: ["disbursement date", "date", "transaction date", "value date"],
  amount: ["amount", "disbursement amount", "loan amount", "payout amount", "net amount"],
  credit: ["credit", "credit amount", "credit_amount"],
  debit: ["debit", "debit amount", "debit_amount"],
  creditDebit: ["credit/debit", "crdr", "drcr", "type", "transaction type"],
  reference: ["utr", "reference", "reference no", "reference_no", "payout id", "disbursement id"],
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

function parseCsvEvents(
  rows: Record<string, string>[],
  headers: string[],
  filename: string | null,
  type: "amazon" | "indifi",
): CsvEvent[] {
  const aliases = type === "amazon" ? amazonHeaderAliases : indifiHeaderAliases;
  const dateHeader = findHeader(headers, aliases.date);
  const amountHeader = findHeader(headers, aliases.amount);
  const creditHeader = findHeader(headers, aliases.credit);
  const debitHeader = findHeader(headers, aliases.debit);
  const creditDebitHeader = findHeader(headers, aliases.creditDebit);
  const referenceHeader = findHeader(headers, aliases.reference);

  if (!dateHeader || (!amountHeader && !creditHeader && !debitHeader)) {
    return [];
  }

  const eventType = type === "amazon" ? "AMAZON_SETTLEMENT" : "INDIFI_DISBURSEMENT";
  const party = type === "amazon" ? "amazon" : "indifi";

  return rows.flatMap((row) => {
    const eventDate = parseDateValue(row[dateHeader]);
    if (!eventDate) return [];

    const creditIndicator = creditDebitHeader ? isCreditIndicator(row[creditDebitHeader]) : null;
    const creditAmount = creditHeader ? parseAmount(row[creditHeader]) : null;
    const debitAmount = debitHeader ? parseAmount(row[debitHeader]) : null;
    const baseAmount = amountHeader ? parseAmount(row[amountHeader]) : null;
    let amount = creditAmount ?? baseAmount ?? debitAmount;

    if (amount === null) return [];
    if (creditIndicator === false) return [];
    if (amount < 0) amount = Math.abs(amount);
    if (!Number.isFinite(amount) || amount <= 0) return [];

    const referenceNo = referenceHeader ? String(row[referenceHeader] ?? "").trim() : "";

    return [
      {
        event_type: eventType,
        event_date: eventDate,
        amount,
        reference_no: referenceNo || null,
        payload: { ...row, _filename: filename ?? undefined },
        platform: type,
        party,
      },
    ];
  });
}

function hasHeaderMatch(headers: string[], candidates: string[]) {
  const normalized = headers.map(normalizeHeader);
  return candidates.some((candidate) => normalized.includes(normalizeHeader(candidate)));
}

function isLikelyAmazon(headers: string[], filename: string | null) {
  if (filename && filename.toLowerCase().includes("amazon")) return true;
  return hasHeaderMatch(headers, ["settlement id", "settlement", "amazon"]);
}

function isLikelyIndifi(headers: string[], filename: string | null) {
  if (filename && filename.toLowerCase().includes("indifi")) return true;
  return hasHeaderMatch(headers, ["disbursement", "utr", "payout id", "indifi"]);
}

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

type GmailPart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { data?: string | null; attachmentId?: string | null };
  parts?: GmailPart[];
};

type AttachmentInfo = {
  filename: string;
  mimeType: string | null;
  attachmentId: string | null;
  data: string | null;
};

function collectAttachments(payload?: GmailPart | null, acc: AttachmentInfo[] = []) {
  if (!payload) return acc;
  if (payload.filename) {
    acc.push({
      filename: payload.filename,
      mimeType: payload.mimeType ?? null,
      attachmentId: payload.body?.attachmentId ?? null,
      data: payload.body?.data ?? null,
    });
  }
  if (payload.parts?.length) {
    payload.parts.forEach((part) => collectAttachments(part, acc));
  }
  return acc;
}

function isCsvAttachment(attachment: AttachmentInfo) {
  const filename = attachment.filename.toLowerCase();
  if (filename.endsWith(".csv")) return true;
  if (attachment.mimeType?.toLowerCase().includes("csv")) return true;
  return false;
}

function buildQuery(lastSyncedAt: string | null) {
  if (!lastSyncedAt) return DEFAULT_QUERY;
  const timestamp = Math.floor(new Date(lastSyncedAt).getTime() / 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return DEFAULT_QUERY;
  return `${DEFAULT_QUERY} after:${timestamp}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GmailSyncResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      last_synced_at: null,
      error: "Method not allowed",
    });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res.status(500).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      last_synced_at: null,
      error: `Missing Supabase env vars: ${missing.join(", ")}`,
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      last_synced_at: null,
      error: "Not authenticated",
    });
  }

  const userClient = createUserClient(supabaseUrl!, anonKey!, accessToken);
  const { error: writerError } = await userClient.rpc("erp_require_finance_writer");
  if (writerError) {
    return res.status(403).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      last_synced_at: null,
      error: "Not authorized",
    });
  }

  const { data: settings, error: settingsError } = await userClient.rpc(
    "erp_company_settings_get",
  );
  if (settingsError || !settings?.[0]) {
    return res.status(400).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      last_synced_at: null,
      error: settingsError?.message || "Unable to load company settings",
    });
  }

  const companySettings = settings[0];
  if (!companySettings.gmail_connected) {
    return res.status(400).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: "Gmail is not connected in Company Settings",
    });
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !clientSecret || !refreshToken || !redirectUri) {
    return res.status(500).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: "Missing Gmail OAuth env vars",
    });
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmailClient = google.gmail({ version: "v1", auth: oauth2Client });
  const query = buildQuery(companySettings.gmail_last_synced_at ?? null);

  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  const errors: GmailSyncError[] = [];

  const serviceClient = createServiceRoleClient(supabaseUrl!, serviceRoleKey!);

  try {
    const listResponse = await gmailClient.users.messages.list({
      userId: "me",
      q: query,
      maxResults: MAX_MESSAGES,
    });

    const messages = listResponse.data.messages || [];
    scanned = messages.length;

    for (const message of messages) {
      if (!message.id) continue;
      let ingestId: string | null = null;
      try {
        const messageResponse = await gmailClient.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });
        const payload = messageResponse.data.payload as GmailPart | undefined;
        const headers = messageResponse.data.payload?.headers || [];
        const headerMap = headers.reduce<Record<string, string>>((acc, header) => {
          if (header.name) {
            acc[header.name] = header.value ?? "";
          }
          return acc;
        }, {});

        const subject = headerMap.Subject ?? null;
        const fromEmail = headerMap.From ?? null;
        const receivedAt = messageResponse.data.internalDate
          ? new Date(Number(messageResponse.data.internalDate)).toISOString()
          : null;

        const attachments = collectAttachments(payload);
        const attachmentNames = attachments.map((attachment) => attachment.filename);

        const { data: ingestBatchId, error: ingestError } = await serviceClient.rpc(
          "erp_email_ingest_batch_create_or_get",
          {
            p_gmail_message_id: messageResponse.data.id,
            p_thread_id: messageResponse.data.threadId ?? null,
            p_subject: subject,
            p_from: fromEmail,
            p_received_at: receivedAt,
            p_headers: headerMap,
            p_attachment_names: attachmentNames,
          },
        );

        if (ingestError || !ingestBatchId) {
          throw new Error(ingestError?.message || "Unable to create ingest batch");
        }

        ingestId = ingestBatchId;

        const { data: existingBatch } = await serviceClient
          .from("erp_email_ingest_batches")
          .select("id, status")
          .eq("id", ingestBatchId)
          .maybeSingle();

        if (existingBatch?.status === "parsed" || existingBatch?.status === "skipped") {
          skipped += 1;
          continue;
        }

        const csvAttachments = attachments.filter(isCsvAttachment);
        if (!csvAttachments.length) {
          await serviceClient.rpc("erp_email_ingest_batch_mark", {
            p_id: ingestBatchId,
            p_status: "skipped",
            p_error: "No CSV attachments found",
            p_parsed_event_count: 0,
            p_settlement_batch_id: null,
          });
          skipped += 1;
          continue;
        }

        let events: CsvEvent[] = [];
        for (const attachment of csvAttachments) {
          let data = attachment.data;
          if (!data && attachment.attachmentId) {
            const attachmentResponse = await gmailClient.users.messages.attachments.get({
              userId: "me",
              messageId: message.id,
              id: attachment.attachmentId,
            });
            data = attachmentResponse.data.data ?? null;
          }

          if (!data) continue;
          const csvText = decodeBase64Url(data).toString("utf8");
          const parsed = Papa.parse<Record<string, string>>(csvText, {
            header: true,
            skipEmptyLines: true,
          });
          if (parsed.errors?.length) {
            continue;
          }
          const rows = parsed.data || [];
          if (!rows.length) continue;
          const headers = Object.keys(rows[0] || {});

          if (isLikelyAmazon(headers, attachment.filename)) {
            events = events.concat(parseCsvEvents(rows, headers, attachment.filename, "amazon"));
          }
          if (isLikelyIndifi(headers, attachment.filename)) {
            events = events.concat(parseCsvEvents(rows, headers, attachment.filename, "indifi"));
          }
        }

        if (!events.length) {
          await serviceClient.rpc("erp_email_ingest_batch_mark", {
            p_id: ingestBatchId,
            p_status: "skipped",
            p_error: "No settlement rows parsed from CSV",
            p_parsed_event_count: 0,
            p_settlement_batch_id: null,
          });
          skipped += 1;
          continue;
        }

        const { data: settlementBatchId, error: batchError } = await serviceClient.rpc(
          "erp_settlement_batch_create",
          {
            p_source: "gmail_sync",
            p_source_ref: `gmail:${messageResponse.data.id}`,
            p_received_at: new Date().toISOString(),
            p_raw: {
              gmail_message_id: messageResponse.data.id,
              subject,
              attachment_names: attachmentNames,
              headers: headerMap,
            },
          },
        );

        if (batchError || !settlementBatchId) {
          throw new Error(batchError?.message || "Unable to create settlement batch");
        }

        let insertedCount = 0;
        for (const event of events) {
          const { error: eventError } = await serviceClient.rpc("erp_settlement_event_insert", {
            p_batch_id: settlementBatchId,
            p_platform: event.platform,
            p_event_type: event.event_type,
            p_event_date: event.event_date,
            p_amount: event.amount,
            p_currency: "INR",
            p_reference_no: event.reference_no,
            p_party: event.party,
            p_payload: event.payload,
          });

          if (eventError) {
            if (eventError.code === "23505") {
              continue;
            }
            throw new Error(eventError.message);
          }
          insertedCount += 1;
        }

        await serviceClient.rpc("erp_email_ingest_batch_mark", {
          p_id: ingestBatchId,
          p_status: "parsed",
          p_error: null,
          p_parsed_event_count: insertedCount,
          p_settlement_batch_id: settlementBatchId,
        });

        imported += insertedCount > 0 ? 1 : 0;
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown error";
        errors.push({ messageId: message.id ?? "unknown", error: messageText });
        if (ingestId) {
          await serviceClient.rpc("erp_email_ingest_batch_mark", {
            p_id: ingestId,
            p_status: "error",
            p_error: messageText,
            p_parsed_event_count: 0,
            p_settlement_batch_id: null,
          });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail sync failed";
    return res.status(500).json({
      ok: false,
      scanned,
      imported,
      skipped,
      errors,
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: message,
    });
  }

  const lastSyncedAt = new Date().toISOString();
  const { error: syncUpdateError } = await userClient.rpc("erp_company_settings_update_gmail", {
    p_gmail_user: companySettings.gmail_user ?? null,
    p_connected: true,
    p_last_synced_at: lastSyncedAt,
  });

  if (syncUpdateError) {
    errors.push({
      messageId: "settings",
      error: syncUpdateError.message || "Unable to update last sync time",
    });
  }

  return res.status(200).json({
    ok: errors.length === 0,
    scanned,
    imported,
    skipped,
    errors,
    last_synced_at: lastSyncedAt,
  });
}
