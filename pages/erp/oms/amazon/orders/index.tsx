import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type OrderRow = z.infer<typeof orderRowSchema>;

type SyncResponse =
  | { ok: true; orders_upserted: number; items_written: number; next_watermark: string | null }
  | { ok: false; error: string };

const orderRowSchema = z.object({
  amazon_order_id: z.string(),
  order_status: z.string().nullable(),
  purchase_date: z.string().nullable(),
  last_update_date: z.string().nullable(),
  fulfillment_channel: z.string().nullable(),
  sales_channel: z.string().nullable(),
  order_type: z.string().nullable(),
  buyer_email: z.string().nullable(),
  buyer_name: z.string().nullable(),
  ship_service_level: z.string().nullable(),
  currency: z.string().nullable(),
  order_total: z.number().nullable(),
  number_of_items_shipped: z.number().nullable(),
  number_of_items_unshipped: z.number().nullable(),
  is_prime: z.boolean().nullable(),
  is_business_order: z.boolean().nullable(),
  shipping_address_city: z.string().nullable(),
  shipping_address_state: z.string().nullable(),
  shipping_address_country_code: z.string().nullable(),
});

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";

const statusOptions = [
  "",
  "Pending",
  "PendingAvailability",
  "Unshipped",
  "PartiallyShipped",
  "Shipped",
  "Canceled",
  "Unfulfillable",
  "InvoiceUnconfirmed",
];

const filtersGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  alignItems: "end",
};

const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  color: "#4b5563",
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#b91c1c",
  fontSize: 13,
};

const noticeStyle: CSSProperties = {
  margin: 0,
  color: "#047857",
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

export default function AmazonOrdersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [query, setQuery] = useState("");

  const canSync = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin"].includes(ctx.roleKey)),
    [ctx]
  );

  const getAccessToken = useCallback(async () => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return null;
    }
    return token;
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!ctx?.companyId) return;
    setError(null);
    setNotice(null);
    setIsFetching(true);

    const { data, error: listError } = await supabase.rpc("erp_amazon_orders_list", {
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_status: statusFilter || null,
      p_from: fromDate || null,
      p_to: toDate || null,
      p_q: query || null,
      p_limit: 100,
      p_offset: 0,
    });

    if (listError) {
      setError(listError.message);
      setIsFetching(false);
      return;
    }

    const parsed = z.array(orderRowSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse orders list response.");
      setIsFetching(false);
      return;
    }

    setOrders(parsed.data);
    setIsFetching(false);
  }, [ctx?.companyId, statusFilter, fromDate, toDate, query]);

  const handleSync = async () => {
    setNotice(null);
    setError(null);
    setIsSyncing(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        return;
      }
      const response = await fetch("/api/integrations/amazon/orders/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ marketplaceId: DEFAULT_MARKETPLACE_ID }),
      });

      const payload = (await response.json()) as SyncResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? "Sync failed." : payload.error);
      } else {
        setNotice(
          `Synced ${payload.orders_upserted} order(s), ${payload.items_written} item(s). Next watermark: ${
            payload.next_watermark ?? "—"
          }`
        );
        await fetchOrders();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed.";
      setError(message);
    } finally {
      setIsSyncing(false);
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
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    fetchOrders();
  }, [ctx?.companyId, fetchOrders]);

  if (loading) {
    return <div style={pageContainerStyle}>Loading Amazon orders…</div>;
  }

  if (error && !ctx?.companyId) {
    return <div style={pageContainerStyle}>{error}</div>;
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Amazon</p>
            <h1 style={h1Style}>Amazon Orders (India)</h1>
            <p style={subtitleStyle}>
              Sync near real-time Amazon orders via SP-API and review operational details.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={fetchOrders}
              disabled={isFetching}
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={handleSync}
              disabled={!canSync || isSyncing}
            >
              {isSyncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </header>

        {notice ? <p style={noticeStyle}>{notice}</p> : null}
        {error ? <p style={errorStyle}>{error}</p> : null}

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={filtersGridStyle}>
            <label style={fieldLabelStyle}>
              Status
              <select
                value={statusFilter}
                style={inputStyle}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {statusOptions.map((status) => (
                  <option key={status || "all"} value={status}>
                    {status ? status.replace(/([A-Z])/g, " $1").trim() : "All statuses"}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldLabelStyle}>
              From date
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldLabelStyle}>
              To date
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={fieldLabelStyle}>
              Search (Order ID / SKU)
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search order id, SKU"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={secondaryButtonStyle} onClick={fetchOrders}>
                Apply filters
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Order</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Purchase date</th>
                <th style={tableHeaderCellStyle}>Last update</th>
                <th style={tableHeaderCellStyle}>Buyer</th>
                <th style={tableHeaderCellStyle}>Total</th>
                <th style={tableHeaderCellStyle}>Items</th>
                <th style={tableHeaderCellStyle}>Ship to</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={8}>
                    {isFetching ? "Loading orders…" : "No Amazon orders found."}
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.amazon_order_id}>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <Link href={`/erp/oms/amazon/orders/${order.amazon_order_id}`}>
                          {order.amazon_order_id}
                        </Link>
                        <span style={badgeStyle}>{order.fulfillment_channel ?? "—"}</span>
                      </div>
                    </td>
                    <td style={tableCellStyle}>{order.order_status ?? "—"}</td>
                    <td style={tableCellStyle}>{formatDateTime(order.purchase_date)}</td>
                    <td style={tableCellStyle}>{formatDateTime(order.last_update_date)}</td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span>{order.buyer_name ?? "—"}</span>
                        <span style={{ color: "#6b7280", fontSize: 12 }}>
                          {order.buyer_email ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td style={tableCellStyle}>
                      {formatCurrency(order.order_total, order.currency)}
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span>Shipped: {order.number_of_items_shipped ?? "—"}</span>
                        <span>Unshipped: {order.number_of_items_unshipped ?? "—"}</span>
                      </div>
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span>
                          {[order.shipping_address_city, order.shipping_address_state]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </span>
                        <span style={{ color: "#6b7280", fontSize: 12 }}>
                          {order.shipping_address_country_code ?? "—"}
                        </span>
                      </div>
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
