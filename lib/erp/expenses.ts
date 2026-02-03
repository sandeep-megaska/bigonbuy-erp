import { z } from "zod";

export const expenseCategorySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  group_key: z.string(),
  is_active: z.boolean(),
});

export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const expenseFormSchema = z.object({
  expense_date: z.string().min(1),
  amount: z.coerce.number().min(0),
  currency: z.string().min(1),
  category_id: z.string().uuid(),
  channel_id: z.string().uuid().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  vendor_id: z.string().uuid().nullable(),
  payee_name: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  is_recurring: z.boolean(),
  recurring_rule: z.string().nullable(),
  attachment_url: z.string().nullable(),
  applies_to_type: z.enum(["period", "grn", "stock_transfer", "order"]).nullable(),
  applies_to_id: z.string().uuid().nullable(),
  is_capitalizable: z.boolean(),
  allocation_method: z.enum(["by_qty", "by_value", "fixed", "none"]).nullable(),
  allocation_fixed_total: z.preprocess(
    (value) => (value === null || value === undefined || value === "" ? null : Number(value)),
    z.number().nullable()
  ),
});

export type ExpenseFormPayload = z.infer<typeof expenseFormSchema>;

export const expenseListRowSchema = z
  .object({
    id: z.string().uuid(),
    expense_date: z.string(),
    amount: z.coerce.number(),
    currency: z.string(),
    category_id: z.string().uuid().optional(),
    category_name: z.string().nullable().optional(),
    category_group: z.string().nullable().optional(),
    channel_id: z.string().uuid().nullable().optional(),
    channel_name: z.string().nullable().optional(),
    warehouse_id: z.string().uuid().nullable().optional(),
    warehouse_name: z.string().nullable().optional(),
    vendor_id: z.string().uuid().nullable().optional(),
    vendor_name: z.string().nullable().optional(),
    payee_name: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    is_recurring: z.boolean().optional(),
    recurring_rule: z.string().nullable().optional(),
    attachment_url: z.string().nullable().optional(),
    is_capitalizable: z.boolean().optional(),
    applies_to_type: z.string().nullable().optional(),
    applies_to_id: z.string().uuid().nullable().optional(),
    applied_to_inventory_at: z.string().nullable().optional(),
    finance_posted: z.boolean().optional(),
    finance_journal_id: z.string().uuid().nullable().optional(),
    finance_journal_no: z.string().nullable().optional(),
    finance_post_link: z.string().nullable().optional(),
    posting_state: z.enum(["posted", "missing", "excluded"]).nullable().optional(),
    journal_id: z.string().uuid().nullable().optional(),
    journal_no: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const expenseListResponseSchema = z.array(expenseListRowSchema);
export type ExpenseListRow = z.infer<typeof expenseListRowSchema>;

export const expensePostingSummarySchema = z.object({
  total_count: z.coerce.number(),
  posted_count: z.coerce.number(),
  missing_count: z.coerce.number(),
  total_amount: z.coerce.number(),
  posted_amount: z.coerce.number(),
  missing_amount: z.coerce.number(),
});

export type ExpensePostingSummary = z.infer<typeof expensePostingSummarySchema>;

export const expenseImportRowSchema = z.object({
  expense_date: z.string(),
  amount: z.string(),
  currency: z.string().optional(),
  category_code: z.string(),
  channel_code: z.string().optional(),
  warehouse_code: z.string().optional(),
  vendor_name: z.string().optional(),
  payee_name: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
  attachment_url: z.string().optional(),
});

export type ExpenseImportRow = z.infer<typeof expenseImportRowSchema>;

export const expenseImportResponseSchema = z.object({
  ok: z.boolean(),
  inserted: z.coerce.number(),
  rows: z.array(
    z.object({
      row_index: z.coerce.number(),
      ok: z.boolean(),
      errors: z.array(z.string()),
      expense_id: z.string().uuid().nullable().optional(),
    })
  ),
});

export type ExpenseImportResponse = z.infer<typeof expenseImportResponseSchema>;

export const monthlyCategorySummarySchema = z.array(
  z.object({
    month: z.string(),
    category_group: z.string(),
    category_name: z.string(),
    amount: z.coerce.number(),
  })
);

export const monthlyChannelSummarySchema = z.array(
  z.object({
    month: z.string(),
    channel_name: z.string(),
    amount: z.coerce.number(),
  })
);

export const monthlyWarehouseSummarySchema = z.array(
  z.object({
    month: z.string(),
    warehouse_name: z.string(),
    amount: z.coerce.number(),
  })
);

export const parseAmountInput = (value: string) => {
  if (!value) return 0;
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};
