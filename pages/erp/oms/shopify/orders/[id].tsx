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

type FinancePostingLine = {
  memo: string | null;
  side: "debit" | "credit";
  amount: number | null;
  account_id: string | null;
  account_code?: string | null;
  account_name?: string | null;
};

type FinancePostingPreview = {
  source?: {
    id?: string | null;
    order_no?: string | null;
    order_id?: number | null;
    date?: string | null;
    channel?: string | null;
    currency?: string | null;
  } | null;
  totals?: {
    net_sales?: number | null;
    gst?: number | null;
    gross_total?: number | null;
  } | null;
  lines?: FinancePostingLine[] | null;
  errors?: string[] | null;
  can_post?: boolean | null;
  posted?: { journal_id?: string | null; doc_no?: string | null } | null;
};

type CogsPostingLine = {
  sku: string;
  qty: number;
  unit_cost: number | null;
  line_cost: number | null;
};

type CogsPostingPreview = {
  source?: {
    id?: string | null;
    order_no?: string | null;
    order_id?: number | null;
    date?: string | null;
    channel?: string | null;
    currency?: string | null;
  } | null;
  total_cogs?: number | null;
  lines?: CogsPostingLine[] | null;
  journal_lines?: FinancePostingLine[] | null;
  errors?: string[] | null;
  can_post?: boolean | null;
  posted?: { journal_id?: string | null; doc_no?: string | null; cogs_status?: string | null } | null;
};

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
  const [financePreview, setFinancePreview] = useState<FinancePostingPreview | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financePosting, setFinancePosting] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [financeNotice, setFinanceNotice] = useState<string | null>(null);
  const [postedJournal, setPostedJournal] = useState<{ id: string; doc_no: string | null } | null>(null);
  const [cogsPreview, setCogsPreview] = useState<CogsPostingPreview | null>(null);
  const [cogsLoading, setCogsLoading] = useState(false);
  const [cogsPosting, setCogsPosting] = useState(false);
  const [cogsError, setCogsError] = useState<string | null>(null);
  const [cogsNotice, setCogsNotice] = useState<string | null>(null);
  const [cogsPostedJournal, setCogsPostedJournal] = useState<{ id: string; doc_no: string | null } | null>(null);
  const hasMissingCogsCost = useMemo(
    () => Boolean(cogsPreview?.errors?.some((message) => message.toLowerCase().includes("missing cost"))),
    [cogsPreview?.errors]
  );

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

    if (process.env.NODE_ENV !== "production") {
      const orderKeys = orderData ? Object.keys(orderData) : [];
      const rawOrderKeys =
        orderData?.raw_order && typeof orderData.raw_order === "object"
          ? Object.keys(orderData.raw_order as Record<string, unknown>)
          : [];
      const lineKeys = lineRows[0] ? Object.keys(lineRows[0]) : [];
      const rawLineKeys =
        lineRows[0]?.raw_line && typeof lineRows[0].raw_line === "object"
          ? Object.keys(lineRows[0].raw_line as Record<string, unknown>)
          : [];
      console.debug("[GST Preview] erp_shopify_orders keys:", orderKeys);
      console.debug("[GST Preview] erp_shopify_orders raw_order keys:", rawOrderKeys);
      console.debug("[GST Preview] erp_shopify_order_lines keys:", lineKeys);
      console.debug("[GST Preview] erp_shopify_order_lines raw_line keys:", rawLineKeys);
    }

    setOrder(orderData);
    setLines(lineRows);
    setGstLoading(true);
    const gstDetail = await fetchShopifyOrderGstDetail(
      ctx.companyId,
      orderId,
      lineRows,
      orderData?.shipping_state_code ?? null,
      orderData,
    );
    setGstRows(gstDetail.rows);
    setGstStatus(gstDetail.status);
    setGstNotice(gstDetail.notice);
    setGstLoading(false);
  }, [ctx?.companyId, orderId]);

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const loadFinancePreview = useCallback(async () => {
    if (!ctx?.session?.access_token || !orderId) return;
    setFinanceLoading(true);
    setFinanceError(null);
    setFinanceNotice(null);
    try {
      const response = await fetch(`/api/erp/oms/shopify/orders/${orderId}/finance-preview`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ orderId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load finance preview.");
      }
      const preview = payload?.data as FinancePostingPreview;
      setFinancePreview(preview ?? null);
      const posted = preview?.posted?.journal_id
        ? { id: preview.posted.journal_id, doc_no: preview.posted.doc_no ?? null }
        : null;
      setPostedJournal(posted);
      if (posted) {
        setFinanceNotice(null);
      }
      if (preview?.errors && preview.errors.length > 0) {
        setFinanceError(preview.errors.join(", "));
      }
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : "Failed to load finance preview.";
      setFinanceError(message);
    } finally {
      setFinanceLoading(false);
    }
  }, [ctx?.session?.access_token, orderId]);

  const handleFinancePost = async () => {
    if (!ctx?.session?.access_token || !orderId) return;
    setFinancePosting(true);
    setFinanceError(null);
    setFinanceNotice(null);
    try {
      const response = await fetch(`/api/erp/oms/shopify/orders/${orderId}/finance-post`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ orderId, idempotencyKey: orderId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to post finance journal.");
      }
      if (payload?.journal?.id) {
        setPostedJournal({ id: payload.journal.id, doc_no: payload.journal.doc_no ?? null });
        setFinanceNotice(`Posted finance journal ${payload.journal.doc_no || ""}`.trim());
      } else {
        setFinanceNotice("Posted finance journal.");
      }
      await loadFinancePreview();
    } catch (postError) {
      const message = postError instanceof Error ? postError.message : "Failed to post finance journal.";
      setFinanceError(message);
    } finally {
      setFinancePosting(false);
    }
  };

  const loadCogsPreview = useCallback(async () => {
    if (!ctx?.session?.access_token || !orderId) return;
    setCogsLoading(true);
    setCogsError(null);
    setCogsNotice(null);
    try {
      const response = await fetch(`/api/erp/oms/shopify/orders/${orderId}/finance-cogs-preview`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ orderId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load COGS preview.");
      }
      const preview = payload?.data as CogsPostingPreview;
      setCogsPreview(preview ?? null);
      const posted = preview?.posted?.journal_id
        ? { id: preview.posted.journal_id, doc_no: preview.posted.doc_no ?? null }
        : null;
      setCogsPostedJournal(posted);
      if (posted) {
        setCogsNotice(null);
      }
      if (preview?.errors && preview.errors.length > 0) {
        setCogsError(preview.errors.join(", "));
      }
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : "Failed to load COGS preview.";
      setCogsError(message);
    } finally {
      setCogsLoading(false);
    }
  }, [ctx?.session?.access_token, orderId]);

  const handleCogsPost = async () => {
    if (!ctx?.session?.access_token || !orderId) return;
    setCogsPosting(true);
    setCogsError(null);
    setCogsNotice(null);
    try {
      const response = await fetch(`/api/erp/oms/shopify/orders/${orderId}/finance-cogs-post`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ orderId, idempotencyKey: orderId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to post COGS journal.");
      }
      if (payload?.journal?.id) {
        setCogsPostedJournal({ id: payload.journal.id, doc_no: payload.journal.doc_no ?? null });
        setCogsNotice(`Posted COGS journal ${payload.journal.doc_no || ""}`.trim());
      } else {
        setCogsNotice("Posted COGS journal.");
      }
      await loadCogsPreview();
    } catch (postError) {
      const message = postError instanceof Error ? postError.message : "Failed to post COGS journal.";
      setCogsError(message);
    } finally {
      setCogsPosting(false);
    }
  };

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
              <h2 style={{ ...h2Style, marginBottom: 4 }}>Finance Posting</h2>
              <p style={subtitleStyle}>Preview and post the sales revenue journal for this order.</p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={loadFinancePreview}
                style={secondaryButtonStyle}
                disabled={financeLoading}
              >
                {financeLoading ? "Loading…" : "Preview Finance Posting"}
              </button>
              <button
                type="button"
                onClick={handleFinancePost}
                style={{
                  ...primaryButtonStyle,
                  opacity: financePosting ? 0.7 : 1,
                }}
                disabled={
                  financePosting || financeLoading || !financePreview?.can_post || Boolean(postedJournal?.id)
                }
              >
                {financePosting ? "Posting…" : postedJournal?.id ? "Posted to Finance" : "Post to Finance"}
              </button>
            </div>
          </div>

          {postedJournal?.id ? (
            <div style={{ marginTop: 10, fontSize: 14 }}>
              Posted:{" "}
              <Link href={`/erp/finance/journals/${postedJournal.id}`} style={linkStyle}>
                {postedJournal.doc_no || postedJournal.id}
              </Link>
            </div>
          ) : null}

          {financeNotice ? <div style={{ marginTop: 10, color: "#047857" }}>{financeNotice}</div> : null}
          {financeError ? <div style={{ marginTop: 10, color: "#b91c1c" }}>{financeError}</div> : null}

          {financePreview?.totals ? (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Net Sales</span>
                <span>{formatMoney(order.currency, financePreview.totals.net_sales ?? null)}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>GST Output</span>
                <span>{formatMoney(order.currency, financePreview.totals.gst ?? null)}</span>
              </div>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Gross Total</span>
                <span>{formatMoney(order.currency, financePreview.totals.gross_total ?? null)}</span>
              </div>
            </div>
          ) : null}

          {financePreview?.lines && financePreview.lines.length > 0 ? (
            <table style={{ ...tableStyle, marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Account</th>
                  <th style={tableHeaderCellStyle}>Memo</th>
                  <th style={tableHeaderCellStyle}>Debit</th>
                  <th style={tableHeaderCellStyle}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {financePreview.lines.map((line, index) => (
                  <tr key={`${line.account_id}-${index}`}>
                    <td style={tableCellStyle}>
                      {line.account_code ? `${line.account_code} · ${line.account_name}` : line.account_name || "—"}
                    </td>
                    <td style={tableCellStyle}>{line.memo || "—"}</td>
                    <td style={tableCellStyle}>
                      {line.side === "debit" ? formatMoney(order.currency, line.amount ?? null) : "—"}
                    </td>
                    <td style={tableCellStyle}>
                      {line.side === "credit" ? formatMoney(order.currency, line.amount ?? null) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={{ ...h2Style, marginBottom: 4 }}>COGS Posting</h2>
              <p style={subtitleStyle}>Preview and post the cost of goods sold journal for this order.</p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={loadCogsPreview}
                style={secondaryButtonStyle}
                disabled={cogsLoading}
              >
                {cogsLoading ? "Loading…" : "Preview COGS"}
              </button>
              <button
                type="button"
                onClick={handleCogsPost}
                style={{
                  ...primaryButtonStyle,
                  opacity: cogsPosting ? 0.7 : 1,
                }}
                disabled={cogsPosting || cogsLoading || !cogsPreview?.can_post || Boolean(cogsPostedJournal?.id)}
              >
                {cogsPosting ? "Posting…" : cogsPostedJournal?.id ? "COGS Posted" : "Post COGS"}
              </button>
            </div>
          </div>

          {cogsPostedJournal?.id ? (
            <div style={{ marginTop: 10, fontSize: 14 }}>
              Posted:{" "}
              <Link href={`/erp/finance/journals/${cogsPostedJournal.id}`} style={linkStyle}>
                {cogsPostedJournal.doc_no || cogsPostedJournal.id}
              </Link>
            </div>
          ) : null}

          {cogsNotice ? <div style={{ marginTop: 10, color: "#047857" }}>{cogsNotice}</div> : null}
          {cogsError ? <div style={{ marginTop: 10, color: "#b91c1c" }}>{cogsError}</div> : null}
          {hasMissingCogsCost ? (
            <div style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>
              Missing a cost seed?{" "}
              <Link href="/erp/inventory/cost-seeds" style={linkStyle}>
                Open cost seeds
              </Link>
              .
            </div>
          ) : null}

          {cogsPreview?.total_cogs != null ? (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <div style={summaryRowStyle}>
                <span style={summaryLabelStyle}>Total COGS</span>
                <span>{formatMoney(order.currency, cogsPreview.total_cogs ?? null)}</span>
              </div>
            </div>
          ) : null}

          {cogsPreview?.lines && cogsPreview.lines.length > 0 ? (
            <table style={{ ...tableStyle, marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>SKU</th>
                  <th style={tableHeaderCellStyle}>Qty</th>
                  <th style={tableHeaderCellStyle}>Unit Cost</th>
                  <th style={tableHeaderCellStyle}>Line Cost</th>
                </tr>
              </thead>
              <tbody>
                {cogsPreview.lines.map((line, index) => (
                  <tr key={`${line.sku}-${index}`}>
                    <td style={tableCellStyle}>{line.sku || "—"}</td>
                    <td style={tableCellStyle}>{line.qty ?? "—"}</td>
                    <td style={tableCellStyle}>{formatMoney(order.currency, line.unit_cost ?? null)}</td>
                    <td style={tableCellStyle}>{formatMoney(order.currency, line.line_cost ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {cogsPreview?.journal_lines && cogsPreview.journal_lines.length > 0 ? (
            <table style={{ ...tableStyle, marginTop: 12 }}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Account</th>
                  <th style={tableHeaderCellStyle}>Memo</th>
                  <th style={tableHeaderCellStyle}>Debit</th>
                  <th style={tableHeaderCellStyle}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {cogsPreview.journal_lines.map((line, index) => (
                  <tr key={`${line.account_id}-${index}`}>
                    <td style={tableCellStyle}>
                      {line.account_code ? `${line.account_code} · ${line.account_name}` : line.account_name || "—"}
                    </td>
                    <td style={tableCellStyle}>{line.memo || "—"}</td>
                    <td style={tableCellStyle}>
                      {line.side === "debit" ? formatMoney(order.currency, line.amount ?? null) : "—"}
                    </td>
                    <td style={tableCellStyle}>
                      {line.side === "credit" ? formatMoney(order.currency, line.amount ?? null) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
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
                  <th style={tableHeaderCellStyle}>Gross (before discount)</th>
                  <th style={tableHeaderCellStyle}>Discount</th>
                  <th style={tableHeaderCellStyle}>Sold Price</th>
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
                    <td colSpan={12} style={tableCellStyle}>
                      No GST data available for this order.
                    </td>
                  </tr>
                ) : (
                  <>
                    {gstRows.map((row) => (
                      <tr key={row.lineId}>
                        <td style={tableCellStyle}>{row.sku || "—"}</td>
                        <td style={tableCellStyle}>{row.styleCode || "—"}</td>
                        <td style={tableCellStyle}>{row.hsn || "—"}</td>
                        <td style={tableCellStyle}>{formatRate(row.gstRate)}</td>
                        <td style={tableCellStyle}>
                          {formatMoney(order.currency, row.grossBeforeDiscount)}
                        </td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, row.discount)}</td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, row.soldPrice)}</td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, row.taxableValue)}</td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, row.gstAmount)}</td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, row.cgst)}</td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, row.sgst)}</td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, row.igst)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={tableHeaderCellStyle}>Totals</td>
                      <td style={tableCellStyle} colSpan={3} />
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "grossBeforeDiscount"))}
                      </td>
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "discount"))}
                      </td>
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "soldPrice"))}
                      </td>
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "taxableValue"))}
                      </td>
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "gstAmount"))}
                      </td>
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "cgst"))}
                      </td>
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "sgst"))}
                      </td>
                      <td style={tableHeaderCellStyle}>
                        {formatMoney(order.currency, sumGstNumbers(gstRows, "igst"))}
                      </td>
                    </tr>
                  </>
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

function sumGstNumbers(rows: ShopifyOrderGstRow[], key: keyof ShopifyOrderGstRow) {
  return rows.reduce((total, row) => {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return total + value;
    }
    return total;
  }, 0);
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

const primaryButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
};

const linkStyle: CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 600,
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
