import { z } from "zod";

export const amazonSettlementPostingSummarySchema = z.object({
  total_count: z.coerce.number(),
  posted_count: z.coerce.number(),
  missing_count: z.coerce.number(),
  excluded_count: z.coerce.number(),
  total_amount: z.coerce.number(),
  posted_amount: z.coerce.number(),
  missing_amount: z.coerce.number(),
  excluded_amount: z.coerce.number(),
});

export type AmazonSettlementPostingSummary = z.infer<typeof amazonSettlementPostingSummarySchema>;

export const amazonSettlementPostingRowSchema = z.object({
  batch_id: z.string().uuid(),
  batch_ref: z.string().nullable().optional(),
  settlement_start_date: z.string().nullable().optional(),
  settlement_end_date: z.string().nullable().optional(),
  deposit_date: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  net_payout: z.coerce.number().nullable().optional(),
  posting_state: z.enum(["posted", "missing", "excluded"]).nullable().optional(),
  journal_id: z.string().uuid().nullable().optional(),
  journal_no: z.string().nullable().optional(),
  report_id: z.string().nullable().optional(),
  txn_count: z.coerce.number().nullable().optional(),
  normalized_state: z.boolean().nullable().optional(),
  has_txns: z.boolean().nullable().optional(),
});

export const amazonSettlementPostingListSchema = z.array(amazonSettlementPostingRowSchema);
export type AmazonSettlementPostingRow = z.infer<typeof amazonSettlementPostingRowSchema>;

export const amazonSettlementPostingPreviewLineSchema = z.object({
  role_key: z.string(),
  account_id: z.string().uuid().nullable().optional(),
  account_code: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  dr: z.coerce.number(),
  cr: z.coerce.number(),
  label: z.string().nullable().optional(),
});

export const amazonSettlementPostingPreviewSchema = z.object({
  batch_id: z.string().uuid(),
  batch_ref: z.string().nullable().optional(),
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  totals: z
    .object({
      net_payout: z.coerce.number(),
      sales: z.coerce.number(),
      fees: z.coerce.number(),
      refunds: z.coerce.number(),
      tcs: z.coerce.number(),
      tds: z.coerce.number(),
      adjustments: z.coerce.number(),
      total_debit: z.coerce.number(),
      total_credit: z.coerce.number(),
    })
    .nullable()
    .optional(),
  lines: z.array(amazonSettlementPostingPreviewLineSchema),
  warnings: z.array(z.string()).optional(),
  can_post: z.boolean().optional(),
  posted: z
    .object({
      journal_id: z.string().uuid().nullable().optional(),
      journal_no: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type AmazonSettlementPostingPreview = z.infer<typeof amazonSettlementPostingPreviewSchema>;
