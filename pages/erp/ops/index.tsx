import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../components/erp/ErpShell";
import ErpPageHeader from "../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "../../../components/erp/uiStyles";
import ErrorBanner from "../../../components/erp/ErrorBanner";
import { humanizeApiError } from "../../../lib/erp/errors";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { supabase } from "../../../lib/supabaseClient";

type DashboardCounts = {
  approvals_submitted: number;
  ap_bills_draft: number;
  vendor_payments_pending: number;
  bank_txns_unreconciled: number;
  razorpay_settlements_unposted: number;
  inventory_negative: number;
  inventory_low_stock: number;
  payroll_runs_open: number;
};

const defaultCounts: DashboardCounts = {
  approvals_submitted: 0,
  ap_bills_draft: 0,
  vendor_payments_pending: 0,
  bank_txns_unreconciled: 0,
  razorpay_settlements_unposted: 0,
  inventory_negative: 0,
  inventory_low_stock: 0,
  payroll_runs_open: 0,
};

const checklistItems = [
  "Import bank statement",
  "Reconcile bank txns",
  "Post settlements",
  "Post vendor bills",
  "Approve payments",
  "Review low stock/negative stock",
];

const checklistKey = "erp_ops_checklist_v1";

export default function OpsDashboardPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<DashboardCounts>(defaultCounts);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const saved = localStorage.getItem(checklistKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        setChecklist(parsed);
      } catch {
        setChecklist({});
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(checklistKey, JSON.stringify(checklist));
  }, [checklist]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;
      setCtx(context);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadCounts = async () => {
    setError(null);
    setErrorDetails(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      setError("Please log in again.");
      return;
    }

    try {
      const response = await fetch("/api/ops/dashboard-counts", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || "Failed to load dashboard counts.");
      }
      setCounts((result as DashboardCounts) || defaultCounts);
    } catch (err) {
      setError(humanizeApiError(err) || "Failed to load dashboard counts.");
      setErrorDetails(err instanceof Error ? err.message : null);
    }
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadCounts();
  }, [ctx?.companyId]);

  const tiles = useMemo(
    () => [
      {
        title: "Approvals pending",
        count: counts.approvals_submitted,
        href: "/erp/finance/control/approvals",
      },
      {
        title: "Vendor bills draft",
        count: counts.ap_bills_draft,
        href: "/erp/finance/ap/vendor-bills",
      },
      {
        title: "Vendor payments pending",
        count: counts.vendor_payments_pending,
        href: "/erp/finance/vendor-payments",
      },
      {
        title: "Unreconciled bank txns",
        count: counts.bank_txns_unreconciled,
        href: "/erp/finance/recon",
      },
      {
        title: "Unposted Razorpay settlements",
        count: counts.razorpay_settlements_unposted,
        href: "/erp/finance/razorpay/settlements",
      },
      {
        title: "Inventory alerts",
        count: counts.inventory_negative + counts.inventory_low_stock,
        href: "/erp/inventory/dashboard",
      },
      {
        title: "Payroll runs open",
        count: counts.payroll_runs_open,
        href: "/erp/payroll/runs",
      },
    ],
    [counts]
  );

  if (loading) {
    return (
      <ErpShell activeModule="ops">
        <div style={pageContainerStyle}>Loading ops cockpit…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="ops">
        <div style={pageContainerStyle}>
          <ErpPageHeader eyebrow="Ops" title="Ops Dashboard" description="Daily operations cockpit." />
          <p style={{ color: "#b91c1c" }}>Unable to load company context.</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="ops">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Ops"
          title="Ops Dashboard"
          description="Daily operations cockpit for approvals, cash, and inventory."
          rightActions={
            <button type="button" style={secondaryButtonStyle} onClick={loadCounts}>
              Refresh Counts
            </button>
          }
        />

        {error ? (
          <ErrorBanner message={error} details={errorDetails} onRetry={loadCounts} />
        ) : null}

        <section style={tileGridStyle}>
          {tiles.map((tile) => (
            <Link key={tile.title} href={tile.href} style={{ ...cardStyle, ...tileStyle }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{tile.title}</div>
                <span style={badgeStyle}>{tile.count}</span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 13 }}>Open →</div>
            </Link>
          ))}
        </section>

        <section style={sectionGridStyle}>
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Quick Links</h2>
            <div style={linkGridStyle}>
              {[
                { label: "AP Vendor Bills", href: "/erp/finance/ap/vendor-bills" },
                { label: "Vendor Payments", href: "/erp/finance/vendor-payments" },
                { label: "Vendor Advances", href: "/erp/finance/ap/vendor-advances" },
                { label: "AP Outstanding", href: "/erp/finance/ap/outstanding" },
                { label: "Bank Import", href: "/erp/finance/bank/import" },
                { label: "Bank Recon", href: "/erp/finance/recon" },
                { label: "Razorpay Settlements", href: "/erp/finance/razorpay/settlements" },
                { label: "Trial Balance", href: "/erp/finance/reports/trial-balance" },
                { label: "Profit & Loss", href: "/erp/finance/reports/pnl" },
                { label: "Balance Sheet", href: "/erp/finance/reports/balance-sheet" },
                { label: "Cashflow", href: "/erp/finance/reports/cash-flow" },
                { label: "GRNs", href: "/erp/inventory/grns" },
                { label: "Stock", href: "/erp/inventory/stock" },
                { label: "Transfers", href: "/erp/inventory/transfers" },
                { label: "Stocktake", href: "/erp/inventory/stocktakes" },
                { label: "Writeoff", href: "/erp/inventory/writeoffs" },
                { label: "Health / Low Stock", href: "/erp/inventory/reorder" },
                { label: "Payroll Runs", href: "/erp/hr/payroll/runs" },
                { label: "Payslips", href: "/erp/hr/payroll/payslips" },
              ].map((link) => (
                <Link key={link.href} href={link.href} style={quickLinkStyle}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Today&apos;s Checklist</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {checklistItems.map((item) => (
                <label key={item} style={checklistRowStyle}>
                  <input
                    type="checkbox"
                    checked={Boolean(checklist[item])}
                    onChange={(event) =>
                      setChecklist((prev) => ({ ...prev, [item]: event.target.checked }))
                    }
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => setChecklist({})}
              >
                Reset checklist
              </button>
            </div>
          </div>
        </section>
      </div>
    </ErpShell>
  );
}

const tileGridStyle = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const tileStyle = {
  textDecoration: "none",
  color: "#111827",
  display: "grid",
  gap: 8,
  minHeight: 84,
};

const sectionGridStyle = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
};

const linkGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

const quickLinkStyle = {
  textDecoration: "none",
  color: "#1d4ed8",
  fontWeight: 600,
  fontSize: 13,
  padding: "6px 8px",
  borderRadius: 8,
  backgroundColor: "#eff6ff",
};

const checklistRowStyle = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  fontSize: 14,
  fontWeight: 500,
};
