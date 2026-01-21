import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import { z } from "zod";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type Issue = { path: string; message: string };

type ErrorResponse = {
  ok: false;
  error: string;
  correlationId: string;
  issues?: Issue[];
  payloadSummary?: Record<string, string>;
};

type SuccessResponse = {
  ok: true;
  noteId: string;
};

type ApiResponse = ErrorResponse | SuccessResponse;

const emptyToUndefined = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  return value;
};

const optionalString = z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable().optional());

const requiredString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim();
}, z.string().min(1));

const optionalUuid = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return null;
  return value;
}, z.string().uuid().nullable().optional());

const numberField = z.preprocess(emptyToUndefined, z.coerce.number());
const optionalNumberField = z.preprocess(emptyToUndefined, z.coerce.number()).optional();

const dateField = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString().slice(0, 10);
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

const noteKindField = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase();
}, z.enum(["credit", "debit"]));

const noteTypeField = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim().toUpperCase();
}, z.enum(["CN", "DN"]));

const lineSchema = z.object({
  item_type: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    return value.trim().toLowerCase();
  }, z.enum(["manual", "variant"])),
  variant_id: optionalUuid,
  sku: optionalString,
  title: optionalString,
  hsn: optionalString,
  qty: numberField,
  unit_rate: numberField,
  tax_rate: numberField,
  rate: optionalNumberField,
  amount: optionalNumberField,
  discount: optionalNumberField,
  tax_amount: optionalNumberField,
});

const noteSchema = z
  .object({
    id: z.preprocess(emptyToUndefined, z.string().uuid()).optional(),
    party_type: z.preprocess((value) => {
      if (typeof value !== "string") return value;
      return value.trim().toLowerCase();
    }, z.enum(["customer", "vendor"])),
    note_kind: noteKindField.optional(),
    note_type: noteTypeField.optional(),
    note_date: dateField,
    party_id: optionalUuid,
    party_name: requiredString,
    currency: z.preprocess((value) => {
      if (typeof value !== "string") return value;
      return value.trim().toUpperCase();
    }, z.string().min(1)),
    source_type: optionalString,
    source_id: optionalUuid,
    reference_invoice_number: requiredString,
    reference_invoice_date: dateField,
    reason: requiredString,
    place_of_supply: requiredString,
    lines: z.array(lineSchema).nonempty({ message: "At least one line item is required" }),
    subtotal: optionalNumberField,
    tax_total: optionalNumberField,
    total: optionalNumberField,
    shipping: optionalNumberField,
    round_off: optionalNumberField,
    discount: optionalNumberField,
    tax_amount: optionalNumberField,
    amount: optionalNumberField,
  })
  .superRefine((value, ctx) => {
    if (!value.note_kind && !value.note_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note_kind"],
        message: "note_kind or note_type is required",
      });
    }

    if (value.note_kind && value.note_type) {
      const derivedKind = value.note_type === "CN" ? "credit" : "debit";
      if (value.note_kind !== derivedKind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["note_type"],
          message: "note_type does not match note_kind",
        });
      }
    }

    if (value.party_type === "vendor" && !value.party_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["party_id"],
        message: "Vendor party_id is required for vendor notes",
      });
    }

    value.lines.forEach((line, index) => {
      if (line.item_type === "variant" && !line.variant_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index, "variant_id"],
          message: "variant_id is required for variant line items",
        });
      }
    });
  });

const summarizePayload = (payload: unknown): Record<string, string> => {
  if (!payload || typeof payload !== "object") {
    return { payload: typeof payload };
  }

  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      summary[key] = "array";
      if (value.length > 0 && value[0] && typeof value[0] === "object") {
        const lineSummary: Record<string, string> = {};
        for (const [lineKey, lineValue] of Object.entries(value[0] as Record<string, unknown>)) {
          lineSummary[lineKey] = lineValue === null ? "null" : typeof lineValue;
        }
        summary["lineItemTypes"] = JSON.stringify(lineSummary);
      }
      continue;
    }

    summary[key] = value === null ? "null" : typeof value;
  }

  return summary;
};

const toIssueList = (issues: z.ZodIssue[]): Issue[] =>
  issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

const mapNoteKind = (noteKind: string | undefined, noteType: string | undefined) => {
  if (noteKind) return noteKind;
  if (noteType === "CN") return "credit";
  if (noteType === "DN") return "debit";
  return undefined;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
      correlationId: randomUUID().slice(0, 8),
    });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
      correlationId: randomUUID().slice(0, 8),
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token", correlationId: randomUUID().slice(0, 8) });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated", correlationId: randomUUID().slice(0, 8) });
  }

  const parseResult = noteSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    const correlationId = randomUUID().slice(0, 8);
    console.warn("Failed to parse note payload", {
      correlationId,
      issues: parseResult.error.issues,
    });

    return res.status(400).json({
      ok: false,
      error: "Failed to parse note payload",
      correlationId,
      issues: toIssueList(parseResult.error.issues),
      payloadSummary: summarizePayload(req.body),
    });
  }

  const noteKind = mapNoteKind(parseResult.data.note_kind, parseResult.data.note_type);
  if (!noteKind) {
    const correlationId = randomUUID().slice(0, 8);
    return res.status(400).json({
      ok: false,
      error: "note_kind or note_type is required",
      correlationId,
    });
  }

  const payload = {
    id: parseResult.data.id,
    party_type: parseResult.data.party_type,
    note_kind: noteKind,
    note_date: parseResult.data.note_date,
    party_id: parseResult.data.party_id ?? null,
    party_name: parseResult.data.party_name,
    currency: parseResult.data.currency,
    source_type: parseResult.data.source_type ?? null,
    source_id: parseResult.data.source_id ?? null,
    reference_invoice_number: parseResult.data.reference_invoice_number,
    reference_invoice_date: parseResult.data.reference_invoice_date,
    reason: parseResult.data.reason,
    place_of_supply: parseResult.data.place_of_supply,
    lines: parseResult.data.lines.map((line) => ({
      item_type: line.item_type,
      variant_id: line.variant_id ?? null,
      sku: line.sku ?? "",
      title: line.title ?? "",
      hsn: line.hsn ?? "",
      qty: line.qty,
      unit_rate: line.unit_rate,
      tax_rate: line.tax_rate,
    })),
  };

  const { data, error } = await userClient.rpc("erp_note_upsert", { p_note: payload });
  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to save note",
      correlationId: randomUUID().slice(0, 8),
    });
  }

  return res.status(200).json({ ok: true, noteId: data });
}
