import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

type OrderDetail = z.infer<typeof orderDetailSchema>;

type Order = z.infer<typeof orderSchema>;

type OrderItem = z.infer<typeof orderItemSchema>;

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";

const orderSchema = z
  .object({
    amazon_order_id: z.string(),
    order_status: z.string().nullable(),
    purchase_date: z.string().nullable(),
    buyer_email: z.string().nullable(),
    currency: z.string().nullable(),
    order_total: z.number().nullable(),
    ship_state: z.string().nullable(),
    ship_city: z.string().nullable(),
    ship_postal_code: z.string().nullable(),
  })
  .passthrough();

const orderItemSchema = z
  .object({
    order_item_key: z.string(),
    asin: z.string().nullable(),
    external_sku: z.string().nullable(),
    erp_sku: z.string().nullable(),
    title: z.string().nullable(),
    quantity: z.number().nullable(),
    item_amount: z.number().nullable(),
    item_tax: z.number().nullable(),
    shipping_amount: z.number().nullable(),
    shipping_tax: z.number().nullable(),
    promo_discount: z.number().nullable(),
    currency: z.string().nullable(),
    style_code: z.string().nullable(),
    size: z.string().nullable(),
    color: z.string().nullable(),
  })
  .passthrough();

const orderDetailSchema = z.object({
  order: orderSchema.nullable(),
  items: z.array(orderItemSchema),
});

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#b91c1c",
  fontSize: 13,
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null || Number.isNaN(amount)) return "—";
  const safeCurrency = currency || "INR";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (error) {
    return `${amount.toFixed(2)} ${safeCurrency}`;
  }
}

export default function AmazonOrderDetailPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);

  const amazonOrderId = useMemo(() => {
    const id = router.query.amazon_order_id;
    return typeof id === "string" ? id : null;
  }, [router.query.amazon_order_id]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      if (!amazonOrderId) {
        setLoading(false);
        return;
      }

      const { data, error: detailError } = await supabase.rpc("erp_amazon_order_detail", {
        p_marketplace_id: DEFAULT_MARKETPLACE_ID,
        p_amazon_order_id: amazonOrderId,
      });

      if (detailError) {
        setError(detailError.message);
        setLoading(false);
        return;
      }

      if (!data) {
        setOrder(null);
        setItems([]);
        setLoading(false);
        return;
      }

      const parsed = orderDetailSchema.safeParse(data as OrderDetail);
      if (!parsed.success) {
        setError("Unable to parse order detail response.");
        setLoading(false);
        return;
      }

      setOrder(parsed.data.order);
      setItems(parsed.data.items);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [amazonOrderId, router]);

  if (loading) {
    return <div style={pageContainerStyle}>Loading Amazon order…</div>;
  }

  if (error) {
    return <div style={pageContainerStyle}>{error}</div>;
  }

  if (!order) {
    return <div style={pageContainerStyle}>Order not found.</div>;
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Amazon</p>
            <h1 style={h1Style}>Order {order.amazon_order_id}</h1>
            <p style={subtitleStyle}>Operational view of Amazon order + items.</p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Link href="/erp/oms/amazon/orders" style={secondaryButtonStyle}>
              Back to orders
            </Link>
          </div>
        </header>

        {error ? <p style={errorStyle}>{error}</p> : null}

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <p style={eyebrowStyle}>Status</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={badgeStyle}>{order.order_status ?? "—"}</span>
              </div>
            </div>
            <div>
              <p style={eyebrowStyle}>Purchase date</p>
              <p style={{ margin: 0 }}>{formatDateTime(order.purchase_date)}</p>
            </div>
            <div>
              <p style={eyebrowStyle}>Total</p>
              <p style={{ margin: 0 }}>{formatCurrency(order.order_total, order.currency)}</p>
            </div>
            <div>
              <p style={eyebrowStyle}>Buyer</p>
              <p style={{ margin: 0 }}>{order.buyer_email ?? "—"}</p>
            </div>
            <div>
              <p style={eyebrowStyle}>Ship to</p>
              <p style={{ margin: 0 }}>
                {[order.ship_city, order.ship_state].filter(Boolean).join(", ") || "—"}
              </p>
              <p style={{ margin: 0, color: "#6b7280", fontSize: 12 }}>
                {order.ship_postal_code ?? "—"}
              </p>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Items</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>ASIN</th>
                <th style={tableHeaderCellStyle}>Title</th>
                <th style={tableHeaderCellStyle}>Qty</th>
                <th style={tableHeaderCellStyle}>Item</th>
                <th style={tableHeaderCellStyle}>Shipping</th>
                <th style={tableHeaderCellStyle}>Tax</th>
                <th style={tableHeaderCellStyle}>Promo</th>
                <th style={tableHeaderCellStyle}>Variant</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={9}>
                    No items found for this order.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.order_item_key}>
                    <td style={tableCellStyle}>{item.erp_sku ?? item.external_sku ?? "—"}</td>
                    <td style={tableCellStyle}>{item.asin ?? "—"}</td>
                    <td style={tableCellStyle}>{item.title ?? "—"}</td>
                    <td style={tableCellStyle}>{item.quantity ?? "—"}</td>
                    <td style={tableCellStyle}>
                      {formatCurrency(item.item_amount, item.currency || order.currency)}
                    </td>
                    <td style={tableCellStyle}>
                      {formatCurrency(item.shipping_amount, item.currency || order.currency)}
                    </td>
                    <td style={tableCellStyle}>
                      {formatCurrency(item.item_tax, item.currency || order.currency)}
                    </td>
                    <td style={tableCellStyle}>
                      {formatCurrency(item.promo_discount, item.currency || order.currency)}
                    </td>
                    <td style={tableCellStyle}>
                      {[item.style_code, item.size, item.color].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
