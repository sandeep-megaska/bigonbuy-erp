import type { NextApiRequest, NextApiResponse } from "next";
import { financesListFinancialEventsByDateRange } from "../../../../lib/oms/adapters/amazonSpApi";

const MAX_RANGE_DAYS = 60;
const REQUEST_TIMEOUT_MS = 20000;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type NormalizedEntry = {
  postedAt: string | null;
  eventGroupId: string;
  amazonOrderId?: string;
  eventType: string;
  amountType?: string;
  amountDescription?: string;
  amount: number;
  currency: string;
  sourcePath: string;
};

type BreakdownEntry = {
  key: string;
  amount: number;
  count: number;
};

type Totals = {
  grossSales: number;
  refunds: number;
  netSales: number;
  amazonCharges: number;
  netCashflow: number;
};

const revenueKeywords = [
  "principal",
  "itemprice",
  "itemcharge",
  "shippingcharge",
  "giftwrap",
  "promotion",
  "shippingchargeadjustment",
  "giftwrapchargeadjustment",
];

const refundKeywords = ["refund", "return", "chargeback", "reversal", "cancel"];

const chargeKeywords = [
  "fee",
  "commission",
  "fba",
  "shipping",
  "storage",
  "disposal",
  "service",
  "handling",
  "removal",
  "subscription",
  "advertising",
  "taxwithheld",
  "withheld",
  "gst",
  "tds",
];

function toIsoDateStart(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function toIsoDateEnd(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

function parseDateRange(start?: string, end?: string): { start: string; end: string; warnings: string[] } {
  const warnings: string[] = [];
  if (!start || !end || !DATE_REGEX.test(start) || !DATE_REGEX.test(end)) {
    throw new Error("Invalid start or end date. Use YYYY-MM-DD format.");
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid date range.");
  }
  if (startDate > endDate) {
    throw new Error("Start date must be before end date.");
  }
  const diffDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > MAX_RANGE_DAYS) {
    throw new Error("Date range must be 60 days or less.");
  }
  if (diffDays <= 0) {
    warnings.push("Date range appears to be empty.");
  }

  return { start: toIsoDateStart(start), end: toIsoDateEnd(end), warnings };
}

function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fn(controller.signal).finally(() => clearTimeout(timeout));
}

function findMoney(value: unknown): { amount: number; currency: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { CurrencyAmount?: number | string; CurrencyCode?: string };
  if (record.CurrencyAmount === undefined || record.CurrencyCode === undefined) return null;
  const amount = typeof record.CurrencyAmount === "string" ? Number(record.CurrencyAmount) : record.CurrencyAmount;
  if (Number.isNaN(amount) || typeof record.CurrencyCode !== "string") return null;
  return { amount, currency: record.CurrencyCode };
}

function getAmountType(obj: Record<string, unknown>): string | undefined {
  const candidates = [
    "ChargeType",
    "FeeType",
    "TaxType",
    "PromotionType",
    "AdjustmentType",
    "OtherChargeType",
    "OtherFeeType",
    "RefundType",
    "ChargebackType",
    "LoanType",
    "FeeReason",
  ];
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function extractAmountEntries(
  value: unknown,
  sourcePath: string,
  contextPath: string[] = []
): Omit<NormalizedEntry, "postedAt" | "eventGroupId" | "amazonOrderId" | "eventType">[] {
  const entries: Omit<NormalizedEntry, "postedAt" | "eventGroupId" | "amazonOrderId" | "eventType">[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      entries.push(...extractAmountEntries(item, sourcePath, [...contextPath, String(index)]));
    });
    return entries;
  }
  if (!value || typeof value !== "object") return entries;
  const record = value as Record<string, unknown>;

  Object.entries(record).forEach(([key, child]) => {
    const money = findMoney(child);
    if (money) {
      const amountType = getAmountType(record);
      const amountDescription = contextPath.length > 0 ? contextPath[contextPath.length - 1] : key;
      entries.push({
        amount: money.amount,
        currency: money.currency,
        amountType,
        amountDescription,
        sourcePath: `${sourcePath}.${key}`,
      });
    }
  });

  Object.entries(record).forEach(([key, child]) => {
    if (typeof child === "object" && child !== null) {
      entries.push(...extractAmountEntries(child, sourcePath, [...contextPath, key]));
    }
  });

  return entries;
}

