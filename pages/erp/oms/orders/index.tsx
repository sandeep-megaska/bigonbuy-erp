import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
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
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { useDebouncedValue } from "../../../../lib/erp/inventoryStock";
import { supabase } from "../../../../lib/supabaseClient";

const PAGE_SIZE = 25;

type OmsOrderRow = {
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

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
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

export default function OmsOrdersListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OmsOrderRow[]>([]);

  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return formatDateInput(date);
  }, []);

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(formatDateInput(today));
  const [statusFilter, setStatusFilter] = useState("");
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
  }, [dateFrom, dateTo, statusFilter, debouncedSearch]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    (async () => {
      await loadOrders(ctx.companyId, active);
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, dateFrom, dateTo, statusFilter, debouncedSearch, offset]);

  async function loadOrders(companyId: string, isActive = true) {
    setFetching(true);
    setError(null);

    let query = supabase
      .from("erp_oms_orders")
      .select(
        "id, source, external_order_id, external_order_number, order_created_at, processed_at, currency, financial_status, fulfillment_status, cancelled_at, is_cancelled, status, subtotal_price, total_discounts, total_shipping, total_tax, total_price, customer_email, shipping_state_code, shipping_pincode",
      )
      .eq("company_id", companyId)
      .order("order_created_at", { ascending: false });

    if (dateFrom) {
      query = query.gte("order_created_at", startOfDayIso(dateFrom));
    }
    if (dateTo) {
      query = query.lte("order_created_at", endOfDayIso(dateTo));
    }
    if (statusFilter) {
      if (statusFilter === "cancelled") {
        query = query.eq("is_cancelled", true);
      } else {
        query = query.eq("status", statusFilter);
      }
    }
    if (debouncedSearch.trim()) {
      const escaped = debouncedSearch.trim();
      query = query.or(
        `external_order_number.ilike.%${escaped}%,customer_email.ilike.%${escaped}%,raw_order->>phone.ilike.%${escaped}%`,
      );
    }

    const { data, error: loadError } = await query.range(offset, offset + PAGE_SIZE);
    if (!isActive) return;

    if (loadError) {
      setError(loadError.message);
      setOrders([]);
      setHasNextPage(false);
      setFetching(false);
      return;
    }

    const rows = (data || []) as OmsOrderRow[];
    const hasMore = rows.length > PAGE_SIZE;
    setOrders(rows.slice(0, PAGE_SIZE));
    setHasNextPage(hasMore);
    setFetching(false);
  }

  if (loading) {
    return (
      <ErpShell activeModule="oms">
        <div style={pageContainerStyle}>Loading OMS orders…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="oms">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS</p>
            <h1 style={h1Style}>Orders</h1>
            <p style={subtitleStyle}>Review recent marketplace orders and drill into inventory actions.</p>
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
              <span style={filterCaptionStyle}>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
                {statusOptions.map((option) => (
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
                <th style={tableHeaderCellStyle}>Source</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Financial</th>
                <th style={tableHeaderCellStyle}>Fulfillment</th>
                <th style={tableHeaderCellStyle}>Total</th>
                <th style={tableHeaderCellStyle}>Customer</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} style={tableCellStyle}>
                    No OMS orders found for this range.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    style={rowStyle}
                    onClick={() => router.push(`/erp/oms/orders/${order.id}`)}
                  >
                    <td style={tableCellStyle}>
                      <Link href={`/erp/oms/orders/${order.id}`} style={linkStyle}>
                        {order.external_order_number || order.external_order_id}
                      </Link>
                    </td>
                    <td style={tableCellStyle}>{order.source}</td>
                    <td style={tableCellStyle}>{new Date(order.order_created_at).toLocaleString()}</td>
                    <td style={tableCellStyle}>{order.is_cancelled ? "Cancelled" : order.status}</td>
                    <td style={tableCellStyle}>{order.financial_status || "—"}</td>
                    <td style={tableCellStyle}>{order.fulfillment_status || "—"}</td>
                    <td style={tableCellStyle}>
                      {order.total_price == null ? "—" : `${order.currency} ${Number(order.total_price).toFixed(2)}`}
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
