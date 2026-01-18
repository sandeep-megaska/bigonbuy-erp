import { z } from "zod";

export type ImportMode = "adjustment" | "stocktake" | "fba";

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

const integerString = (label: string, options: { allowNegative: boolean }) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => (options.allowNegative ? /^-?\d+$/.test(value) : /^\d+$/.test(value)), {
      message: `${label} must be an integer`,
    })
    .transform((value) => Number.parseInt(value, 10));

export const adjustmentRowSchema = z.object({
  warehouse_code: trimmedRequiredString("warehouse_code"),
  sku: trimmedRequiredString("sku"),
  qty_delta: integerString("qty_delta", { allowNegative: true }),
  reason: optionalTrimmedString,
  reference: optionalTrimmedString,
});

export const stocktakeRowSchema = z.object({
  warehouse_code: trimmedRequiredString("warehouse_code"),
  sku: trimmedRequiredString("sku"),
  counted_qty: integerString("counted_qty", { allowNegative: false }),
  reason: optionalTrimmedString,
  reference: optionalTrimmedString,
});

export const fbaRowSchema = z.object({
  sku: trimmedRequiredString("sku"),
  amazon_fulfillable_qty: integerString("amazon_fulfillable_qty", { allowNegative: false }),
  reason: optionalTrimmedString,
  reference: optionalTrimmedString,
});

export type AdjustmentCsvRow = z.infer<typeof adjustmentRowSchema>;
export type StocktakeCsvRow = z.infer<typeof stocktakeRowSchema>;
export type FbaCsvRow = z.infer<typeof fbaRowSchema>;

export const importResponseSchema = z.object({
  results: z.array(
    z.object({
      row_index: z.number().int(),
      ok: z.boolean(),
      message: z.string().nullable().optional(),
      warehouse_id: z.string().uuid().nullable().optional(),
      variant_id: z.string().uuid().nullable().optional(),
      delta: z.number().int().nullable().optional(),
      posted: z.boolean().nullable().optional(),
      current_qty: z.number().int().nullable().optional(),
      counted_qty: z.number().int().nullable().optional(),
    })
  ),
  posted_count: z.number().int(),
  error_count: z.number().int(),
});

export type ImportResponse = z.infer<typeof importResponseSchema>;
