import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import {
  cardStyle as sharedCardStyle,
  eyebrowStyle,
  h1Style,
  h2Style,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { apiGet } from "../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";

type OpsDashboardCounts = {
  approvals_submitted?: number;
  ap_bills_draft?: number;
  bank_txns_unreconciled?: number;
  razorpay_settlements_unposted?: number;
  inventory_negative?: number;
  inventory_low_stock?: number;
  payroll_runs_open?: number;
  pendingApprovals?: number;
};

type OpsDashboardResponse =
  | { ok: true; data: OpsDashboardCounts }
  | { ok: false; error: string; details?: string | null };

const checklistStorageKey = "ops-dashboard-checklist";

const checklistItems = [
  { id: "review-approvals", label: "Review pending approvals and escalations." },
  { id: "ap-drafts", label: "Confirm AP drafts and post vendor bills." },
  { id: "bank-import", label: "Import bank statements and reconcile exceptions." },
  { id: "settlements", label: "Post Razorpay settlements and verify payout ledger." },
  { id: "inventory-health", label: "Scan negative + low stock alerts." },
  { id: "payroll", label: "Validate open payroll runs and attendance inputs." },
];

const quickLinks = [
  { label: "AP", href: "/erp/finance/ap/vendor-bills" },
  { label: "Bank import", href: "/erp/finance/bank/import" },
  { label: "Recon", href: "/erp/finance/recon" },
  { label: "Settlements", href: "/erp/finance/razorpay/settlements-ledger" },
  { label: "Trial balance", href: "/erp/finance/reports/trial-balance" },
  { label: "P&L", href: "/erp/finance/reports/pnl" },
  { label: "Inventory GRNs", href: "/erp/inventory/grns" },
  { label: "Stock", href: "/erp/inventory/stock" },
  { label: "Transfers", href: "/erp/inventory/transfers" },
  { label: "Stocktake", href: "/erp/inventory/stocktakes" },
  { label: "Writeoffs", href: "/erp/inventory/writeoffs" },
  { label: "Payroll runs", href: "/erp/hr/payroll/runs" },
];

const dashboardTiles = [
  {
    key: "approvals_submitted",
    label: "Approvals submitted",
    href: "/erp/finance/control/approvals",
  },
  {
    key: "ap_bills_draft",
    label: "AP bills in draft",
    href: "/erp/finance/ap/vendor-bills",
  },
  {
    key: "bank_txns_unreconciled",
    label: "Bank txns unreconciled",
    href: "/erp/finance/recon",
  },
  {
    key: "razorpay_settlements_unposted",
    label: "Razorpay settlements unposted",
    href: "/erp/finance/razorpay/settlements-ledger",
  },
  {
    key: "inventory_negative",
    label: "Inventory negative",
    href: "/erp/inventory/health",
  },
  {
    key: "inventory_low_stock",
    label: "Inventory low stock",
    href: "/erp/inventory/health",
  },
  {
    key: "payroll_runs_open",
    label: "Payroll runs open",
    href: "/erp/hr/payroll/runs",
  },
];

const formatCount = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  if (Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
};

export default function OpsDashboardPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<OpsDashboardCounts | null>(null);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(checklistItems.map((item) => [item.id, false]))
  );

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
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(checklistStorageKey);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      setChecklistState((prev) => ({ ...prev, ...parsed }));
    } catch (parseError) {
      console.warn("Unable to parse ops checklist from localStorage", parseError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(checklistStorageKey, JSON.stringify(checklistState));
  }, [checklistState]);

  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [ctx?.session?.access_token]);

  const loadCounts = useCallback(async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    setCountsLoading(true);
    setCountsError(null);

    try {
      const params = new URLSearchParams({ companyId: ctx.companyId });
      const payload = await apiGet<OpsDashboardResponse>(
        `/api/ops/dashboard-counts?${params.toString()}`,
        {
          headers: getAuthHeaders(),
        }
      );

      if (payload.ok === false) {
        throw new Error(payload.error || "Unable to load ops dashboard counts.");
      }

      const data = payload.data || {};
      setCounts({
        approvals_submitted: data.approvals_submitted ?? data.pendingApprovals ?? 0,
        ap_bills_draft: data.ap_bills_draft ?? 0,
        bank_txns_unreconciled: data.bank_txns_unreconciled ?? 0,
        razorpay_settlements_unposted: data.razorpay_settlements_unposted ?? 0,
        inventory_negative: data.inventory_negative ?? 0,
        inventory_low_stock: data.inventory_low_stock ?? 0,
        payroll_runs_open: data.payroll_runs_open ?? 0,
      });
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Failed to load counts.";
      setCountsError(message);
    } finally {
      setCountsLoading(false);
    }
  }, [ctx?.companyId, ctx?.session?.access_token, getAuthHeaders]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active) return;
      await loadCounts();
    })();

    return () => {
      active = false;
    };
  }, [loadCounts]);

  const tiles = useMemo(
    () =>
      dashboardTiles.map((tile) => ({
        ...tile,
        value: counts ? formatCount(counts[tile.key as keyof OpsDashboardCounts]) : "—",
      })),
    [counts]
  );

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading Ops Dashboard…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <header style={pageHeaderStyle}>
            <div>
              <p style={eyebrowStyle}>Ops</p>
              <h1 style={h1Style}>Ops Dashboard</h1>
              <p style={subtitleStyle}>Daily operational controls and checkpoints.</p>
            </div>
          </header>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Ops</p>
            <h1 style={h1Style}>Ops Dashboard</h1>
            <p style={subtitleStyle}>Daily operational controls and checkpoints.</p>
          </div>
        </header>

        {countsError ? (
          <section style={{ ...sharedCardStyle, borderColor: "#fecaca", color: "#b91c1c" }}>
            <div style={errorCardRowStyle}>
              <span>{countsError}</span>
              <button
                type="button"
                onClick={loadCounts}
                style={secondaryButtonStyle}
                disabled={countsLoading}
              >
                Retry
              </button>
            </div>
          </section>
        ) : null}

        <section style={sharedCardStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={h2Style}>Operational counts</h2>
            <p style={sectionSubtitleStyle}>
              {countsLoading ? "Refreshing counts…" : "Review operational queues that need attention."}
            </p>
          </div>
          <div style={tileGridStyle}>
            {tiles.map((tile) => (
              <Link key={tile.key} href={tile.href} style={tileCardStyle}>
                <p style={tileValueStyle}>{tile.value}</p>
                <p style={tileLabelStyle}>{tile.label}</p>
              </Link>
            ))}
          </div>
        </section>

        <section style={sharedCardStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={h2Style}>Quick links</h2>
            <p style={sectionSubtitleStyle}>Jump into daily finance, inventory, and HR tasks.</p>
          </div>
          <div style={quickLinksGridStyle}>
            {quickLinks.map((link) => (
              <Link key={link.href} href={link.href} style={quickLinkStyle}>
                {link.label}
              </Link>
            ))}
          </div>
        </section>

        <section style={sharedCardStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={h2Style}>Today’s checklist</h2>
            <p style={sectionSubtitleStyle}>Check off the items you finish today.</p>
          </div>
          <div style={checklistStyle}>
            {checklistItems.map((item) => {
              const done = Boolean(checklistState[item.id]);
              return (
                <label key={item.id} style={checklistItemStyle}>
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() =>
                      setChecklistState((prev) => ({
                        ...prev,
                        [item.id]: !prev[item.id],
                      }))
                    }
                    style={checklistCheckboxStyle}
                  />
                  <span style={done ? checklistDoneTextStyle : checklistPendingTextStyle}>
                    {item.label}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const sectionSubtitleStyle: CSSProperties = {
  margin: 0,
  color: "#6b7280",
  fontSize: 14,
};

const tileGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 16,
};

const tileCardStyle: CSSProperties = {
  ...sharedCardStyle,
  textDecoration: "none",
  color: "#111827",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minHeight: 110,
  justifyContent: "center",
};

const tileValueStyle: CSSProperties = {
  margin: 0,
  fontSize: 28,
  fontWeight: 700,
  color: "#111827",
};

const tileLabelStyle: CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontSize: 14,
  fontWeight: 600,
};

const quickLinksGridStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
};

const quickLinkStyle: CSSProperties = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const checklistStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const checklistItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 14,
  color: "#111827",
};

const checklistCheckboxStyle: CSSProperties = {
  width: 18,
  height: 18,
  accentColor: "#2563eb",
};

const checklistDoneTextStyle: CSSProperties = {
  color: "#111827",
  textDecoration: "line-through",
};

const checklistPendingTextStyle: CSSProperties = {
  color: "#111827",
};

const errorCardRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};
