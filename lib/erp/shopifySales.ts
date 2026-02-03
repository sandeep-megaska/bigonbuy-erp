import { z } from "zod";

export const shopifySalesPostingSummarySchema = z.object({
  total_count: z.coerce.number(),
  posted_count: z.coerce.number(),
  missing_count: z.coerce.number(),
  total_amount: z.coerce.number(),
  posted_amount: z.coerce.number(),
  missing_amount: z.coerce.number(),
});

export type ShopifySalesPostingSummary = z.infer<typeof shopifySalesPostingSummarySchema>;

export const shopifySalesPostingRowSchema = z
  .object({
    order_id: z.string().uuid(),
    shopify_order_id: z.coerce.number(),
    order_no: z.string().nullable().optional(),
    order_date: z.string(),
    customer_name: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
    financial_status: z.string().nullable().optional(),
    net_amount: z.coerce.number(),
    tax_amount: z.coerce.number(),
    gross_amount: z.coerce.number(),
    posting_state: z.enum(["posted", "missing", "excluded"]).nullable().optional(),
    journal_id: z.string().uuid().nullable().optional(),
    journal_no: z.string().nullable().optional(),
  })
  .passthrough();

export const shopifySalesPostingListSchema = z.array(shopifySalesPostingRowSchema);
export type ShopifySalesPostingRow = z.infer<typeof shopifySalesPostingRowSchema>;
