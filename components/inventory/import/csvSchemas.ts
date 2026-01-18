import { z } from "zod";

const trimmedRequiredString = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`);

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value ? value : undefined))
  .optional();

const dateString = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .refine((value) => value.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: `${label} must be YYYY-MM-DD`,
    })
    .transform((value) => (value.length ? value : undefined));

const integerString = (label: string, options: { min: number }) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => /^\d+$/.test(value), {
      message: `${label} must be an integer`,
    })
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= options.min, {
      message: `${label} must be ${options.min} or greater`,
    });

export const salesImportRowSchema = z.object({
  date: dateString("date"),
  warehouse_code: trimmedRequiredString("warehouse_code"),
  channel_code: trimmedRequiredString("channel_code"),
  sku: trimmedRequiredString("sku"),
  qty: integerString("qty", { min: 1 }),
  reference: optionalTrimmedString,
  notes: optionalTrimmedString,
});

export const stocktakeImportRowSchema = z.object({
  date: dateString("date"),
  warehouse_code: trimmedRequiredString("warehouse_code"),
  sku: trimmedRequiredString("sku"),
  counted_qty: integerString("counted_qty", { min: 0 }),
  reference: optionalTrimmedString,
  notes: optionalTrimmedString,
});

export type SalesImportCsvRow = z.infer<typeof salesImportRowSchema>;
export type StocktakeImportCsvRow = z.infer<typeof stocktakeImportRowSchema>;

export const salesImportResponseSchema = z.object({
  results: z.array(
    z.object({
      row_index: z.number().int(),
      ok: z.boolean(),
      message: z.string().nullable().optional(),
      warehouse_id: z.string().uuid().nullable().optional(),
      channel_id: z.string().uuid().nullable().optional(),
      variant_id: z.string().uuid().nullable().optional(),
      qty: z.number().int().nullable().optional(),
      date: z.string().nullable().optional(),
      consumption_id: z.string().uuid().nullable().optional(),
    })
  ),
  posted_count: z.number().int(),
  error_count: z.number().int(),
  created_doc_ids: z.array(z.string().uuid()),
  group_count: z.number().int(),
});

export const stocktakeImportResponseSchema = z.object({
  results: z.array(
    z.object({
      row_index: z.number().int(),
      ok: z.boolean(),
      message: z.string().nullable().optional(),
      warehouse_id: z.string().uuid().nullable().optional(),
      variant_id: z.string().uuid().nullable().optional(),
      counted_qty: z.number().int().nullable().optional(),
      on_hand: z.number().int().nullable().optional(),
      delta: z.number().int().nullable().optional(),
      ledger_type: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      stocktake_id: z.string().uuid().nullable().optional(),
    })
  ),
  posted_count: z.number().int(),
  error_count: z.number().int(),
  created_doc_ids: z.array(z.string().uuid()),
  group_count: z.number().int(),
});

export type SalesImportResponse = z.infer<typeof salesImportResponseSchema>;
export type StocktakeImportResponse = z.infer<typeof stocktakeImportResponseSchema>;
