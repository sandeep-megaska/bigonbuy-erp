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
type ReportRun = z.infer<typeof reportRunSchema>;

type SyncResponse =
  | {
      ok: true;
      run_id: string;
      report_id: string;
      row_count: number;
      orders_upserted: number;
      items_upserted: number;
    }
  | { ok: false; error: string };

const orderRowSchema = z.object({
  order_id: z.string(),
  status: z.string().nullable(),
  purchase_date: z.string().nullable(),
  buyer_email: z.string().nullable(),
  order_total: z.number().nullable(),
  items: z.number().nullable(),
  ship_state: z.string().nullable(),
  ship_city: z.string().nullable(),
});

const reportRunSchema = z.object({
  id: z.string(),
  status: z.string(),
  requested_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  row_count: z.number().nullable(),
  report_type: z.string().nullable(),
  report_id: z.string().nullable(),
  report_document_id: z.string().nullable(),
  error: z.string().nullable(),
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

function formatDateInput(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export default function AmazonOrdersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [reportRuns, setReportRuns] = useState<ReportRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [query, setQuery] = useState("");

  const canSync = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "inventory", "finance"].includes(ctx.roleKey)),
    [ctx]
  );
  const latestRun = useMemo(() => reportRuns[0] ?? null, [reportRuns]);

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
      p_from: fromDate || null,
      p_to: toDate || null,
      p_status: statusFilter || null,
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

  const loadReportRuns = useCallback(async () => {
    if (!ctx?.companyId) return;
    setIsLoadingRuns(true);

    const { data, error: runsError } = await supabase.rpc("erp_channel_report_runs_list", {
      p_channel_key: "amazon",
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_limit: 5,
      p_offset: 0,
    });

    if (runsError) {
      setError(runsError.message);
      setIsLoadingRuns(false);
      return;
    }

    const parsed = z.array(reportRunSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse report runs response.");
      setIsLoadingRuns(false);
      return;
    }

    setReportRuns(parsed.data);
    setIsLoadingRuns(false);
  }, [ctx?.companyId]);

  const handleSync = async () => {
    setNotice(null);
    setError(null);
    setIsSyncing(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        return;
      }
      const response = await fetch("/api/integrations/amazon/orders/reports-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          marketplaceId: DEFAULT_MARKETPLACE_ID,
          from: fromDate || null,
          to: toDate || null,
        }),
      });

      const payload = (await response.json()) as SyncResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? "Sync failed." : payload.error);
      } else {
        setNotice(
          `Report synced (run ${payload.run_id}). Orders: ${payload.orders_upserted}, items: ${payload.items_upserted}, rows: ${payload.row_count}.`
        );
        await Promise.all([fetchOrders(), loadReportRuns()]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed.";
      setError(message);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (fromDate || toDate) return;
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setFromDate(formatDateInput(start));
    setToDate(formatDateInput(now));
  }, [fromDate, toDate]);

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
    loadReportRuns();
  }, [ctx?.companyId, fetchOrders, loadReportRuns]);

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
              Pull orders via Amazon Reports API and review operational details.
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
              {isSyncing ? "Syncing…" : "Sync (Reports)"}
            </button>
          </div>
        </header>

        {notice ? <p style={noticeStyle}>{notice}</p> : null}
        {error ? <p style={errorStyle}>{error}</p> : null}

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <p style={eyebrowStyle}>Last report sync</p>
          {isLoadingRuns ? (
            <p style={{ margin: 0, color: "#6b7280" }}>Loading report runs…</p>
          ) : latestRun ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              <div>
                <p style={eyebrowStyle}>Status</p>
                <span style={badgeStyle}>{latestRun.status.toUpperCase()}</span>
              </div>
              <div>
                <p style={eyebrowStyle}>Requested</p>
                <p style={{ margin: 0 }}>{formatDateTime(latestRun.requested_at)}</p>
              </div>
              <div>
                <p style={eyebrowStyle}>Completed</p>
                <p style={{ margin: 0 }}>{formatDateTime(latestRun.completed_at)}</p>
              </div>
              <div>
                <p style={eyebrowStyle}>Rows</p>
                <p style={{ margin: 0 }}>{latestRun.row_count ?? "—"}</p>
              </div>
              <div>
                <p style={eyebrowStyle}>Report ID</p>
                <p style={{ margin: 0 }}>{latestRun.report_id ?? "—"}</p>
              </div>
              {latestRun.error ? (
                <div>
                  <p style={eyebrowStyle}>Error</p>
                  <p style={{ margin: 0, color: "#b91c1c" }}>{latestRun.error}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>No report runs yet. Use “Sync (Reports)” to pull data.</p>
          )}
        </section>

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
                <th style={tableHeaderCellStyle}>Buyer</th>
                <th style={tableHeaderCellStyle}>Total</th>
                <th style={tableHeaderCellStyle}>Items</th>
                <th style={tableHeaderCellStyle}>Ship to</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={7}>
                    {isFetching ? "Loading orders…" : "No Amazon orders found."}
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.order_id}>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <Link href={`/erp/oms/amazon/orders/${order.order_id}`}>
                          {order.order_id}
                        </Link>
                      </div>
                    </td>
                    <td style={tableCellStyle}>{order.status ?? "—"}</td>
                    <td style={tableCellStyle}>{formatDateTime(order.purchase_date)}</td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span>{order.buyer_email ?? "—"}</span>
                      </div>
                    </td>
                    <td style={tableCellStyle}>{formatCurrency(order.order_total, "INR")}</td>
                    <td style={tableCellStyle}>{order.items ?? "—"}</td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span>
                          {[order.ship_city, order.ship_state].filter(Boolean).join(", ") || "—"}
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
