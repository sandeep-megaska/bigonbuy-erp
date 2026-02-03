import { z } from "zod";

export const shopifySalesPostingSummarySchema = z.object({
  total_count: z.coerce.number(),
  posted_count: z.coerce.number(),
  missing_count: z.coerce.number(),
  excluded_count: z.coerce.number(),
  total_amount: z.coerce.number(),
  posted_amount: z.coerce.number(),
  missing_amount: z.coerce.number(),
  excluded_amount: z.coerce.number(),
});

export type ShopifySalesPostingSummary = z.infer<typeof shopifySalesPostingSummarySchema>;

export const shopifySalesPostingRowSchema = z
  .object({
    order_uuid: z.string().uuid(),
    order_number: z.string().nullable().optional(),
    order_created_at: z.string(),
    ship_state: z.string().nullable().optional(),
    ship_city: z.string().nullable().optional(),
    amount: z.coerce.number(),
    posting_state: z.enum(["posted", "missing", "excluded"]).nullable().optional(),
    journal_id: z.string().uuid().nullable().optional(),
    journal_no: z.string().nullable().optional(),
  })
  .passthrough();

export const shopifySalesPostingListSchema = z.array(shopifySalesPostingRowSchema);
export type ShopifySalesPostingRow = z.infer<typeof shopifySalesPostingRowSchema>;

export const shopifySalesDayPostingPreviewSchema = z.object({
  day: z.string(),
  eligible_orders_count: z.coerce.number(),
  eligible_amount_sum: z.coerce.number(),
  already_posted_count: z.coerce.number(),
  missing_count: z.coerce.number(),
});

export type ShopifySalesDayPostingPreview = z.infer<typeof shopifySalesDayPostingPreviewSchema>;
