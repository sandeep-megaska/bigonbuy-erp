import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import {
  fetchShopifyOrderDetail,
  fetchShopifyOrderGstDetail,
  ShopifyOrderGstRow,
  ShopifyOrderLine,
  ShopifyOrderRow,
} from "../../../../../lib/erp/omsShopify";

export default function ShopifyOrderDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const orderId = Array.isArray(id) ? id[0] : id;

  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<ShopifyOrderRow | null>(null);
  const [lines, setLines] = useState<ShopifyOrderLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [gstRows, setGstRows] = useState<ShopifyOrderGstRow[]>([]);
  const [gstStatus, setGstStatus] = useState<"actual" | "preview">("preview");
  const [gstNotice, setGstNotice] = useState<string | null>(null);
  const [gstLoading, setGstLoading] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!ctx?.companyId || !orderId) return;
    setError(null);

    const { order: orderData, lines: lineRows, error: loadError } = await fetchShopifyOrderDetail(
      ctx.companyId,
      orderId,
    );

    if (loadError) {
      setError(loadError.message || "Failed to load Shopify order.");
      setOrder(null);
      setLines([]);
      setGstRows([]);
      return;
    }

    setOrder(orderData);
    setLines(lineRows);
    setGstLoading(true);
    const gstDetail = await fetchShopifyOrderGstDetail(
      ctx.companyId,
      orderId,
      lineRows,
      orderData?.shipping_state_code ?? null,
    );
    setGstRows(gstDetail.rows);
    setGstStatus(gstDetail.status);
    setGstNotice(gstDetail.notice);
    setGstLoading(false);
  }, [ctx?.companyId, orderId]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadOrder();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, loadOrder]);

  const rawOrderJson = useMemo(() => {
    if (!order?.raw_order) return null;
    try {
      return JSON.stringify(order.raw_order, null, 2);
    } catch (jsonError) {
      return null;
    }
  }, [order?.raw_order]);

  if (loading) {
    return (
      <ErpShell activeModule="oms">
        <div style={pageContainerStyle}>Loading Shopify order…</div>
      </ErpShell>
    );
  }

  if (!order) {
    return (
      <ErpShell activeModule="oms">
        <div style={pageContainerStyle}>{error || "Shopify order not found."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="oms">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Shopify</p>
            <h1 style={h1Style}>Order {order.shopify_order_number || order.shopify_order_id}</h1>
            <p style={subtitleStyle}>Review Shopify order details and line items.</p>
          </div>
          <div>
            <Link href="/erp/oms/shopify/orders" style={secondaryButtonStyle}>
              Back to orders
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <div style={summaryGridStyle}>
            <div>
              <h2 style={h2Style}>Order details</h2>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Created</span>
                <span>{order.order_created_at ? new Date(order.order_created_at).toLocaleString() : "—"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Financial</span>
                <span>{order.financial_status || "—"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Fulfillment</span>
                <span>{order.fulfillment_status || "—"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Cancelled</span>
                <span>{order.is_cancelled ? "Yes" : "No"}</span>
              </div>
            </div>
            <div>
              <h2 style={h2Style}>Customer</h2>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Email</span>
                <span>{order.customer_email || "—"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>State</span>
                <span>{order.shipping_state_code || "—"}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Pincode</span>
                <span>{order.shipping_pincode || "—"}</span>
              </div>
            </div>
            <div>
              <h2 style={h2Style}>Totals</h2>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Subtotal</span>
                <span>{formatMoney(order.currency, order.subtotal_price)}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Discounts</span>
                <span>{formatMoney(order.currency, order.total_discounts)}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Shipping</span>
                <span>{formatMoney(order.currency, order.total_shipping)}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Tax</span>
                <span>{formatMoney(order.currency, order.total_tax)}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Total</span>
                <span>{formatMoney(order.currency, order.total_price)}</span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>Title</th>
                <th style={tableHeaderCellStyle}>Qty</th>
                <th style={tableHeaderCellStyle}>Price</th>
                <th style={tableHeaderCellStyle}>Tax</th>
                <th style={tableHeaderCellStyle}>Discount</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} style={tableCellStyle}>
                    No Shopify order lines found.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id}>
                    <td style={tableCellStyle}>{line.sku || "—"}</td>
                    <td style={tableCellStyle}>{line.title || "—"}</td>
                    <td style={tableCellStyle}>{line.quantity ?? "—"}</td>
                    <td style={tableCellStyle}>{formatMoney(order.currency, line.price)}</td>
                    <td style={tableCellStyle}>{formatMoney(order.currency, getLineTax(line))}</td>
                    <td style={tableCellStyle}>{formatMoney(order.currency, getLineDiscount(line))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={{ ...h2Style, marginBottom: 4 }}>GST</h2>
              <p style={subtitleStyle}>
                {gstStatus === "actual"
                  ? "Actual GST register rows for this order."
                  : "Preview only — GST register rows not found."}
              </p>
            </div>
            <span style={gstBadgeStyle}>{gstStatus === "actual" ? "Actual" : "Preview only"}</span>
          </div>
          {gstNotice ? <p style={gstNoticeStyle}>{gstNotice}</p> : null}
          {gstLoading ? (
            <div style={loadingInlineStyle}>Loading GST details…</div>
          ) : (
            <table style={{ ...tableStyle, marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>SKU</th>
                  <th style={tableHeaderCellStyle}>Style Code</th>
                  <th style={tableHeaderCellStyle}>HSN</th>
                  <th style={tableHeaderCellStyle}>GST %</th>
                  <th style={tableHeaderCellStyle}>Gross</th>
                  <th style={tableHeaderCellStyle}>Taxable Value</th>
                  <th style={tableHeaderCellStyle}>GST Amount</th>
                  <th style={tableHeaderCellStyle}>CGST</th>
                  <th style={tableHeaderCellStyle}>SGST</th>
                  <th style={tableHeaderCellStyle}>IGST</th>
                </tr>
              </thead>
              <tbody>
                {gstRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={tableCellStyle}>
                      No GST data available for this order.
                    </td>
                  </tr>
                ) : (
                  gstRows.map((row) => (
                    <tr key={row.lineId}>
                      <td style={tableCellStyle}>{row.sku || "—"}</td>
                      <td style={tableCellStyle}>{row.styleCode || "—"}</td>
                      <td style={tableCellStyle}>{row.hsn || "—"}</td>
                      <td style={tableCellStyle}>{formatRate(row.gstRate)}</td>
                      <td style={tableCellStyle}>{formatMoney(order.currency, row.gross)}</td>
                      <td style={tableCellStyle}>{formatMoney(order.currency, row.taxableValue)}</td>
                      <td style={tableCellStyle}>{formatMoney(order.currency, row.gstAmount)}</td>
                      <td style={tableCellStyle}>{formatMoney(order.currency, row.cgst)}</td>
                      <td style={tableCellStyle}>{formatMoney(order.currency, row.sgst)}</td>
                      <td style={tableCellStyle}>{formatMoney(order.currency, row.igst)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </section>

        {rawOrderJson ? (
          <section style={cardStyle}>
            <details>
              <summary style={summaryToggleStyle}>Raw JSON</summary>
              <pre style={jsonBlockStyle}>{rawOrderJson}</pre>
            </details>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}

function formatMoney(currency: string | null, value: number | null) {
  if (value == null) return "—";
  return `${currency || ""} ${Number(value).toFixed(2)}`.trim();
}

function formatRate(rate: number | null) {
  if (rate == null) return "—";
  return `${Number(rate).toFixed(2)}%`;
}

function getLineTax(line: ShopifyOrderLine) {
  const raw = line.raw_line as Record<string, any> | null | undefined;
  const taxLines = raw && Array.isArray(raw.tax_lines)
    ? (raw.tax_lines as Array<{ price?: string | number }>)
    : null;
  if (taxLines) {
    const sum = taxLines.reduce((total, item) => {
      const priceValue =
        typeof item.price === "string"
          ? Number(item.price)
          : typeof item.price === "number"
            ? item.price
            : 0;
      return total + (Number.isFinite(priceValue) ? priceValue : 0);
    }, 0);
    return Number.isFinite(sum) && sum !== 0 ? sum : null;
  }
  const legacyTax =
    typeof raw?.total_tax === "string"
      ? Number(raw.total_tax)
      : typeof raw?.total_tax === "number"
        ? raw.total_tax
        : null;
  return Number.isFinite(legacyTax ?? NaN) ? legacyTax : null;
}

function getLineDiscount(line: ShopifyOrderLine) {
  if (line.line_discount != null) return line.line_discount;
  const raw = line.raw_line as Record<string, any> | null | undefined;
  const discount =
    typeof raw?.total_discount === "string"
      ? Number(raw.total_discount)
      : typeof raw?.total_discount === "number"
        ? raw.total_discount
        : null;
  return Number.isFinite(discount ?? NaN) ? discount : null;
}

const secondaryButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gap: 24,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const summaryRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "6px 0",
  borderBottom: "1px solid #e5e7eb",
};

const summaryLabelStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
};

const summaryToggleStyle: CSSProperties = {
  fontWeight: 600,
  cursor: "pointer",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const gstBadgeStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "#e0f2fe",
  color: "#0369a1",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const gstNoticeStyle: CSSProperties = {
  marginTop: 8,
  color: "#6b7280",
  fontSize: 13,
};

const loadingInlineStyle: CSSProperties = {
  marginTop: 12,
  color: "#6b7280",
  fontSize: 13,
};

const jsonBlockStyle: CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 8,
  background: "#f3f4f6",
  fontSize: 12,
  overflowX: "auto",
  maxHeight: 320,
};

const errorStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#b91c1c",
  fontSize: 14,
};
