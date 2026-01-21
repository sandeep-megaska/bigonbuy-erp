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

const numericPreprocess = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim();
  return value;
};

const numberField = z.preprocess(numericPreprocess, z.coerce.number());
const optionalNumberField = z.preprocess(numericPreprocess, z.coerce.number()).optional();

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

const normalizeNoteKind = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["cn", "credit"].includes(normalized)) return "CN";
  if (["dn", "debit"].includes(normalized)) return "DN";
  return value;
};

const noteKindField = z.preprocess(normalizeNoteKind, z.enum(["CN", "DN"]));

const noteTypeField = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return undefined;
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

const noteSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.lines) && Array.isArray(record.items)) {
      return { ...record, lines: record.items };
    }
    return record;
  },
  z
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

      if (value.note_kind && value.note_type && value.note_kind !== value.note_type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["note_type"],
          message: "note_type does not match note_kind",
        });
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
    })
);

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

const mapNoteKindForDb = (noteKind: string | undefined, noteType: string | undefined) => {
  const resolved = noteKind ?? noteType;
  if (resolved === "CN") return "credit";
  if (resolved === "DN") return "debit";
  return undefined;
};

const runDevSchemaChecks = () => {
  if (process.env.NODE_ENV !== "development") return;
  const globalKey = "__erpNoteSchemaChecks";
  if ((globalThis as Record<string, unknown>)[globalKey]) return;
  (globalThis as Record<string, unknown>)[globalKey] = true;

  const samples = [
    {
      label: "Debit Note sample",
      payload: {
        party_type: "vendor",
        note_kind: "debit",
        note_date: "2024-08-14T10:15:00.000Z",
        party_id: "0f1f1c3b-3d29-44b3-a1cf-8e5fe00ff7a2",
        party_name: "Acme Supplies",
        currency: "inr",
        reference_invoice_number: "INV-100",
        reference_invoice_date: "2024-08-01T00:00:00.000Z",
        reason: "Price adjustment",
        place_of_supply: "KA",
        items: [
          {
            item_type: "manual",
            sku: "SKU-100",
            title: "Adjustment",
            qty: "2",
            unit_rate: "500.50",
            tax_rate: "18",
          },
        ],
      },
    },
    {
      label: "Credit Note sample",
      payload: {
        party_type: "customer",
        note_kind: "CN",
        note_date: "2024-07-20",
        party_id: null,
        party_name: "Test Customer",
        currency: "USD",
        reference_invoice_number: "INV-200",
        reference_invoice_date: "2024-07-10",
        reason: "Return",
        place_of_supply: "CA",
        lines: [
          {
            item_type: "variant",
            variant_id: "7d2d15c6-2f29-4b4f-bb46-7c49f2a3a999",
            sku: "SKU-200",
            title: "Widget",
            qty: 1,
            unit_rate: 120,
            tax_rate: 5,
          },
        ],
      },
    },
  ];

  samples.forEach(({ label, payload }) => {
    const result = noteSchema.safeParse(payload);
    if (!result.success) {
      console.warn("Note schema dev check failed", { label, issues: result.error.issues });
    } else {
      console.info("Note schema dev check passed", {
        label,
        note_kind: result.data.note_kind,
        note_date: result.data.note_date,
      });
    }
  });
};

runDevSchemaChecks();

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

  const noteKind = mapNoteKindForDb(parseResult.data.note_kind, parseResult.data.note_type);
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
