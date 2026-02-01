import { Fragment, type CSSProperties, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { apiFetch } from "../../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const todayDate = () => formatDateInput(new Date());

const formatAmount = (value: number | string | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

type BalanceSheetRow = {
  statement_group: string;
  statement_subgroup: string | null;
  amount: number;
};

type DrilldownRow = {
  posting_date: string;
  journal_id: string;
  journal_number: string | null;
  description: string | null;
  account_id: string;
  debit: number;
  credit: number;
};

type DefaultPeriod = {
  from_date: string;
  to_date: string;
  fiscal_year: string;
  period_month: number;
};

type PeriodStatus = {
  is_locked: boolean;
  fiscal_year: string;
  period_month: number;
};

type RoleMapping = {
  role: string;
  statement_section: string;
  statement_group: string;
  statement_subgroup: string | null;
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
};

export default function BalanceSheetPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOfDate, setAsOfDate] = useState(todayDate());
  const [rows, setRows] = useState<BalanceSheetRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [defaultPeriod, setDefaultPeriod] = useState<DefaultPeriod | null>(null);
  const [periodStatus, setPeriodStatus] = useState<PeriodStatus | null>(null);
  const [roleMappings, setRoleMappings] = useState<RoleMapping[]>([]);

  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownRows, setDrilldownRows] = useState<DrilldownRow[]>([]);
  const [drilldownTitle, setDrilldownTitle] = useState<string>("");
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

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

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadDefaultPeriod = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    const response = await apiFetch(`/api/finance/reports/default-period?company_id=${ctx.companyId}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.error || "Failed to load default period.");
      return;
    }
    const period = payload?.data as DefaultPeriod;
    if (period?.to_date) {
      setDefaultPeriod(period);
      setAsOfDate(period.to_date);
    }
  };

  const loadRoleMappings = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    const response = await apiFetch(`/api/finance/reports/role-taxonomy?company_id=${ctx.companyId}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.error || "Failed to load role taxonomy.");
      return;
    }
    setRoleMappings((payload?.data || []) as RoleMapping[]);
  };

  const loadPeriodStatus = async (date: string) => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    const response = await apiFetch(
      `/api/finance/reports/period-status?company_id=${ctx.companyId}&date=${date}`,
      {
        headers: getAuthHeaders(),
      }
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.error || "Failed to load period status.");
      return;
    }
    setPeriodStatus(payload?.data as PeriodStatus);
  };

  useEffect(() => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    loadDefaultPeriod();
    loadRoleMappings();
  }, [ctx?.companyId, ctx?.session?.access_token]);

  useEffect(() => {
    if (!asOfDate) return;
    loadPeriodStatus(asOfDate);
  }, [asOfDate]);

  const loadBalanceSheet = async () => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    setIsLoadingData(true);
    setError(null);

    const params = new URLSearchParams();
    params.set("company_id", ctx.companyId);
    if (asOfDate) params.set("as_of", asOfDate);

    const response = await apiFetch(`/api/finance/reports/balance-sheet?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload?.error || "Failed to load balance sheet.");
      setIsLoadingData(false);
      return;
    }

    setRows((payload?.data || []) as BalanceSheetRow[]);
    setIsLoadingData(false);
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    await loadBalanceSheet();
  };

  const handleUseDefault = () => {
    if (!defaultPeriod?.to_date) return;
    setAsOfDate(defaultPeriod.to_date);
  };

  const groupedRows = useMemo(() => {
    const groups = new Map<string, BalanceSheetRow[]>();
    rows.forEach((row) => {
      const key = row.statement_group || "unclassified";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(row);
    });
    return groups;
  }, [rows]);

  const groupTotals = useMemo(() => {
    const totals = new Map<string, number>();
    groupedRows.forEach((groupRows, key) => {
      totals.set(
        key,
        groupRows.reduce((acc, row) => acc + Number(row.amount || 0), 0)
      );
    });
    return totals;
  }, [groupedRows]);

  const unmappedRoles = useMemo(() => {
    return roleMappings.filter((role) => role.statement_section === "bs" && !role.account_id);
  }, [roleMappings]);

  const handleOpenDrilldown = async (group: string, subgroup: string | null) => {
    if (!ctx?.companyId || !ctx?.session?.access_token) return;
    setDrilldownTitle(`${group}${subgroup ? ` · ${subgroup}` : ""}`);
    setDrilldownOpen(true);
    setDrilldownLoading(true);
    setDrilldownError(null);

    const params = new URLSearchParams();
    params.set("company_id", ctx.companyId);
    params.set("as_of", asOfDate);
    params.set("statement_group", group);
    if (subgroup) params.set("statement_subgroup", subgroup);

    const response = await apiFetch(`/api/finance/reports/balance-sheet-drilldown?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();

    if (!response.ok) {
      setDrilldownError(payload?.error || "Failed to load drilldown.");
      setDrilldownLoading(false);
      return;
    }

    setDrilldownRows((payload?.data || []) as DrilldownRow[]);
    setDrilldownLoading(false);
  };

  const closeDrilldown = () => {
    setDrilldownOpen(false);
    setDrilldownRows([]);
    setDrilldownError(null);
  };

  const periodBadge = periodStatus?.is_locked ? "Locked Period" : "Provisional";

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Balance Sheet"
          description="Snapshot of assets, liabilities, and equity as of the selected date."
          rightActions={
            <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Back to Finance
            </Link>
          }
        />

        {error ? <div style={{ ...cardStyle, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div> : null}

        <form
          onSubmit={handleSubmit}
          style={{
            ...cardStyle,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          <label style={filterLabelStyle}>
            As of
            <input
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
              style={inputStyle}
            />
          </label>
          <button type="button" style={secondaryButtonStyle} onClick={handleUseDefault}>
            Use locked period end
          </button>
          <button type="submit" style={{ ...primaryButtonStyle, minWidth: 160 }} disabled={isLoadingData || loading}>
            {isLoadingData ? "Loading…" : "Apply Filters"}
          </button>
          {defaultPeriod ? (
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#4b5563" }}>
              Default FY {defaultPeriod.fiscal_year} · Period {defaultPeriod.period_month} · {periodBadge}
            </div>
          ) : null}
        </form>

        {unmappedRoles.length > 0 ? (
          <div style={{ ...cardStyle, borderColor: "#fde68a", color: "#92400e" }}>
            <strong>Unmapped roles</strong>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              Map these balance sheet roles in Finance → Settings → COA Roles to include them in statements:
            </div>
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {unmappedRoles.map((role) => (
                <li key={role.role}>
                  {role.role} ({role.statement_group}{role.statement_subgroup ? ` · ${role.statement_subgroup}` : ""})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ ...cardStyle, padding: 0 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Group</th>
                <th style={tableHeaderCellStyle}>Subgroup</th>
                <th style={tableHeaderCellStyle}>Amount</th>
                <th style={tableHeaderCellStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(groupedRows.entries()).map(([group, groupRows]) => (
                <Fragment key={group}>
                  <tr style={{ background: "#f9fafb" }}>
                    <td style={{ ...tableCellStyle, fontWeight: 700 }}>{group}</td>
                    <td style={tableCellStyle}>—</td>
                    <td style={{ ...tableCellStyle, fontWeight: 700 }}>{formatAmount(groupTotals.get(group) || 0)}</td>
                    <td style={tableCellStyle}></td>
                  </tr>
                  {groupRows.map((row) => (
                    <tr key={`${row.statement_group}-${row.statement_subgroup}`}>
                      <td style={tableCellStyle}>{row.statement_group}</td>
                      <td style={tableCellStyle}>{row.statement_subgroup || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.amount)}</td>
                      <td style={tableCellStyle}>
                        <button
                          type="button"
                          style={linkButtonStyle}
                          onClick={() => handleOpenDrilldown(row.statement_group, row.statement_subgroup)}
                        >
                          View lines
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={4}>
                    {isLoadingData ? "Loading balance sheet…" : "No entries as of this date."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {drilldownOpen ? (
        <div style={modalBackdropStyle} role="dialog" aria-modal="true">
          <div style={modalCardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700 }}>Drilldown · {drilldownTitle}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>As of {asOfDate}</div>
              </div>
              <button type="button" style={secondaryButtonStyle} onClick={closeDrilldown}>
                Close
              </button>
            </div>
            {drilldownError ? <div style={{ color: "#b91c1c" }}>{drilldownError}</div> : null}
            <div style={{ marginTop: 16, maxHeight: 360, overflow: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Date</th>
                    <th style={tableHeaderCellStyle}>Journal</th>
                    <th style={tableHeaderCellStyle}>Description</th>
                    <th style={tableHeaderCellStyle}>Debit</th>
                    <th style={tableHeaderCellStyle}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldownRows.map((row) => (
                    <tr key={`${row.journal_id}-${row.account_id}-${row.posting_date}`}>
                      <td style={tableCellStyle}>{formatDate(row.posting_date)}</td>
                      <td style={tableCellStyle}>
                        <Link
                          href={`/erp/finance/journals/${row.journal_id}`}
                          style={{ color: "#2563eb", textDecoration: "none" }}
                        >
                          {row.journal_number || row.journal_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td style={tableCellStyle}>{row.description || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.debit)}</td>
                      <td style={tableCellStyle}>{formatAmount(row.credit)}</td>
                    </tr>
                  ))}
                  {drilldownRows.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={5}>
                        {drilldownLoading ? "Loading drilldown…" : "No journal lines for this selection."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </ErpShell>
  );
}

const filterLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "#374151",
};

const linkButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "#2563eb",
  cursor: "pointer",
  padding: 0,
  fontSize: 13,
};

const modalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 50,
  padding: 16,
};

const modalCardStyle: CSSProperties = {
  width: "min(900px, 100%)",
  background: "#fff",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
};
