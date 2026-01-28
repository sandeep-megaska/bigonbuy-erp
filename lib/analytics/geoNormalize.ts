export type CanonGeoRow = {
  state: string | null;
  city: string | null;
  geo_key: string | null;
  orders: number | null;
  customers: number | null;
  units: number | null;
  gross: number | null;
  gross_share_within_state: number | null;
  rank_within_state: number | null;
  rank_overall: number | null;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toGeoKey = (row: Record<string, unknown>) => {
  const state = typeof row.state === "string" ? row.state : null;
  const city = typeof row.city === "string" ? row.city : null;
  const geoKey = typeof row.geo_key === "string" ? row.geo_key : null;
  const fallbackKey = [state, city].filter(Boolean).join(" / ");
  return geoKey ?? (fallbackKey || null);
};

export function normalizeGeoRows(channelKey: string, rows: unknown): CanonGeoRow[] {
  const safeRows = Array.isArray(rows) ? rows : rows ? [rows] : [];

  if (channelKey === "shopify") {
    return safeRows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        ...record,
        geo_key: toGeoKey(record),
        state: record.state !== undefined && record.state !== null ? String(record.state) : null,
        city: record.city !== undefined && record.city !== null ? String(record.city) : null,
        orders: toNumber(record.orders ?? record.orders_count),
        customers: toNumber(record.customers ?? record.customers_count),
        units: toNumber(record.units ?? record.units_sold ?? record.qty),
        gross: toNumber(record.gross ?? record.gross_sales ?? record.sales),
        gross_share_within_state: toNullableNumber(record.gross_share_within_state),
        rank_within_state: toNullableNumber(record.rank_within_state),
        rank_overall: toNullableNumber(record.rank_overall ?? record.rank),
      };
    });
  }

  return safeRows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      ...record,
      geo_key: toGeoKey(record),
      state: record.state !== undefined && record.state !== null ? String(record.state) : null,
      city: record.city !== undefined && record.city !== null ? String(record.city) : null,
      orders: toNullableNumber(record.orders),
      customers: toNullableNumber(record.customers),
      units: toNullableNumber(record.units),
      gross: toNullableNumber(record.gross),
      gross_share_within_state: toNullableNumber(record.gross_share_within_state),
      rank_within_state: toNullableNumber(record.rank_within_state),
      rank_overall: toNullableNumber(record.rank_overall ?? record.rank),
    };
  });
}
