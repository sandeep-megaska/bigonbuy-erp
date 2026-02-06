export type PayoutSource = "amazon" | "razorpay" | "delhivery_cod" | "flipkart" | "myntra" | "snapdeal";

export type MarketplaceCreditSource = "delhivery_cod" | "flipkart" | "myntra" | "snapdeal";

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

export const detectMarketplaceCreditSource = (description: string | null): MarketplaceCreditSource | null => {
  const text = (description || "").toUpperCase();
  if (text.includes("DELHIVERY")) return "delhivery_cod";
  if (text.includes("FLIPKART")) return "flipkart";
  if (text.includes("MYNTRA")) return "myntra";
  if (text.includes("SNAPDEAL")) return "snapdeal";
  return null;
};

const extractFirstMatch = (value: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

export const extractMarketplaceCreditRef = (source: MarketplaceCreditSource, description: string | null): string | null => {
  const text = (description || "").toUpperCase();
  if (!text) return null;

  if (source === "myntra") {
    return extractFirstMatch(text, [/\b(DIB[0-9A-Z\/-]{4,})\b/, /\b(DI[0-9A-Z\/-]{5,})\b/]);
  }

  if (source === "flipkart") {
    return extractFirstMatch(text, [/\b((?:DID|DIE)[-_/]?[0-9A-Z\/-]{4,})\b/, /\b(DI[34][0-9A-Z\/-]{4,})\b/]);
  }

  if (source === "delhivery_cod") {
    return extractFirstMatch(text, [/\b([0-9]{8,})\b/]);
  }

  return extractFirstMatch(text, [/\b([A-Z0-9][A-Z0-9\/-]{5,})\b/]);
};
