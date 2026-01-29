import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";

import ErpShell from "../../../../components/erp/ErpShell";
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
} from "../../../../components/erp/uiStyles";

import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "finalized", label: "Finalized" },
];

type SettlementRow = {
  settlement_id: string;
  exit_id: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  last_working_day: string | null;
  status: string;
  updated_at: string | null;
  earnings_total: number | null;
  deductions_total: number | null;
  net_amount: number | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatCurrency(amount: number | null | undefined) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function buildMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleString("default", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

function monthToRange(value: string) {
  if (!value) return { from: null, to: null } as { from: string | null; to: string | null };
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return { from: null, to: null } as { from: string | null; to: string | null };
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function normalizeStatusLabel(status: string) {
  if (status === "submitted") return "Finalized";
  if (status === "approved") return "Approved";
  if (status === "paid") return "Paid";
  return status || "Draft";
}

const bannerStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fef3c7",
  border: "1px solid #fbbf24",
  color: "#92400e",
  fontSize: 13,
};

export default function FinalSettlementsIndexPage() {
  const router = useRouter();

  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [toast, setToast] = useState<ToastState>(null);

  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const [monthFilter, setMonthFilter] = useState<string>(monthOptions[0]?.value ?? "");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  const canManage = useMemo(() => access.isManager || isHr(ctx?.roleKey), [access.isManager, ctx?.roleKey]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);
      if (!context.companyId && active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    if (!ctx) return undefined;

    (async () => {
      setLoading(true);
      await loadSettlements();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [ctx, monthFilter, statusFilter]);

  async function loadSettlements() {
    const { from, to } = monthToRange(monthFilter);
    const { data, error } = await supabase.rpc("erp_hr_final_settlements_list", {
      p_from: from,
      p_to: to,
      p_status: statusFilter || null,
      p_query: query || null,
    });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load settlements." });
      setRows([]);
      return;
    }

    setRows((data ?? []) as SettlementRow[]);
  }

  function handleRowClick(exitId: string) {
    router.push(`/erp/hr/final-settlements/${exitId}`);
  }

  async function handleSearch() {
    setLoading(true);
    await loadSettlements();
    setLoading(false);
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <div style={pageHeaderStyle}>
          <div>
            <div style={eyebrowStyle}>HR</div>
            <div style={h1Style}>Final Settlements</div>
            <div style={subtitleStyle}>Track HR-side settlement statements for exited employees.</div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/erp/hr/exits" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Go to Exits
            </Link>
            {canManage ? (
              <Link href="/erp/hr/exits" style={{ ...primaryButtonStyle, textDecoration: "none" }}>
                Create from Exit
              </Link>
            ) : null}
          </div>
        </div>

        {toast && (
          <div style={{ ...bannerStyle, background: toast.type === "error" ? "#fef2f2" : "#ecfdf5", borderColor: toast.type === "error" ? "#fecaca" : "#a7f3d0", color: toast.type === "error" ? "#b91c1c" : "#065f46" }}>
            {toast.message}
          </div>
        )}

        <div style={{ ...cardStyle, display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "200px 160px 1fr 120px", gap: 12, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 12, marginBottom: 6, color: "#374151" }}>Month</div>
              <select
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
                style={inputStyle}
              >
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, marginBottom: 6, color: "#374151" }}>Status</div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={inputStyle}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, marginBottom: 6, color: "#374151" }}>Employee search</div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or code…"
                style={inputStyle}
              />
            </div>
            <button type="button" onClick={handleSearch} style={secondaryButtonStyle}>
              Search
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Employee Code</th>
                  <th style={tableHeaderCellStyle}>Name</th>
                  <th style={tableHeaderCellStyle}>Exit LWD</th>
                  <th style={tableHeaderCellStyle}>Net Settlement</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No settlements found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.settlement_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRowClick(row.exit_id)}
                    >
                      <td style={tableCellStyle}>{row.employee_code || "—"}</td>
                      <td style={tableCellStyle}>{row.employee_name || "—"}</td>
                      <td style={tableCellStyle}>{formatDate(row.last_working_day)}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.net_amount)}</td>
                      <td style={tableCellStyle}>
                        <span style={badgeStyle}>{normalizeStatusLabel(row.status)}</span>
                      </td>
                      <td style={tableCellStyle}>{formatDate(row.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ErpShell>
  );
}
