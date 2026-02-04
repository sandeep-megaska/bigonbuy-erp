export type AmazonSettlementRow = {
  txn_date: string | null;
  order_id: string | null;
  sub_order_id: string | null;
  sku: string | null;
  qty: number | null;
  gross_sales: number | null;
  net_payout: number | null;
  total_fees: number | null;
  shipping_fee: number | null;
  commission_fee: number | null;
  fixed_fee: number | null;
  closing_fee: number | null;
  refund_amount: number | null;
  other_charges: number | null;
  settlement_type: string | null;
  raw: Record<string, string>;
};

export type AmazonSettlementParseResult = {
  batchRef: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
  rows: AmazonSettlementRow[];
};

const knownCurrencies = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const parseNumeric = (value: string | null): number | null => {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  return parsed;
};

const parseDateValue = (value: string | null): string | null => {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (match) {
    const day = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    let year = Number.parseInt(match[3], 10);
    if (year < 100) year += 2000;
    const iso = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(iso.getTime())) {
      return iso.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const stripTags = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

const extractMeta = (text: string) => {
  const settlementMatch = text.match(/Settlement\s*ID\s*[:#-]?\s*([A-Za-z0-9-]+)/i);
  const periodMatch = text.match(
    /Settlement\s*Period\s*[:#-]?\s*([0-9\/\-.]+)\s*(?:to|-|–)\s*([0-9\/\-.]+)/i
  );
  const startMatch = text.match(/Start\s*Date\s*[:#-]?\s*([0-9\/\-.]+)/i);
  const endMatch = text.match(/End\s*Date\s*[:#-]?\s*([0-9\/\-.]+)/i);

  const currencyMatch = knownCurrencies.find((code) => new RegExp(`\\b${code}\\b`, "i").test(text));

  return {
    batchRef: settlementMatch?.[1] ?? null,
    periodStart: parseDateValue(periodMatch?.[1] ?? startMatch?.[1] ?? null),
    periodEnd: parseDateValue(periodMatch?.[2] ?? endMatch?.[1] ?? null),
    currency: currencyMatch ?? null,
  };
};

const inferField = (header: string): keyof AmazonSettlementRow | null => {
  const key = normalizeHeader(header);
  if (!key) return null;
  if (key.includes("orderid") || (key.includes("order") && key.endsWith("id"))) return "order_id";
  if (key.includes("suborder")) return "sub_order_id";
  if (key === "sku" || key.includes("sku") || key.includes("asin")) return "sku";
  if (key.includes("qty") || key.includes("quantity")) return "qty";
  if (key.includes("transactiondate") || key === "date") return "txn_date";
  if (key.includes("gross") || key.includes("principal") || key.includes("itemprice") || key.includes("productsales")) {
    return "gross_sales";
  }
  if ((key.includes("net") && key.includes("payout")) || (key.includes("net") && key.includes("amount"))) {
    return "net_payout";
  }
  if (key.includes("totalfee") || (key.includes("fee") && !key.includes("shipping") && !key.includes("commission"))) {
    return "total_fees";
  }
  if (key.includes("shipping")) return "shipping_fee";
  if (key.includes("commission")) return "commission_fee";
  if (key.includes("fixed")) return "fixed_fee";
  if (key.includes("closing")) return "closing_fee";
  if (key.includes("refund")) return "refund_amount";
  if (key.includes("other") || key.includes("adjustment") || key.includes("charge")) return "other_charges";
  if (key.includes("type")) return "settlement_type";
  return null;
};

const expectedFields: Array<keyof AmazonSettlementRow> = [
  "txn_date",
  "order_id",
  "sub_order_id",
  "sku",
  "qty",
  "gross_sales",
  "net_payout",
  "total_fees",
  "refund_amount",
  "other_charges",
  "settlement_type",
];

const scoreHeaders = (headers: string[]) => {
  const normalized = headers.map(normalizeHeader);
  let score = 0;
  const keywords = ["order", "sku", "qty", "amount", "fee", "payout", "transaction", "date"];
  for (const key of normalized) {
    if (keywords.some((word) => key.includes(word))) score += 1;
  }
  return score;
};

const extractRowsFromTable = (tableHtml: string): AmazonSettlementRow[] => {
  const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  if (rowMatches.length === 0) return [];

  const parseCells = (rowHtml: string) =>
    (rowHtml.match(/<(td|th)[\s\S]*?<\/(td|th)>/gi) || []).map((cell) => stripTags(cell));

  let headerRowIndex = 0;
  let headers: string[] = [];
  let headerFields: Array<keyof AmazonSettlementRow | null> = [];
  let bestScore = 0;

  rowMatches.forEach((rowHtml, index) => {
    const cells = parseCells(rowHtml).filter(Boolean);
    if (cells.length === 0) return;
    const fields = cells.map(inferField);
    const uniqueFields = new Set(fields.filter(Boolean));
    const score = uniqueFields.size;
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = index;
      headers = cells;
      headerFields = fields;
    }
  });

  if (headers.length === 0) return [];

  return rowMatches.slice(headerRowIndex + 1).flatMap((rowHtml) => {
    const cells = parseCells(rowHtml);
    if (cells.length === 0) return [];
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => {
      raw[header] = cells[index] ?? "";
    });

    if (!Object.values(raw).some((value) => value.trim() !== "")) return [];

    const getValue = (field: keyof AmazonSettlementRow) => {
      const index = headerFields.findIndex((entry) => entry === field);
      if (index === -1) return null;
      return raw[headers[index]] ?? null;
    };

    const txnDate = parseDateValue(getValue("txn_date"));

    return [
      {
        txn_date: txnDate,
        order_id: getValue("order_id"),
        sub_order_id: getValue("sub_order_id"),
        sku: getValue("sku"),
        qty: parseNumeric(getValue("qty")),
        gross_sales: parseNumeric(getValue("gross_sales")),
        net_payout: parseNumeric(getValue("net_payout")),
        total_fees: parseNumeric(getValue("total_fees")),
        shipping_fee: parseNumeric(getValue("shipping_fee")),
        commission_fee: parseNumeric(getValue("commission_fee")),
        fixed_fee: parseNumeric(getValue("fixed_fee")),
        closing_fee: parseNumeric(getValue("closing_fee")),
        refund_amount: parseNumeric(getValue("refund_amount")),
        other_charges: parseNumeric(getValue("other_charges")),
        settlement_type: getValue("settlement_type"),
        raw,
      },
    ];
  });
};

export const parseAmazonSettlementHtml = (html: string): AmazonSettlementParseResult => {
  const text = stripTags(html);
  const meta = extractMeta(text);

  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  if (tables.length === 0) {
    return { ...meta, rows: [] };
  }

  const tableScores = tables.map((table) => {
    const rowMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const parseCells = (rowHtml: string) =>
      (rowHtml.match(/<(td|th)[\s\S]*?<\/(td|th)>/gi) || []).map((cell) => stripTags(cell));
    let bestHeaderCells: string[] = [];
    let bestFieldScore = 0;
    let bestKeywordScore = 0;

    rowMatches.forEach((rowHtml) => {
      const cells = parseCells(rowHtml).filter(Boolean);
      if (cells.length === 0) return;
      const fields = cells.map(inferField).filter(Boolean) as Array<keyof AmazonSettlementRow>;
      const uniqueFields = new Set(fields);
      const fieldScore = Array.from(uniqueFields).filter((field) => expectedFields.includes(field)).length;
      const keywordScore = scoreHeaders(cells);
      if (fieldScore > bestFieldScore || (fieldScore === bestFieldScore && keywordScore > bestKeywordScore)) {
        bestHeaderCells = cells;
        bestFieldScore = fieldScore;
        bestKeywordScore = keywordScore;
      }
    });

    return { table, fieldScore: bestFieldScore, keywordScore: bestKeywordScore, headers: bestHeaderCells };
  });

  tableScores.sort((a, b) => {
    if (b.fieldScore !== a.fieldScore) return b.fieldScore - a.fieldScore;
    return b.keywordScore - a.keywordScore;
  });

  let rows: AmazonSettlementRow[] = [];
  for (const tableScore of tableScores) {
    rows = extractRowsFromTable(tableScore.table);
    if (rows.length > 0 || tableScore.fieldScore > 0) break;
  }

  return {
    batchRef: meta.batchRef,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    currency: meta.currency,
    rows,
  };
};

export const extractAmazonSettlementBody = (payload: unknown): string | null => {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record.body === "string") return record.body;
    if (typeof record.html === "string") return record.html;
    if (typeof record.body_html === "string") return record.body_html;
    if (typeof record.raw_html === "string") return record.raw_html;
  }
  return null;
};

// Sample usage (dev-only):
// const html = extractAmazonSettlementBody({ body: "<table>...</table>" });
// if (html) console.log(parseAmazonSettlementHtml(html));
