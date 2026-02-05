import { z } from "zod";

export const amazonSettlementStage1SummarySchema = z.object({
  total_count: z.coerce.number(),
  posted_count: z.coerce.number(),
  missing_count: z.coerce.number(),
  excluded_count: z.coerce.number(),
  total_amount: z.coerce.number(),
  posted_amount: z.coerce.number(),
  missing_amount: z.coerce.number(),
  excluded_amount: z.coerce.number(),
});

export const amazonSettlementStage1RowSchema = z.object({
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
});

export const amazonSettlementStage1ListSchema = z.array(amazonSettlementStage1RowSchema);

export const amazonSettlementStage1PreviewLineSchema = z.object({
  role: z.string(),
  account_id: z.string().uuid().nullable().optional(),
  account_name: z.string().nullable().optional(),
  debit: z.coerce.number(),
  credit: z.coerce.number(),
  warnings: z.array(z.string()).optional(),
});

export const amazonSettlementStage1PreviewSchema = z.array(amazonSettlementStage1PreviewLineSchema);
