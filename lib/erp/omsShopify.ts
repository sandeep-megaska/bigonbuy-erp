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

export type ShopifyOrderGstRow = {
  lineId: string;
  sku: string | null;
  styleCode: string | null;
  hsn: string | null;
  gstRate: number | null;
  gross: number | null;
  taxableValue: number | null;
  gstAmount: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  source: "actual" | "preview";
};

type ShopifyGstSalesRegisterRow = {
  id: string;
  source_line_id: string;
  sku: string | null;
  style_code: string | null;
  hsn: string | null;
  gst_rate: number | null;
  taxable_value: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total_tax: number | null;
  raw_calc: Record<string, unknown> | null;
};

type ShopifyStyleTaxProfile = {
  style_code: string;
  hsn: string;
  gst_rate: number | null;
};

type ShopifyGstSkuMasterRow = {
  style_code: string | null;
  sku: string | null;
  hsn: string;
  gst_rate: number | null;
};

export type ShopifyOrderGstDetail = {
  rows: ShopifyOrderGstRow[];
  status: "actual" | "preview";
  notice: string | null;
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

export async function fetchShopifyOrderGstDetail(
  companyId: string,
  orderId: string,
  lines: ShopifyOrderLine[],
  buyerStateCode: string | null,
): Promise<ShopifyOrderGstDetail> {
  const previewData = await buildShopifyGstPreview(companyId, lines, buyerStateCode);
  const previewRows = previewData.rows;
  let notice = previewData.notice;

  const { data: actualData, error: actualError } = await supabase
    .from("erp_gst_sales_register")
    .select(
      "id, source_line_id, sku, style_code, hsn, gst_rate, taxable_value, cgst, sgst, igst, total_tax, raw_calc",
    )
    .eq("company_id", companyId)
    .eq("source_order_id", orderId)
    .eq("is_void", false)
    .order("created_at", { ascending: true });

  if (actualError) {
    if (isMissingRelationError(actualError)) {
      return {
        rows: previewRows,
        status: "preview",
        notice: "Preview only — GST register table not available.",
      };
    }
    return {
      rows: previewRows,
      status: "preview",
      notice: notice || `Preview only — failed to load GST register (${actualError.message}).`,
    };
  }

  const actualRows = (actualData || []) as ShopifyGstSalesRegisterRow[];
  if (!actualRows.length) {
    return {
      rows: previewRows,
      status: "preview",
      notice: notice || "Preview only — no GST register rows found for this order.",
    };
  }

  const actualRowsByLine = new Map(actualRows.map((row) => [row.source_line_id, row]));
  const previewRowsByLine = new Map(previewRows.map((row) => [row.lineId, row]));
  const mergedRows = lines.map((line) => {
    const actualRow = actualRowsByLine.get(line.id);
    if (actualRow) {
      return mapActualGstRow(actualRow, line);
    }
    const previewRow = previewRowsByLine.get(line.id);
    return (
      previewRow || {
        lineId: line.id,
        sku: line.sku,
        styleCode: getStyleCode(line.sku),
        hsn: null,
        gstRate: null,
        gross: null,
        taxableValue: null,
        gstAmount: null,
        cgst: null,
        sgst: null,
        igst: null,
        source: "preview" as const,
      }
    );
  });

  const missingActualLines = mergedRows.filter((row) => row.source !== "actual").length;
  if (missingActualLines > 0) {
    notice = notice || "Some lines are missing GST register rows; preview used where needed.";
  }

  return {
    rows: mergedRows,
    status: "actual",
    notice,
  };
}

function mapActualGstRow(row: ShopifyGstSalesRegisterRow, line: ShopifyOrderLine): ShopifyOrderGstRow {
  const cgst = toNumber(row.cgst);
  const sgst = toNumber(row.sgst);
  const igst = toNumber(row.igst);
  const gstAmount = sumNumbers(cgst, sgst, igst);
  const taxableValue = toNumber(row.taxable_value);
  const grossFromRaw = toNumber(row.raw_calc?.line_total_inclusive as number | string | null);
  const gross = grossFromRaw ?? sumNumbers(taxableValue, gstAmount);

  return {
    lineId: row.source_line_id,
    sku: row.sku || line.sku,
    styleCode: row.style_code || getStyleCode(row.sku || line.sku),
    hsn: row.hsn || null,
    gstRate: toNumber(row.gst_rate),
    gross,
    taxableValue,
    gstAmount,
    cgst,
    sgst,
    igst,
    source: "actual",
  };
}

async function buildShopifyGstPreview(
  companyId: string,
  lines: ShopifyOrderLine[],
  buyerStateCode: string | null,
) {
  const styleCodes = Array.from(
    new Set(lines.map((line) => getStyleCode(line.sku)).filter(Boolean)),
  ) as string[];
  const skus = Array.from(new Set(lines.map((line) => line.sku).filter(Boolean))) as string[];

  const styleMap = new Map<string, ShopifyStyleTaxProfile>();
  let notice: string | null = null;

  if (styleCodes.length) {
    const { data, error } = await supabase
      .from("erp_style_tax_profiles")
      .select("style_code, hsn, gst_rate")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .in("style_code", styleCodes);

    if (error) {
      if (!isMissingRelationError(error)) {
        notice = `Preview only — failed to load style tax profiles (${error.message}).`;
      } else {
        notice = "Preview only — style tax profile table not available.";
      }
    } else {
      (data || []).forEach((row) => {
        const profile = row as ShopifyStyleTaxProfile;
        if (profile.style_code) {
          styleMap.set(profile.style_code, profile);
        }
      });
    }
  }

  const gstSkuMap = new Map<string, ShopifyGstSkuMasterRow>();
  const missingStyleCodes = styleCodes.filter((code) => !styleMap.has(code));
  if (missingStyleCodes.length || skus.length) {
    const { data: styleData, error: styleError } =
      missingStyleCodes.length
        ? await supabase
            .from("erp_gst_sku_master")
            .select("style_code, sku, hsn, gst_rate")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .in("style_code", missingStyleCodes)
        : { data: null, error: null };

    const { data: skuData, error: skuError } =
      skus.length
        ? await supabase
            .from("erp_gst_sku_master")
            .select("style_code, sku, hsn, gst_rate")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .in("sku", skus)
        : { data: null, error: null };

    const error = styleError || skuError;

    if (error) {
      if (!isMissingRelationError(error)) {
        notice = notice || `Preview only — failed to load GST SKU master (${error.message}).`;
      } else if (!notice) {
        notice = "Preview only — GST SKU master table not available.";
      }
    } else {
      [...(styleData || []), ...(skuData || [])].forEach((row) => {
        const gstRow = row as ShopifyGstSkuMasterRow;
        if (gstRow.style_code) {
          gstSkuMap.set(gstRow.style_code, gstRow);
        }
        if (gstRow.sku) {
          gstSkuMap.set(gstRow.sku, gstRow);
        }
      });
    }
  }

  const isIntra = buyerStateCode === "RJ";

  const rows = lines.map((line) => {
    const styleCode = getStyleCode(line.sku);
    const styleProfile = styleCode ? styleMap.get(styleCode) : undefined;
    const skuProfile = line.sku ? gstSkuMap.get(line.sku) : undefined;
    const styleFallback = styleCode ? gstSkuMap.get(styleCode) : undefined;
    const mapping = styleProfile || styleFallback || skuProfile;
    const gstRate = toNumber(mapping?.gst_rate ?? null);
    const hsn = mapping?.hsn ?? null;
    const gross = getLineGross(line);
    const calc = calculateInclusiveGst(gross, gstRate, isIntra);

    return {
      lineId: line.id,
      sku: line.sku,
      styleCode,
      hsn,
      gstRate,
      gross,
      taxableValue: calc.taxableValue,
      gstAmount: calc.gstAmount,
      cgst: calc.cgst,
      sgst: calc.sgst,
      igst: calc.igst,
      source: "preview" as const,
    };
  });

  return { rows, notice };
}

function calculateInclusiveGst(gross: number | null, gstRate: number | null, isIntra: boolean) {
  if (gross == null || gstRate == null || !Number.isFinite(gstRate)) {
    return { taxableValue: null, gstAmount: null, cgst: null, sgst: null, igst: null };
  }
  const taxableValue = roundTo(gross * 100 / (100 + gstRate), 2);
  const gstAmount = roundTo(gross - taxableValue, 2);
  if (isIntra) {
    const cgst = roundTo(gstAmount / 2, 2);
    const sgst = roundTo(gstAmount - cgst, 2);
    return { taxableValue, gstAmount, cgst, sgst, igst: 0 };
  }
  return { taxableValue, gstAmount, cgst: 0, sgst: 0, igst: gstAmount };
}

function getStyleCode(sku: string | null | undefined) {
  if (!sku) return null;
  const [style] = sku.split("-");
  if (!style) return null;
  return style.trim().toUpperCase() || null;
}

function getLineGross(line: ShopifyOrderLine) {
  const quantity = toNumber(line.quantity);
  const price = toNumber(line.price);
  const lineDiscount = toNumber(line.line_discount);
  if (quantity == null || price == null) return null;
  const total = quantity * price - (lineDiscount ?? 0);
  return roundTo(Math.max(0, total), 2);
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sumNumbers(...values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function isMissingRelationError(error: { message?: string } | null | undefined) {
  return Boolean(error?.message && error.message.includes("does not exist"));
}
