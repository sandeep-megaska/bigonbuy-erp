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
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "finalized", label: "Finalized" },
];

type SettlementRow = {
  id: string;
  exit_id: string;
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  last_working_day: string | null;
  status: string;
  net_amount: number | string | null;
  updated_at: string | null;
  created_at: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatCurrency(amount: number | string | null | undefined) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMonthLabel(value: string) {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return value;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleString("default", { month: "short", year: "numeric" });
}

function getRowMonthValue(row: SettlementRow) {
  const dateValue = row.last_working_day ?? row.created_at;
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeStatusLabel(status: string) {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "approved":
      return "Approved";
    case "paid":
      return "Paid";
    case "finalized":
      return "Finalized";
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Draft";
  }
}

const bannerStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fef3c7",
  border: "1px solid #fbbf24",
  color: "#92400e",
  fontSize: 13,
};

const netAmountCellStyle: CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
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

  const [monthOptions, setMonthOptions] = useState<{ value: string; label: string }[]>([
    { value: "", label: "All months" },
  ]);
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [appliedQuery, setAppliedQuery] = useState<string>("");

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

  async function loadSettlements(nextValues?: { month?: string; status?: string; query?: string }) {
    const monthValue = nextValues?.month ?? monthFilter;
    const statusValue = nextValues?.status ?? statusFilter;
    const queryValue = nextValues?.query ?? appliedQuery;
    const { data, error } = await supabase.rpc("erp_hr_final_settlements_list", {
      p_month: monthValue || null,
      p_status: statusValue || null,
      p_query: queryValue || null,
    });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load settlements." });
      setRows([]);
      return;
    }

    const nextRows = (data ?? []) as SettlementRow[];
    setRows(nextRows);
    if (!monthValue) {
      const monthValues = nextRows
        .map((row) => getRowMonthValue(row))
        .filter((value): value is string => Boolean(value));
      const uniqueMonths = Array.from(new Set(monthValues)).sort((a, b) => b.localeCompare(a));
      const nextOptions = [{ value: "", label: "All months" }].concat(
        uniqueMonths.map((value) => ({ value, label: formatMonthLabel(value) }))
      );
      setMonthOptions(nextOptions);
    }
  }

  function handleRowClick(settlementId: string) {
    router.push(`/erp/hr/final-settlements/${settlementId}`);
  }

  async function handleSearch() {
    setAppliedQuery(query);
    setLoading(true);
    await loadSettlements({ query });
    setLoading(false);
  }

  async function handleClearFilters() {
    setMonthFilter("");
    setStatusFilter("");
    setQuery("");
    setAppliedQuery("");
    setLoading(true);
    await loadSettlements({ month: "", status: "", query: "" });
    setLoading(false);
  }

  const filtersActive = Boolean(monthFilter || statusFilter || appliedQuery);

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
          <div style={{ display: "grid", gridTemplateColumns: "200px 160px 1fr 120px 140px", gap: 12, alignItems: "end" }}>
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
            <button type="button" onClick={handleClearFilters} style={secondaryButtonStyle}>
              Clear filters
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Employee Code</th>
                  <th style={tableHeaderCellStyle}>Name</th>
                  <th style={tableHeaderCellStyle}>Exit LWD</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={{ ...tableHeaderCellStyle, ...netAmountCellStyle }}>Net Amount</th>
                  <th style={tableHeaderCellStyle}>Updated</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 600 }}>
                          {filtersActive
                            ? "No settlements match the current filters."
                            : "No final settlements yet."}
                        </div>
                        <div style={{ color: "#6b7280", fontSize: 13 }}>
                          {filtersActive
                            ? "Try clearing filters or adjusting your search."
                            : "Create a final settlement from an approved employee exit."}
                        </div>
                        {!filtersActive ? (
                          <div>
                            <Link href="/erp/hr/exits" style={{ color: "#2563eb", textDecoration: "none" }}>
                              Go to Exits
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRowClick(row.id)}
                    >
                      <td style={tableCellStyle}>{row.employee_code || "—"}</td>
                      <td style={tableCellStyle}>{row.employee_name || "—"}</td>
                      <td style={tableCellStyle}>{formatDate(row.last_working_day)}</td>
                      <td style={tableCellStyle}>
                        <span style={badgeStyle}>{normalizeStatusLabel(row.status)}</span>
                      </td>
                      <td style={{ ...tableCellStyle, ...netAmountCellStyle }}>
                        {formatCurrency(row.net_amount)}
                      </td>
                      <td style={tableCellStyle}>{formatDate(row.updated_at)}</td>
                      <td style={tableCellStyle}>
                        <button
                          type="button"
                          style={{ ...secondaryButtonStyle, padding: "6px 10px", fontSize: 12 }}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRowClick(row.id);
                          }}
                        >
                          Open
                        </button>
                      </td>
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
