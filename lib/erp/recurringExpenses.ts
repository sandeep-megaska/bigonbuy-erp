import { z } from "zod";

export const recurringExpenseTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category_id: z.string().uuid(),
  category_name: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  channel_id: z.string().uuid().nullable(),
  channel_name: z.string().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  warehouse_name: z.string().nullable(),
  vendor_id: z.string().uuid().nullable(),
  vendor_name: z.string().nullable(),
  payee_name: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  day_of_month: z.coerce.number(),
  recurrence: z.string(),
  start_month: z.string(),
  end_month: z.string().nullable(),
  is_active: z.boolean(),
  last_generated_month: z.string().nullable(),
});

export type RecurringExpenseTemplate = z.infer<typeof recurringExpenseTemplateSchema>;

export const recurringExpenseTemplateFormSchema = z.object({
  name: z.string().min(1),
  category_id: z.string().uuid(),
  amount: z.coerce.number().min(0),
  currency: z.string().min(1),
  channel_id: z.string().uuid().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  vendor_id: z.string().uuid().nullable(),
  payee_name: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  day_of_month: z.coerce.number().int().min(1).max(28),
  recurrence: z.literal("monthly"),
  start_month: z.string().min(1),
  end_month: z.string().nullable(),
  is_active: z.boolean(),
});

export type RecurringExpenseTemplateFormPayload = z.infer<typeof recurringExpenseTemplateFormSchema>;

export const recurringExpenseTemplateRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category_id: z.string().uuid(),
  amount: z.coerce.number(),
  currency: z.string(),
  channel_id: z.string().uuid().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  vendor_id: z.string().uuid().nullable(),
  payee_name: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  day_of_month: z.coerce.number(),
  recurrence: z.string(),
  start_month: z.string(),
  end_month: z.string().nullable(),
  is_active: z.boolean(),
});

export type RecurringExpenseTemplateRecord = z.infer<typeof recurringExpenseTemplateRecordSchema>;

const generatorRowSchema = z.object({
  template_id: z.string().uuid(),
  template_name: z.string(),
  expense_date: z.string(),
  amount: z.coerce.number(),
  status: z.enum(["created", "skipped"]),
  reason: z.string().nullable().optional(),
});

export const recurringExpenseGeneratorResponseSchema = z.object({
  ok: z.boolean(),
  month: z.string(),
  would_create: z.coerce.number(),
  created: z.coerce.number(),
  skipped: z.coerce.number(),
  rows: z.array(generatorRowSchema),
});

export type RecurringExpenseGeneratorResponse = z.infer<typeof recurringExpenseGeneratorResponseSchema>;
