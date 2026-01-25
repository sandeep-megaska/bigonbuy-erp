import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import {
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
import { useDebouncedValue } from "../../../../../lib/erp/inventoryStock";
import { fetchShopifyOrders, ShopifyOrderRow } from "../../../../../lib/erp/omsShopify";

const PAGE_SIZE = 25;

const financialStatusOptions = [
  { value: "", label: "All financial statuses" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "authorized", label: "Authorized" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "partially_refunded", label: "Partially refunded" },
  { value: "refunded", label: "Refunded" },
  { value: "voided", label: "Voided" },
  { value: "unpaid", label: "Unpaid" },
];

const fulfillmentStatusOptions = [
  { value: "", label: "All fulfillment statuses" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "partial", label: "Partial" },
  { value: "unfulfilled", label: "Unfulfilled" },
  { value: "restocked", label: "Restocked" },
];

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDayIso(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`).toISOString();
}

function endOfDayIso(dateValue: string) {
  return new Date(`${dateValue}T23:59:59.999`).toISOString();
}

export default function ShopifyOrdersListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<ShopifyOrderRow[]>([]);

  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return formatDateInput(date);
  }, []);

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(formatDateInput(today));
  const [financialStatus, setFinancialStatus] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  const debouncedSearch = useDebouncedValue(searchQuery, 300);

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

      await loadOrders(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    setOffset(0);
  }, [dateFrom, dateTo, financialStatus, fulfillmentStatus, debouncedSearch]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    (async () => {
      await loadOrders(ctx.companyId, active);
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, dateFrom, dateTo, financialStatus, fulfillmentStatus, debouncedSearch, offset]);

  async function loadOrders(companyId: string, isActive = true) {
    setFetching(true);
    setError(null);

    const { rows, error: loadError, hasNextPage: hasNext } = await fetchShopifyOrders({
      companyId,
      dateFrom: dateFrom ? startOfDayIso(dateFrom) : null,
      dateTo: dateTo ? endOfDayIso(dateTo) : null,
      financialStatus: financialStatus || null,
      fulfillmentStatus: fulfillmentStatus || null,
      search: debouncedSearch,
      offset,
      limit: PAGE_SIZE,
    });

    if (!isActive) return;

    if (loadError) {
      setError(loadError.message);
      setOrders([]);
      setHasNextPage(false);
      setFetching(false);
      return;
    }

    setOrders(rows);
    setHasNextPage(hasNext);
    setFetching(false);
  }

  if (loading) {
    return (
      <ErpShell activeModule="oms">
        <div style={pageContainerStyle}>Loading Shopify orders…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="oms">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Shopify</p>
            <h1 style={h1Style}>Orders</h1>
            <p style={subtitleStyle}>Review Shopify orders synced into OMS.</p>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <div style={filterRowStyle}>
            <label style={filterLabelStyle}>
              <span style={filterCaptionStyle}>From</span>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} style={inputStyle} />
            </label>
            <label style={filterLabelStyle}>
              <span style={filterCaptionStyle}>To</span>
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} style={inputStyle} />
            </label>
            <label style={filterLabelStyle}>
              <span style={filterCaptionStyle}>Financial</span>
              <select value={financialStatus} onChange={(event) => setFinancialStatus(event.target.value)} style={inputStyle}>
                {financialStatusOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              <span style={filterCaptionStyle}>Fulfillment</span>
              <select value={fulfillmentStatus} onChange={(event) => setFulfillmentStatus(event.target.value)} style={inputStyle}>
                {fulfillmentStatusOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...filterLabelStyle, minWidth: 220, flex: 1 }}>
              <span style={filterCaptionStyle}>Search</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Order #, email, phone"
                style={inputStyle}
              />
            </label>
          </div>
          {fetching ? <div style={mutedStyle}>Refreshing orders…</div> : null}
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Order</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}>Financial</th>
                <th style={tableHeaderCellStyle}>Fulfillment</th>
                <th style={tableHeaderCellStyle}>Total</th>
                <th style={tableHeaderCellStyle}>Customer</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} style={tableCellStyle}>
                    No Shopify orders found for this range.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    style={rowStyle}
                    onClick={() => router.push(`/erp/oms/shopify/orders/${order.id}`)}
                  >
                    <td style={tableCellStyle}>
                      <Link href={`/erp/oms/shopify/orders/${order.id}`} style={linkStyle}>
                        {order.shopify_order_number || order.shopify_order_id}
                      </Link>
                    </td>
                    <td style={tableCellStyle}>{order.order_created_at ? new Date(order.order_created_at).toLocaleString() : "—"}</td>
                    <td style={tableCellStyle}>{order.financial_status || "—"}</td>
                    <td style={tableCellStyle}>{order.fulfillment_status || "—"}</td>
                    <td style={tableCellStyle}>
                      {order.total_price == null ? "—" : `${order.currency || ""} ${Number(order.total_price).toFixed(2)}`}
                    </td>
                    <td style={tableCellStyle}>{order.customer_email || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <div style={paginationRowStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset === 0}
          >
            Previous
          </button>
          <span style={mutedStyle}>Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={!hasNextPage}
          >
            Next
          </button>
        </div>
      </div>
    </ErpShell>
  );
}

const filterRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "flex-end",
};

const filterLabelStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const filterCaptionStyle: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
};

const paginationRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
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

const rowStyle: CSSProperties = {
  cursor: "pointer",
};

const linkStyle: CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 600,
};
