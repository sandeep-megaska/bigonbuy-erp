import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

const tabButtonStyle = (active: boolean) => ({
  ...secondaryButtonStyle,
  borderColor: active ? "#111827" : "#d1d5db",
  backgroundColor: active ? "#111827" : "#fff",
  color: active ? "#fff" : "#111827",
});

type OmsOrder = {
  id: string;
  source: string;
  external_order_id: number;
  external_order_number: string | null;
  order_created_at: string;
  processed_at: string | null;
  currency: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  is_cancelled: boolean;
  status: string;
  subtotal_price: number | null;
  total_discounts: number | null;
  total_shipping: number | null;
  total_tax: number | null;
  total_price: number | null;
  customer_email: string | null;
  shipping_state_code: string | null;
  shipping_pincode: string | null;
};

type OmsOrderLine = {
  id: string;
  sku: string | null;
  title: string | null;
  quantity: number;
  price: number | null;
  line_discount: number | null;
  taxable: boolean;
  variant_id: string | null;
  reservation_id: string | null;
  status: string;
};

type VariantRow = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  product_id: string | null;
};

type ProductRow = {
  id: string;
  title: string;
};

export default function OmsOrderDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const orderId = Array.isArray(id) ? id[0] : id;

  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"summary" | "lines" | "inventory">("summary");
  const [order, setOrder] = useState<OmsOrder | null>(null);
  const [lines, setLines] = useState<OmsOrderLine[]>([]);
  const [variantMap, setVariantMap] = useState<Map<string, VariantRow>>(new Map());
  const [productMap, setProductMap] = useState<Map<string, ProductRow>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);

  const loadOrder = useCallback(async () => {
    if (!ctx?.companyId || !orderId) return;
    setError(null);

    const { data, error: loadError } = await supabase
      .from("erp_oms_orders")
      .select(
        "id, source, external_order_id, external_order_number, order_created_at, processed_at, currency, financial_status, fulfillment_status, cancelled_at, is_cancelled, status, subtotal_price, total_discounts, total_shipping, total_tax, total_price, customer_email, shipping_state_code, shipping_pincode",
      )
      .eq("company_id", ctx.companyId)
      .eq("id", orderId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message || "Failed to load OMS order.");
      setOrder(null);
      return;
    }

    setOrder((data || null) as OmsOrder | null);
  }, [ctx?.companyId, orderId]);

  const loadLines = useCallback(async () => {
    if (!ctx?.companyId || !orderId) return;

    const { data: lineData, error: lineError } = await supabase
      .from("erp_oms_order_lines")
      .select("id, sku, title, quantity, price, line_discount, taxable, variant_id, reservation_id, status")
      .eq("company_id", ctx.companyId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (lineError) {
      setError(lineError.message || "Failed to load OMS lines.");
      setLines([]);
      return;
    }

    const rows = (lineData || []) as OmsOrderLine[];
    setLines(rows);

    const variantIds = Array.from(new Set(rows.map((line) => line.variant_id).filter(Boolean))) as string[];
    if (variantIds.length === 0) {
      setVariantMap(new Map());
      setProductMap(new Map());
      return;
    }

    const { data: variantData, error: variantError } = await supabase
      .from("erp_variants")
      .select("id, sku, size, color, product_id")
      .in("id", variantIds);

    if (variantError) {
      setError(variantError.message || "Failed to load variant details.");
      setVariantMap(new Map());
      setProductMap(new Map());
      return;
    }

    const variantRows = (variantData || []) as VariantRow[];
    setVariantMap(new Map(variantRows.map((variant) => [variant.id, variant])));

    const productIds = Array.from(
      new Set(variantRows.map((variant) => variant.product_id).filter(Boolean))
    ) as string[];

    if (productIds.length === 0) {
      setProductMap(new Map());
      return;
    }

    const { data: productData, error: productError } = await supabase
      .from("erp_products")
      .select("id, title")
      .in("id", productIds);

    if (productError) {
      setError(productError.message || "Failed to load product titles.");
      setProductMap(new Map());
      return;
    }

    setProductMap(new Map((productData || []).map((product) => [product.id, product as ProductRow])));
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

      await Promise.all([loadOrder(), loadLines()]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, loadOrder, loadLines]);

  async function handleInventoryAction(action: "reserve" | "fulfill" | "cancel" | "refund") {
    if (!orderId) return;
    if (!canWrite) {
      setError("You do not have permission to run OMS inventory actions.");
      return;
    }

    setError(null);
    setNotice(null);
    setActionLoading(action);

    let rpcName = "";
    let payload: Record<string, unknown> | null = null;

    switch (action) {
      case "reserve":
        rpcName = "erp_oms_reserve_inventory";
        break;
      case "fulfill":
        rpcName = "erp_oms_fulfill_order";
        payload = {};
        break;
      case "cancel":
        rpcName = "erp_oms_cancel_order";
        break;
      case "refund":
        rpcName = "erp_oms_refund_order";
        payload = {};
        break;
      default:
        break;
    }

    if (!rpcName) return;

    const { error: actionError } = await supabase.rpc(rpcName, {
      p_order_id: orderId,
      ...(payload ? { p_payload: payload } : {}),
    });

    if (actionError) {
      setError(actionError.message || `Failed to ${action} OMS order.`);
      setActionLoading(null);
      return;
    }

    setNotice(`OMS order ${action} action completed successfully.`);
    await Promise.all([loadOrder(), loadLines()]);
    setActionLoading(null);
  }

  if (loading) {
    return (
      <ErpShell activeModule="oms">
        <div style={pageContainerStyle}>Loading OMS order…</div>
      </ErpShell>
    );
  }

  if (!order) {
    return (
      <ErpShell activeModule="oms">
        <div style={pageContainerStyle}>{error || "OMS order not found."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="oms">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Orders</p>
            <h1 style={h1Style}>Order {order.external_order_number || order.external_order_id}</h1>
            <p style={subtitleStyle}>Review OMS order details, line items, and inventory actions.</p>
          </div>
          <div>
            <Link href="/erp/oms/orders" style={secondaryButtonStyle}>
              Back to orders
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={tabRowStyle}>
            <button type="button" style={tabButtonStyle(activeTab === "summary")} onClick={() => setActiveTab("summary")}>Summary</button>
            <button type="button" style={tabButtonStyle(activeTab === "lines")} onClick={() => setActiveTab("lines")}>Lines</button>
            <button
              type="button"
              style={tabButtonStyle(activeTab === "inventory")}
              onClick={() => setActiveTab("inventory")}
            >
              Inventory
            </button>
          </div>

          {activeTab === "summary" ? (
            <div style={summaryGridStyle}>
              <div>
                <h2 style={h2Style}>Order details</h2>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>Source</span>
                  <span>{order.source}</span>
                </div>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>Created</span>
                  <span>{new Date(order.order_created_at).toLocaleString()}</span>
                </div>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>Status</span>
                  <span>{order.is_cancelled ? "Cancelled" : order.status}</span>
                </div>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>Financial</span>
                  <span>{order.financial_status || "—"}</span>
                </div>
                <div style={summaryRowStyle}>
                  <span style={summaryLabelStyle}>Fulfillment</span>
                  <span>{order.fulfillment_status || "—"}</span>
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
          ) : null}

          {activeTab === "lines" ? (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>SKU</th>
                  <th style={tableHeaderCellStyle}>Title</th>
                  <th style={tableHeaderCellStyle}>Variant</th>
                  <th style={tableHeaderCellStyle}>Qty</th>
                  <th style={tableHeaderCellStyle}>Price</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Reservation</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={tableCellStyle}>
                      No OMS order lines found.
                    </td>
                  </tr>
                ) : (
                  lines.map((line) => {
                    const variant = line.variant_id ? variantMap.get(line.variant_id) : null;
                    const productTitle = variant?.product_id ? productMap.get(variant.product_id)?.title : null;
                    return (
                      <tr key={line.id}>
                        <td style={tableCellStyle}>{variant?.sku || line.sku || "—"}</td>
                        <td style={tableCellStyle}>{line.title || productTitle || "—"}</td>
                        <td style={tableCellStyle}>
                          {variant ? `${variant.size || ""} ${variant.color || ""}`.trim() || "—" : "—"}
                        </td>
                        <td style={tableCellStyle}>{line.quantity}</td>
                        <td style={tableCellStyle}>{formatMoney(order.currency, line.price)}</td>
                        <td style={tableCellStyle}>{line.status}</td>
                        <td style={tableCellStyle}>{line.reservation_id ? "Reserved" : "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : null}

          {activeTab === "inventory" ? (
            <div style={inventoryPanelStyle}>
              <h2 style={h2Style}>Inventory actions</h2>
              <p style={subtitleStyle}>
                Trigger OMS inventory RPCs for the current order. Actions call existing server-side procedures only.
              </p>
              <div style={actionRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => handleInventoryAction("reserve")}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "reserve" ? "Reserving…" : "Reserve inventory"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => handleInventoryAction("fulfill")}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "fulfill" ? "Fulfilling…" : "Mark fulfilled"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => handleInventoryAction("cancel")}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "cancel" ? "Cancelling…" : "Cancel order"}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => handleInventoryAction("refund")}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "refund" ? "Refunding…" : "Refund order"}
                </button>
              </div>
              {!canWrite ? <div style={mutedStyle}>You need inventory access to run actions.</div> : null}
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}

function formatMoney(currency: string, value: number | null) {
  if (value == null) return "—";
  return `${currency} ${Number(value).toFixed(2)}`;
}

const tabRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 16,
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

const inventoryPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
};

const errorStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fee2e2",
  color: "#b91c1c",
  fontSize: 14,
};

const noticeStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#dcfce7",
  color: "#166534",
  fontSize: 14,
};
