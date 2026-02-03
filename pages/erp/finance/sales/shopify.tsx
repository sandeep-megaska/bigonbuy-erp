import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import {
  shopifySalesPostingListSchema,
  shopifySalesPostingSummarySchema,
  type ShopifySalesPostingRow,
  type ShopifySalesPostingSummary,
} from "../../../../lib/erp/shopifySales";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
  session?: { access_token?: string | null } | null;
};

const formatLocalDate = (date: Date) => date.toLocaleDateString("en-CA");

const today = () => formatLocalDate(new Date());

const startOfPreviousMonth = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return formatLocalDate(first);
};

const parseDateQuery = (value: string | string[] | undefined) => {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
};

const loadStoredRange = (companyId: string) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`erp_shopify_sales_date_range_${companyId}`);
    if (!raw) return null;
    const parsed = z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const persistStoredRange = (companyId: string, from: string, to: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`erp_shopify_sales_date_range_${companyId}`, JSON.stringify({ from, to }));
  } catch {
    return;
  }
};

export default function ShopifySalesPostingPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState(startOfPreviousMonth());
  const [toDate, setToDate] = useState(today());
  const [search, setSearch] = useState("");
  const [postingFilter, setPostingFilter] = useState<"all" | "posted" | "missing" | "excluded">("all");

  const [orders, setOrders] = useState<ShopifySalesPostingRow[]>([]);
  const [postingSummary, setPostingSummary] = useState<ShopifySalesPostingSummary | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [postingSummaryError, setPostingSummaryError] = useState<string | null>(null);
  const [postingOrderId, setPostingOrderId] = useState<string | null>(null);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

  const getAuthHeaders = (tokenOverride?: string | null): HeadersInit => {
    const token = tokenOverride ?? ctx?.session?.access_token;
    return {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
    };
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!router.isReady) return;
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

      const storedRange = loadStoredRange(context.companyId);
      const initialFrom = parseDateQuery(router.query.from) ?? storedRange?.from ?? startOfPreviousMonth();
      const initialTo = parseDateQuery(router.query.to) ?? storedRange?.to ?? today();
      setFromDate(initialFrom);
      setToDate(initialTo);
      await loadOrders({ fromDate: initialFrom, toDate: initialTo, token: session.access_token });
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const loadPostingSummary = async (params: { fromDate: string; toDate: string; token?: string | null }) => {
    setIsLoadingSummary(true);
    setPostingSummaryError(null);

    try {
      const response = await fetch(
        `/api/erp/finance/sales/shopify/summary?from=${params.fromDate}&to=${params.toDate}`,
        { headers: getAuthHeaders(params.token) }
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setPostingSummaryError(payload?.error || "Failed to load posting summary.");
        setPostingSummary(null);
        setIsLoadingSummary(false);
        return;
      }

      const summaryPayload = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      const parsed = shopifySalesPostingSummarySchema.safeParse(summaryPayload);
      if (!parsed.success) {
        setPostingSummaryError("Failed to parse posting summary.");
        setPostingSummary(null);
        setIsLoadingSummary(false);
        return;
      }

      setPostingSummary(parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load posting summary.";
      setPostingSummaryError(message);
      setPostingSummary(null);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const loadOrders = async (overrides?: {
    fromDate?: string;
    toDate?: string;
    search?: string;
    postingFilter?: "all" | "posted" | "missing" | "excluded";
    token?: string | null;
  }) => {
    setIsLoadingList(true);
    setError(null);

    const effectiveFrom = overrides?.fromDate ?? fromDate;
    const effectiveTo = overrides?.toDate ?? toDate;
    const effectiveSearch = overrides?.search ?? search;
    const effectivePostingFilter = overrides?.postingFilter ?? postingFilter;

    try {
      const response = await fetch(
        `/api/erp/finance/sales/shopify/list?from=${effectiveFrom}&to=${effectiveTo}&posting=${effectivePostingFilter}&search=${encodeURIComponent(
          effectiveSearch
        )}`,
        { headers: getAuthHeaders(overrides?.token) }
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to load Shopify orders.");
        setOrders([]);
        setIsLoadingList(false);
        return;
      }

      if (ctx?.companyId) {
        persistStoredRange(ctx.companyId, effectiveFrom, effectiveTo);
      }

      await loadPostingSummary({ fromDate: effectiveFrom, toDate: effectiveTo, token: overrides?.token });

      const parsed = shopifySalesPostingListSchema.safeParse(payload.data);
      if (!parsed.success) {
        const sampleRow = Array.isArray(payload.data) ? payload.data[0] : payload.data;
        const sampleKeys =
          sampleRow && typeof sampleRow === "object" && !Array.isArray(sampleRow)
            ? Object.keys(sampleRow as Record<string, unknown>)
            : [];
        console.error("Failed to parse Shopify sales posting list.", {
          error: parsed.error,
          sampleKeys,
          sampleRow,
        });
        setError("Failed to parse Shopify sales posting list (see console).");
        setOrders([]);
        setIsLoadingList(false);
        return;
      }

      setOrders(parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load Shopify orders.";
      setError(message);
      setOrders([]);
    } finally {
      setIsLoadingList(false);
    }
  };

  const handlePost = async (orderId: string) => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can post Shopify orders.");
      return;
    }

    const confirmMessage = "Post this Shopify order to finance?";
    if (!window.confirm(confirmMessage)) return;

    setPostingOrderId(orderId);
    setError(null);

    try {
      const response = await fetch(`/api/erp/finance/sales/shopify/${orderId}/post`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ orderId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to post Shopify order.");
        setPostingOrderId(null);
        return;
      }

      await loadOrders();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post Shopify order.";
      setError(message);
    } finally {
      setPostingOrderId(null);
    }
  };

  const totalAmount = useMemo(
    () => orders.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [orders]
  );

  if (loading) {
    return <div style={pageContainerStyle}>Loading Shopify sales posting…</div>;
  }

  if (error && orders.length === 0) {
    return <div style={pageContainerStyle}>{error}</div>;
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Shopify Sales Posting"
          description="Monitor Shopify orders and post missing journals."
        />

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280" }}>From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#6b7280" }}>To</label>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ minWidth: 220 }}>
              <label style={{ fontSize: 12, color: "#6b7280" }}>Search</label>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Order no, customer, email"
                style={{ ...inputStyle, width: "100%" }}
              />
            </div>
            <button type="button" style={primaryButtonStyle} onClick={() => loadOrders()}>
              Apply filters
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => {
                setSearch("");
                setPostingFilter("all");
                void loadOrders({ search: "", postingFilter: "all" });
              }}
            >
              Reset
            </button>
          </div>
        </section>

        <section style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {["all", "posted", "missing", "excluded"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setPostingFilter(option as "all" | "posted" | "missing" | "excluded");
                void loadOrders({ postingFilter: option as "all" | "posted" | "missing" | "excluded" });
              }}
              style={{
                ...secondaryButtonStyle,
                ...(postingFilter === option ? { borderColor: "#111827", color: "#111827" } : null),
              }}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>Posting coverage</div>
            {isLoadingSummary ? <div style={{ fontSize: 12 }}>Loading…</div> : null}
          </div>
          {postingSummaryError ? (
            <div style={{ marginTop: 8, color: "#b91c1c" }}>{postingSummaryError}</div>
          ) : postingSummary ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Total orders</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.total_count}</div>
                <div style={{ fontSize: 12 }}>₹{postingSummary.total_amount.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Posted</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.posted_count}</div>
                <div style={{ fontSize: 12 }}>₹{postingSummary.posted_amount.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Missing</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.missing_count}</div>
                <div style={{ fontSize: 12 }}>₹{postingSummary.missing_amount.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Excluded</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{postingSummary.excluded_count}</div>
                <div style={{ fontSize: 12 }}>₹{postingSummary.excluded_amount.toFixed(2)}</div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>No summary available.</div>
          )}
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>
              {isLoadingList ? "Loading orders…" : "Shopify orders"} · {orders.length} records · Total ₹
              {totalAmount.toFixed(2)}
            </div>
            <Link href="/erp/finance/settings/sales-posting" style={secondaryButtonStyle}>
              Sales posting settings
            </Link>
          </div>

          {error ? <div style={{ marginTop: 8, color: "#b91c1c" }}>{error}</div> : null}

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Order</th>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Ship to</th>
                  <th style={tableHeaderCellStyle}>Net sales (est.)</th>
                  <th style={tableHeaderCellStyle}>Posting</th>
                  <th style={tableHeaderCellStyle}>Journal</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      No Shopify orders found for this filter.
                    </td>
                  </tr>
                ) : (
                  orders.map((row) => (
                    <tr key={row.order_uuid}>
                      <td style={tableCellStyle}>
                        <div style={{ fontWeight: 600 }}>{row.order_number || "—"}</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>{row.order_uuid}</div>
                      </td>
                      <td style={tableCellStyle}>{row.order_created_at}</td>
                      <td style={tableCellStyle}>
                        {[row.ship_city, row.ship_state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td style={tableCellStyle}>₹{Number(row.amount || 0).toFixed(2)}</td>
                      <td style={tableCellStyle}>
                        <span
                          style={{
                            ...badgeStyle,
                            ...(row.posting_state === "posted"
                              ? { background: "#dcfce7", color: "#166534" }
                              : row.posting_state === "missing"
                                ? { background: "#fee2e2", color: "#991b1b" }
                                : { background: "#fef3c7", color: "#92400e" }),
                          }}
                        >
                          {row.posting_state}
                        </span>
                      </td>
                      <td style={tableCellStyle}>
                        {row.journal_id ? (
                          <Link href={`/erp/finance/journals/${row.journal_id}`} style={secondaryButtonStyle}>
                            {row.journal_no || "View journal"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={tableCellStyle}>
                        {row.posting_state === "missing" ? (
                          <button
                            type="button"
                            style={primaryButtonStyle}
                            disabled={!canWrite || postingOrderId === row.order_uuid}
                            onClick={() => handlePost(row.order_uuid)}
                          >
                            {postingOrderId === row.order_uuid ? "Posting…" : "Post to Finance"}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ErpShell>
  );
}
