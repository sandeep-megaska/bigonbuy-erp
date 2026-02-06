export type PayoutSource = "amazon" | "razorpay" | "delhivery_cod" | "flipkart" | "myntra" | "snapdeal";

export type PayoutEvent = {
  source: PayoutSource;
  event_id: string;
  event_ref: string;
  payout_date: string;
  amount: number;
  currency?: string;
  status?: string;
  linked_bank_txn_id?: string;
};

export const PAYOUT_SOURCE_LABELS: Record<PayoutSource, string> = {
  amazon: "Amazon",
  razorpay: "Razorpay",
  delhivery_cod: "Delhivery COD",
  flipkart: "Flipkart",
  myntra: "Myntra",
  snapdeal: "Snapdeal",
};

export const PAYOUT_ENTITY_TYPES: Record<PayoutSource, string> = {
  amazon: "amazon_settlement_batch",
  razorpay: "razorpay_settlement",
  delhivery_cod: "delhivery_cod_remittance",
  flipkart: "flipkart_payout",
  myntra: "myntra_payout",
  snapdeal: "snapdeal_payout",
};

export const isPayoutSource = (value: string): value is PayoutSource =>
  ["amazon", "razorpay", "delhivery_cod", "flipkart", "myntra", "snapdeal"].includes(value);
