import { z } from "zod";

export const noteLineSchema = z.object({
  id: z.string().uuid().optional(),
  line_no: z.coerce.number().optional(),
  item_type: z.string(),
  variant_id: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  title: z.string().nullable(),
  hsn: z.string().nullable(),
  qty: z.coerce.number(),
  unit_rate: z.coerce.number(),
  tax_rate: z.coerce.number(),
  line_subtotal: z.coerce.number().optional(),
  line_tax: z.coerce.number().optional(),
  line_total: z.coerce.number().optional(),
});

export type NoteLine = z.infer<typeof noteLineSchema>;

export const noteHeaderSchema = z.object({
  id: z.string().uuid(),
  doc_no: z.string().nullable(),
  party_type: z.string(),
  note_kind: z.string(),
  status: z.string(),
  note_date: z.string(),
  party_id: z.string().uuid().nullable(),
  party_name: z.string(),
  currency: z.string(),
  subtotal: z.coerce.number(),
  tax_total: z.coerce.number(),
  total: z.coerce.number(),
  source_type: z.string().nullable(),
  source_id: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  approved_by: z.string().uuid().nullable().optional(),
  cancelled_at: z.string().nullable(),
  cancelled_by: z.string().uuid().nullable().optional(),
  cancel_reason: z.string().nullable(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const noteGetSchema = z.object({
  note: noteHeaderSchema,
  lines: z.array(noteLineSchema),
});

export type NoteGetPayload = z.infer<typeof noteGetSchema>;

export const noteListRowSchema = z.object({
  id: z.string().uuid(),
  doc_no: z.string().nullable(),
  party_type: z.string(),
  note_kind: z.string(),
  status: z.string(),
  note_date: z.string(),
  party_id: z.string().uuid().nullable(),
  party_name: z.string(),
  currency: z.string(),
  subtotal: z.coerce.number(),
  tax_total: z.coerce.number(),
  total: z.coerce.number(),
  source_type: z.string().nullable(),
  source_id: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
});

export const noteListResponseSchema = z.array(noteListRowSchema);

export type NoteListRow = z.infer<typeof noteListRowSchema>;

export type NoteLineInput = {
  item_type: string;
  variant_id: string | null;
  sku: string;
  title: string;
  hsn: string;
  qty: number;
  unit_rate: number;
  tax_rate: number;
};

export type NoteFormPayload = {
  id?: string | null;
  party_type: string;
  note_kind: string;
  note_date: string;
  party_id: string | null;
  party_name: string;
  currency: string;
  source_type: string | null;
  source_id: string | null;
  lines: NoteLineInput[];
};

export const ensureNumber = (value: string | number) => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
