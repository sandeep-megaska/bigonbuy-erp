type ParsedSettlementRow = Record<string, string>;

export type AmazonSettlementReportParsed = {
  rawHeader: string[];
  columns: string[];
  rows: ParsedSettlementRow[];
  totalsByCurrency: Record<string, number>;
  rowCount: number;
  sampleCount: number;
};

const HEADER_CANDIDATES = [
  "settlement-id",
  "settlement-start-date",
  "settlement-end-date",
  "posted-date",
  "amount",
  "total-amount",
  "amount-type",
  "transaction-type",
  "order-id",
  "currency",
  "amount-currency",
];

const AMOUNT_HEADERS = ["amount", "total-amount"];
const CURRENCY_HEADERS = ["currency", "amount-currency", "currency-code"];

export function normalizeAmazonSettlementHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseAmazonSettlementAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function findHeaderIndex(headers: string[], candidates: string[]): number | null {
  const normalized = headers.map(normalizeAmazonSettlementHeader);
  for (const candidate of candidates) {
    const matchIndex = normalized.indexOf(normalizeAmazonSettlementHeader(candidate));
    if (matchIndex >= 0) return matchIndex;
  }
  return null;
}

function detectHeaderRow(rows: string[][]): number {
  let fallbackIndex = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const trimmed = row.map((cell) => cell.trim());
    const nonEmpty = trimmed.filter((cell) => cell.length > 0);
    if (nonEmpty.length <= 1) continue;
    if (fallbackIndex === -1) fallbackIndex = index;

    const normalized = trimmed.map(normalizeAmazonSettlementHeader);
    const matchCount = HEADER_CANDIDATES.reduce((count, candidate) => {
      return normalized.includes(normalizeAmazonSettlementHeader(candidate)) ? count + 1 : count;
    }, 0);

    if (matchCount >= 2 || (matchCount >= 1 && nonEmpty.length >= 10)) {
      return index;
    }
  }

  return fallbackIndex === -1 ? 0 : fallbackIndex;
}

function buildRecords(columns: string[], rows: string[][]): ParsedSettlementRow[] {
  return rows.map((row) => {
    const record: ParsedSettlementRow = {};
    columns.forEach((column, index) => {
      record[column] = row[index]?.trim() ?? "";
    });
    return record;
  });
}

export function parseAmazonSettlementReportText(
  text: string,
  options?: { maxRows?: number }
): AmazonSettlementReportParsed {
  const lines = text.replace(/\uFEFF/g, "").split(/\r?\n/);
  const rawHeader = lines.slice(0, 20);
  const rows = lines
    .map((line) => line.split("\t"))
    .filter((row) => row.some((cell) => cell.trim().length > 0));

  if (rows.length === 0) {
    return {
      rawHeader,
      columns: [],
      rows: [],
      totalsByCurrency: {},
      rowCount: 0,
      sampleCount: 0,
    };
  }

  const headerIndex = detectHeaderRow(rows);
  const columns = rows[headerIndex].map((cell) => cell.trim());
  const dataRows = rows.slice(headerIndex + 1);

  const amountIndex = findHeaderIndex(columns, AMOUNT_HEADERS);
  const currencyIndex = findHeaderIndex(columns, CURRENCY_HEADERS);

  const totalsByCurrency: Record<string, number> = {};
  if (amountIndex !== null) {
    dataRows.forEach((row) => {
      const amountRaw = row[amountIndex] ?? "";
      const amount = parseAmazonSettlementAmount(amountRaw);
      if (amount === null) return;
      const currency = currencyIndex !== null ? (row[currencyIndex]?.trim() || "UNKNOWN") : "UNKNOWN";
      totalsByCurrency[currency] = (totalsByCurrency[currency] ?? 0) + amount;
    });
  }

  const maxRows = options?.maxRows ?? dataRows.length;
  const previewRows = buildRecords(columns, dataRows.slice(0, maxRows));

  return {
    rawHeader,
    columns,
    rows: previewRows,
    totalsByCurrency,
    rowCount: dataRows.length,
    sampleCount: previewRows.length,
  };
}
