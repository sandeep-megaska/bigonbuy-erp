const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

export type RazorpaySettlement = {
  id: string;
  utr?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  settled_at?: number | null;
  [key: string]: unknown;
};

export type RazorpayReconItem = {
  settlement_id?: string | null;
  fee?: number | string | null;
  fees?: number | string | null;
  tax?: number | string | null;
  tax_amount?: number | string | null;
  [key: string]: unknown;
};

type RazorpayListResponse = {
  entity?: string;
  count?: number;
  items?: RazorpaySettlement[];
};

type RazorpayReconResponse = {
  items?: RazorpayReconItem[];
};

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const buildAuthHeader = (keyId: string, keySecret: string): string => {
  const token = Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
};

async function razorpayFetch(
  path: string,
  keyId: string,
  keySecret: string,
  init?: RequestInit
): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", buildAuthHeader(keyId, keySecret));
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const json = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Razorpay API error: ${response.status} ${JSON.stringify(json)}`);
  }

  return json;
}

export async function listRazorpaySettlements(
  keyId: string,
  keySecret: string,
  params: { from?: number; to?: number; count?: number } = {}
): Promise<RazorpaySettlement[]> {
  const settlements: RazorpaySettlement[] = [];
  const count = params.count ?? 100;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const query = new URLSearchParams();
    query.set("count", String(count));
    query.set("skip", String(skip));
    if (params.from) query.set("from", String(params.from));
    if (params.to) query.set("to", String(params.to));

    const payload = (await razorpayFetch(`/settlements?${query.toString()}`, keyId, keySecret, {
      method: "GET",
    })) as RazorpayListResponse;

    const items = Array.isArray(payload.items) ? payload.items : [];
    settlements.push(...items);

    if (items.length < count) {
      hasMore = false;
    } else {
      skip += count;
    }
  }

  return settlements;
}

export async function fetchRazorpayReconCombined(
  keyId: string,
  keySecret: string,
  year: number,
  month: number
): Promise<RazorpayReconItem[]> {
  const query = new URLSearchParams({ year: String(year), month: String(month).padStart(2, "0") });
  const payload = (await razorpayFetch(
    `/settlements/recon/combined?${query.toString()}`,
    keyId,
    keySecret,
    { method: "GET" }
  )) as RazorpayReconResponse;

  return Array.isArray(payload.items) ? payload.items : [];
}

export function summarizeRecon(items: RazorpayReconItem[]): Record<string, { fee_total: number; tax_total: number }> {
  return items.reduce<Record<string, { fee_total: number; tax_total: number }>>((acc, item) => {
    const settlementId = item.settlement_id;
    if (!settlementId) return acc;
    const current = acc[settlementId] ?? { fee_total: 0, tax_total: 0 };
    const fee = toNumber(item.fee ?? item.fees);
    const tax = toNumber(item.tax ?? item.tax_amount);
    acc[settlementId] = {
      fee_total: current.fee_total + fee,
      tax_total: current.tax_total + tax,
    };
    return acc;
  }, {});
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function getMonthBuckets(start: Date, end: Date): Array<{ year: number; month: number }> {
  const buckets: Array<{ year: number; month: number }> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endCursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

  while (cursor <= endCursor) {
    buckets.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return buckets;
}