function normalizeFinancialEvents(eventGroupId: string | null, payload: Record<string, unknown>): NormalizedEntry[] {
  const entries: NormalizedEntry[] = [];
  Object.entries(payload).forEach(([key, value]) => {
    if (!key.endsWith("EventList") || !Array.isArray(value)) return;
    const eventType = key.replace(/EventList$/, "");
    value.forEach((event) => {
      if (!event || typeof event !== "object") return;
      const record = event as Record<string, unknown>;
      const postedAtValue = typeof record.PostedDate === "string" ? record.PostedDate : null;
      const postedAt = postedAtValue ? new Date(postedAtValue).toISOString() : null;
      const amazonOrderId = typeof record.AmazonOrderId === "string" ? record.AmazonOrderId : undefined;
      const resolvedEventGroupId =
        eventGroupId ?? (typeof record.FinancialEventGroupId === "string" ? record.FinancialEventGroupId : "unknown");
      const extracted = extractAmountEntries(record, key);
      extracted.forEach((entry) => {
        entries.push({
          postedAt,
          eventGroupId: resolvedEventGroupId,
          amazonOrderId,
          eventType,
          amount: entry.amount,
          currency: entry.currency,
          amountType: entry.amountType,
          amountDescription: entry.amountDescription,
          sourcePath: entry.sourcePath,
        });
      });
    });
  });
  return entries;
}

function classifyEntry(entry: NormalizedEntry): { bucket: "revenue" | "refunds" | "charges"; heuristic: boolean } {
  const label = `${entry.amountType ?? ""} ${entry.amountDescription ?? ""} ${entry.eventType}`.toLowerCase();
  const isRefund = refundKeywords.some((keyword) => label.includes(keyword));
  const isCharge = chargeKeywords.some((keyword) => label.includes(keyword));
  const isRevenue = revenueKeywords.some((keyword) => label.includes(keyword));

  if (isRefund) return { bucket: "refunds", heuristic: false };
  if (isCharge) return { bucket: "charges", heuristic: false };
  if (isRevenue) return { bucket: "revenue", heuristic: false };

  if (entry.amount < 0) {
    return { bucket: "charges", heuristic: true };
  }
  return { bucket: "revenue", heuristic: true };
}

function updateBreakdown(map: Map<string, BreakdownEntry>, key: string, amount: number): void {
  const existing = map.get(key);
  if (existing) {
    existing.amount += amount;
    existing.count += 1;
  } else {
    map.set(key, { key, amount, count: 1 });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { start, end, warnings: rangeWarnings } = parseDateRange(
      typeof req.query.start === "string" ? req.query.start : undefined,
      typeof req.query.end === "string" ? req.query.end : undefined
    );

    const warnings: string[] = [...rangeWarnings];

    const { financialEvents, debug } = await withTimeout((signal) =>
      financesListFinancialEventsByDateRange({
        postedAfter: start,
        postedBefore: end,
        signal,
      })
    );

    warnings.push(...debug.warnings);

    const normalizedEntries: NormalizedEntry[] = normalizeFinancialEvents(null, financialEvents);
    const eventGroupIdSet = new Set(
      normalizedEntries.map((entry) => entry.eventGroupId).filter((id) => Boolean(id))
    );

    const totalsByCurrency: Record<string, Totals> = {};
    const revenueBreakdown = new Map<string, BreakdownEntry>();
    const refundBreakdown = new Map<string, BreakdownEntry>();
    const chargesBreakdown = new Map<string, BreakdownEntry>();
    let heuristicUsed = false;

    normalizedEntries.forEach((entry) => {
      const bucketInfo = classifyEntry(entry);
      if (bucketInfo.heuristic) heuristicUsed = true;
      if (!totalsByCurrency[entry.currency]) {
        totalsByCurrency[entry.currency] = {
          grossSales: 0,
          refunds: 0,
          netSales: 0,
          amazonCharges: 0,
          netCashflow: 0,
        };
      }
      const totals = totalsByCurrency[entry.currency];
      totals.netCashflow += entry.amount;

      const breakdownKey = `${entry.amountType ?? "Unknown"} • ${entry.amountDescription ?? "Uncategorized"}`;

      if (bucketInfo.bucket === "revenue") {
        totals.grossSales += entry.amount;
        updateBreakdown(revenueBreakdown, breakdownKey, entry.amount);
      } else if (bucketInfo.bucket === "refunds") {
        totals.refunds += entry.amount;
        updateBreakdown(refundBreakdown, breakdownKey, entry.amount);
      } else {
        totals.amazonCharges += entry.amount;
        updateBreakdown(chargesBreakdown, breakdownKey, entry.amount);
      }
    });

    Object.values(totalsByCurrency).forEach((totals) => {
      totals.netSales = totals.grossSales + totals.refunds;
    });

    const currencies = Object.keys(totalsByCurrency);
    if (currencies.length > 1) {
      warnings.push(`Multiple currencies detected: ${currencies.join(", ")}`);
    }
    if (heuristicUsed) {
      warnings.push("Revenue/charge/refund mapping uses heuristics for unmapped entries.");
    }

    res.status(200).json({
      range: { start, end },
      totalsByCurrency,
      breakdown: {
        revenue: Array.from(revenueBreakdown.values()).sort((a, b) => b.amount - a.amount),
        refunds: Array.from(refundBreakdown.values()).sort((a, b) => b.amount - a.amount),
        charges: Array.from(chargesBreakdown.values()).sort((a, b) => b.amount - a.amount),
      },
      debug: {
        eventGroupsCount: eventGroupIdSet.size,
        eventsCount: normalizedEntries.length,
        warnings,
      },
    });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
}
