import { supabase } from "../supabaseClient";

export type ShopifyOrderRow = {
  id: string;
  shopify_order_id: number;
  shopify_order_number: string | null;
  order_created_at: string;
  processed_at: string | null;
  currency: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  is_cancelled: boolean | null;
  subtotal_price: number | null;
  total_discounts: number | null;
  total_shipping: number | null;
  total_tax: number | null;
  total_price: number | null;
  customer_email: string | null;
  shipping_state_code: string | null;
  shipping_pincode: string | null;
  raw_order?: Record<string, unknown> | null;
};

export type ShopifyOrderLine = {
  id: string;
  sku: string | null;
  title: string | null;
  quantity: number | null;
  price: number | null;
  line_discount: number | null;
  taxable: boolean | null;
  raw_line?: Record<string, unknown> | null;
};

export type ShopifyOrdersQuery = {
  companyId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus?: string | null;
  search?: string | null;
  offset?: number;
  limit?: number;
};

export async function fetchShopifyOrders({
  companyId,
  dateFrom,
  dateTo,
  financialStatus,
  fulfillmentStatus,
  search,
  offset = 0,
  limit = 25,
}: ShopifyOrdersQuery) {
  let query = supabase
    .from("erp_shopify_orders")
    .select(
      "id, shopify_order_id, shopify_order_number, order_created_at, processed_at, currency, financial_status, fulfillment_status, cancelled_at, is_cancelled, subtotal_price, total_discounts, total_shipping, total_tax, total_price, customer_email, shipping_state_code, shipping_pincode, raw_order",
    )
    .eq("company_id", companyId)
    .order("order_created_at", { ascending: false });

  if (dateFrom) {
    query = query.gte("order_created_at", dateFrom);
  }
  if (dateTo) {
    query = query.lte("order_created_at", dateTo);
  }
  if (financialStatus) {
    query = query.eq("financial_status", financialStatus);
  }
  if (fulfillmentStatus) {
    query = query.eq("fulfillment_status", fulfillmentStatus);
  }
  if (search?.trim()) {
    const escaped = search.trim();
    const conditions = [
      `shopify_order_number.ilike.%${escaped}%`,
      `customer_email.ilike.%${escaped}%`,
      `raw_order->>phone.ilike.%${escaped}%`,
      `raw_order->>name.ilike.%${escaped}%`,
    ];
    if (!Number.isNaN(Number(escaped))) {
      conditions.push(`shopify_order_id.eq.${Number(escaped)}`);
    }
    query = query.or(conditions.join(","));
  }

  const { data, error } = await query.range(offset, offset + limit);
  const rows = (data || []) as ShopifyOrderRow[];

  return {
    rows: rows.slice(0, limit),
    hasNextPage: rows.length > limit,
    error,
  };
}

export async function fetchShopifyOrderDetail(companyId: string, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("erp_shopify_orders")
    .select(
      "id, shopify_order_id, shopify_order_number, order_created_at, processed_at, currency, financial_status, fulfillment_status, cancelled_at, is_cancelled, subtotal_price, total_discounts, total_shipping, total_tax, total_price, customer_email, shipping_state_code, shipping_pincode, raw_order",
    )
    .eq("company_id", companyId)
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    return { order: null, lines: [], error: orderError };
  }

  const { data: lineData, error: lineError } = await supabase
    .from("erp_shopify_order_lines")
    .select("id, sku, title, quantity, price, line_discount, taxable, raw_line")
    .eq("company_id", companyId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (lineError) {
    return { order: (order || null) as ShopifyOrderRow | null, lines: [], error: lineError };
  }

  return {
    order: (order || null) as ShopifyOrderRow | null,
    lines: (lineData || []) as ShopifyOrderLine[],
    error: null,
  };
}
