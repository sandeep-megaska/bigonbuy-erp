import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
} from "../../../../lib/serverSupabase";

type GmailSyncError = { messageId: string; error: string };
type GmailSyncResponse = {
  ok: boolean;
  scanned: number;
  imported: number;
  skipped: number;
  totals: {
    amazon: number;
    indifi_in: number;
    indifi_out: number;
    deduped: number;
  };
  errors: GmailSyncError[];
  last_synced_at: string | null;
  error?: string;
};

const MAX_MESSAGES = 300;
const AMOUNT_REGEX = /INR\s*([0-9][0-9,]*\.\d{2})/i;

type GmailKind = "AMAZON" | "INDIFI_IN" | "INDIFI_OUT";

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

function findBodyInParts(
  payload?: GmailPart | null,
  preferredMime: string[] = ["text/plain", "text/html"],
): string | null {
  if (!payload) return null;
  if (payload.body?.data && payload.mimeType && preferredMime.includes(payload.mimeType)) {
    return decodeBase64Url(payload.body.data).toString("utf8");
  }
  if (payload.parts?.length) {
    for (const mime of preferredMime) {
      for (const part of payload.parts) {
        const found = findBodyInParts(part, [mime]);
        if (found) return found;
      }
    }
    for (const part of payload.parts) {
      const found = findBodyInParts(part, preferredMime);
      if (found) return found;
    }
  }
  return null;
}

function formatGmailDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function parseDateParam(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function extractAmount(body: string) {
  const match = body.match(AMOUNT_REGEX);
  if (!match) return null;
  const numeric = match[1].replace(/,/g, "");
  const parsed = Number.parseFloat(numeric);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toCompanyDate(internalDateMs: string, timeZone: string) {
  const date = new Date(Number(internalDateMs));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
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
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
      errors: [],
      last_synced_at: null,
      error: "Method not allowed",
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    return res.status(500).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
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
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
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
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
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
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
      errors: [],
      last_synced_at: null,
      error: settingsError?.message || "Unable to load company settings",
    });
  }

  const companySettings = settings[0];
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  const gmailUserEnv = process.env.GMAIL_USER?.trim() || null;

  if (!refreshToken) {
    return res.status(500).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
      errors: [],
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: "Gmail token not configured. Set GMAIL_REFRESH_TOKEN in Vercel.",
    });
  }

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
      errors: [],
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: "Missing Gmail OAuth env vars",
    });
  }

  if (!companySettings.gmail_connected) {
    const { error: connectError } = await userClient.rpc("erp_company_settings_update_gmail", {
      p_gmail_user: gmailUserEnv ?? companySettings.gmail_user ?? null,
      p_connected: true,
      p_last_synced_at: companySettings.gmail_last_synced_at ?? null,
    });

    if (connectError) {
      return res.status(500).json({
        ok: false,
        scanned: 0,
        imported: 0,
        skipped: 0,
        totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
        errors: [],
        last_synced_at: companySettings.gmail_last_synced_at ?? null,
        error: connectError.message || "Unable to update Gmail connection status",
      });
    }
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmailClient = google.gmail({ version: "v1", auth: oauth2Client });

  const startParam = Array.isArray(req.query.start) ? req.query.start[0] : req.query.start;
  const endParam = Array.isArray(req.query.end) ? req.query.end[0] : req.query.end;
  if (!startParam || !endParam || typeof startParam !== "string" || typeof endParam !== "string") {
    return res.status(400).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
      errors: [],
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: "Missing start or end date",
    });
  }

  const startDate = parseDateParam(startParam);
  const endDate = parseDateParam(endParam);
  if (!startDate || !endDate) {
    return res.status(400).json({
      ok: false,
      scanned: 0,
      imported: 0,
      skipped: 0,
      totals: { amazon: 0, indifi_in: 0, indifi_out: 0, deduped: 0 },
      errors: [],
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: "Invalid date format. Use YYYY-MM-DD.",
    });
  }

  const startQ = formatGmailDate(startDate);
  const endPlus1Q = formatGmailDate(addDays(endDate, 1));

  const qAmazon = `after:${startQ} before:${endPlus1Q} subject:"Your payment is on the way"`;
  const qIndifiIn = `after:${startQ} before:${endPlus1Q} subject:"Payment received in virtual account"`;
  const qOutBoth = `after:${startQ} before:${endPlus1Q} subject:"Payment release successful"`;

  let scanned = 0;
  let imported = 0;
  let skipped = 0;
  const totals = {
    amazon: 0,
    indifi_in: 0,
    indifi_out: 0,
    deduped: 0,
  };
  const errors: GmailSyncError[] = [];

  const adminClient = createServiceRoleClient(supabaseUrl!, serviceRoleKey!);
  const companyTimeZone =
    companySettings.timezone ?? companySettings.time_zone ?? "Asia/Kolkata";

  try {
    const [amazonList, indifiInList, indifiOutList] = await Promise.all([
      gmailClient.users.messages.list({ userId: "me", q: qAmazon, maxResults: MAX_MESSAGES }),
      gmailClient.users.messages.list({ userId: "me", q: qIndifiIn, maxResults: MAX_MESSAGES }),
      gmailClient.users.messages.list({ userId: "me", q: qOutBoth, maxResults: MAX_MESSAGES }),
    ]);

    const amazonMessages = amazonList.data.messages || [];
    const indifiInMessages = indifiInList.data.messages || [];
    const indifiOutMessages = indifiOutList.data.messages || [];
    totals.amazon = amazonMessages.length;
    totals.indifi_in = indifiInMessages.length;
    totals.indifi_out = indifiOutMessages.length;

    const queued = new Map<string, GmailKind>();
    amazonMessages.forEach((message) => {
      if (message.id) queued.set(message.id, "AMAZON");
    });
    indifiInMessages.forEach((message) => {
      if (message.id && !queued.has(message.id)) queued.set(message.id, "INDIFI_IN");
    });
    indifiOutMessages.forEach((message) => {
      if (message.id && !queued.has(message.id)) queued.set(message.id, "INDIFI_OUT");
    });

    const messages = Array.from(queued.entries()).map(([id, kind]) => ({ id, kind }));
    totals.deduped = messages.length;
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
        const receivedAtMs = messageResponse.data.internalDate ?? null;
        const receivedAt = receivedAtMs ? new Date(Number(receivedAtMs)).toISOString() : null;
        const attachments = collectAttachments(payload);
        const attachmentNames = attachments.map((attachment) => attachment.filename);

        const { data: ingestBatchId, error: ingestError } = await adminClient.rpc(
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

        const { data: existingBatch } = await adminClient
          .from("erp_email_ingest_batches")
          .select("id, status")
          .eq("id", ingestBatchId)
          .maybeSingle();

        if (existingBatch?.status === "parsed" || existingBatch?.status === "skipped") {
          skipped += 1;
          continue;
        }

        ingestId = ingestBatchId;

        const body = findBodyInParts(payload) ?? messageResponse.data.snippet ?? "";
        const amount = body ? extractAmount(body) : null;
        if (!amount || !receivedAtMs) {
          await adminClient.rpc("erp_email_ingest_batch_mark", {
            p_id: ingestBatchId,
            p_status: "skipped",
            p_error: !receivedAtMs
              ? "Missing internal date"
              : "Unable to parse INR amount",
            p_parsed_event_count: 0,
            p_settlement_batch_id: null,
          });
          skipped += 1;
          continue;
        }

        const { data: settlementBatchId, error: batchError } = await adminClient.rpc(
          "erp_settlement_batch_create",
          {
            p_source: "gmail_sync",
            p_source_ref: `gmail:${messageResponse.data.id}`,
            p_received_at: new Date().toISOString(),
            p_raw: {
              gmail_message_id: messageResponse.data.id,
              subject,
              body,
              kind: message.kind,
              attachment_names: attachmentNames,
              headers: headerMap,
            },
          },
        );

        if (batchError || !settlementBatchId) {
          throw new Error(batchError?.message || "Unable to create settlement batch");
        }

        const eventDate = toCompanyDate(receivedAtMs, companyTimeZone);
        let eventType = "AMAZON_SETTLEMENT";
        let party: "amazon" | "indifi" = "amazon";
        let platform: "amazon" | "indifi" = "amazon";
        if (message.kind === "INDIFI_IN") {
          eventType = "INDIFI_VIRTUAL_RECEIPT";
          party = "indifi";
          platform = "indifi";
        } else if (message.kind === "INDIFI_OUT") {
          eventType = /Indifi\s+Capital\s+Pvt\s+Ltd/i.test(body)
            ? "INDIFI_RELEASE_TO_INDIFI"
            : "INDIFI_RELEASE_TO_BANK";
          party = "indifi";
          platform = "indifi";
        }

        const { error: eventError } = await adminClient.rpc("erp_settlement_event_insert", {
          p_batch_id: settlementBatchId,
          p_platform: platform,
          p_event_type: eventType,
          p_event_date: eventDate,
          p_amount: amount,
          p_currency: "INR",
          p_reference_no: null,
          p_party: party,
          p_payload: {
            gmail_message_id: messageResponse.data.id,
            subject,
            body,
            kind: message.kind,
          },
        });

        if (eventError) {
          if (eventError.code === "23505") {
            await adminClient.rpc("erp_email_ingest_batch_mark", {
              p_id: ingestBatchId,
              p_status: "skipped",
              p_error: "Duplicate settlement event",
              p_parsed_event_count: 0,
              p_settlement_batch_id: settlementBatchId,
            });
            skipped += 1;
            continue;
          }
          throw new Error(eventError.message);
        }

        await adminClient.rpc("erp_email_ingest_batch_mark", {
          p_id: ingestBatchId,
          p_status: "parsed",
          p_error: null,
          p_parsed_event_count: 1,
          p_settlement_batch_id: settlementBatchId,
        });

        imported += 1;
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown error";
        errors.push({ messageId: message.id ?? "unknown", error: messageText });
        if (ingestId) {
          await adminClient.rpc("erp_email_ingest_batch_mark", {
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
      totals,
      errors,
      last_synced_at: companySettings.gmail_last_synced_at ?? null,
      error: message,
    });
  }

  const lastSyncedAt = new Date().toISOString();
  const { error: syncUpdateError } = await userClient.rpc("erp_company_settings_update_gmail", {
    p_gmail_user: gmailUserEnv ?? companySettings.gmail_user ?? null,
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
    totals,
    errors,
    last_synced_at: lastSyncedAt,
  });
}
