import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { apiGet, apiPost } from "../../../../lib/erp/apiFetch";
import { isMakerCheckerBypassAllowed } from "../../../../lib/erp/featureFlags";
import { supabase } from "../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  session: unknown;
  email: string | null;
  userId: string | null;
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type CloseRecord = {
  id: string;
  status: string;
  closed_at: string | null;
  closed_by: string | null;
  notes: string | null;
};

type CheckResult = {
  ok: boolean;
  details?: unknown;
};

type MonthCloseChecks = {
  bank_reco_done?: CheckResult;
  gst_sales_posted?: CheckResult;
  gst_purchase_posted?: CheckResult;
  inventory_closed?: CheckResult;
  ap_reviewed?: CheckResult;
  payroll_posted?: CheckResult;
  all_ok?: boolean;
};

type ApprovalRecord = {
  id: string;
  state: string;
  requested_by: string | null;
  requested_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
};

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
  display: "grid",
  gap: 8,
};

const inputStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const monthLabels = [
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
];

const getFiscalYearLabel = (date = new Date()) => {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const startYear = month < 4 ? year - 1 : year;
  const endYear = startYear + 1;
  const toFY = (value: number) => String(value % 100).padStart(2, "0");
  return `FY${toFY(startYear)}-${toFY(endYear)}`;
};

const getFiscalPeriodMonth = (date = new Date()) => {
  const month = date.getMonth() + 1;
  return month >= 4 ? month - 3 : month + 9;
};

const getFiscalMonthLabel = (periodMonth: number) =>
  `${monthLabels[periodMonth - 1]} · Month ${periodMonth}`;

const getPeriodStartDate = (fiscalYear: string, periodMonth: number) => {
  const startYear = 2000 + Number.parseInt(fiscalYear.slice(2, 4), 10);
  const month = periodMonth <= 9 ? periodMonth + 3 : periodMonth - 9;
  const year = periodMonth <= 9 ? startYear : startYear + 1;
  return new Date(Date.UTC(year, month - 1, 1));
};

export default function MonthClosePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fiscalYear, setFiscalYear] = useState(getFiscalYearLabel());
  const [periodMonth, setPeriodMonth] = useState(getFiscalPeriodMonth());
  const [checks, setChecks] = useState<MonthCloseChecks | null>(null);
  const [closeRecord, setCloseRecord] = useState<CloseRecord | null>(null);
  const [isLocked, setIsLocked] = useState<boolean | null>(null);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [approval, setApproval] = useState<ApprovalRecord | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  const canBypass = useMemo(() => isMakerCheckerBypassAllowed(ctx?.roleKey), [ctx?.roleKey]);

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
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadCloseRecord = async (companyId: string, year: string, month: number) => {
    const { data, error: fetchError } = await supabase
      .from("erp_fin_month_close")
      .select("id, status, closed_at, closed_by, notes")
      .eq("company_id", companyId)
      .eq("fiscal_year", year)
      .eq("period_month", month)
      .maybeSingle();

    if (fetchError) throw fetchError;
    setCloseRecord((data as CloseRecord) || null);
    if (data?.id) {
      await loadApproval(companyId, data.id);
    } else {
      setApproval(null);
    }
  };

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadApproval = async (companyId: string, entityId: string) => {
    if (!ctx?.session?.access_token) return;
    setApprovalLoading(true);
    try {
      const params = new URLSearchParams({
        companyId,
        entityType: "month_close",
        entityId,
      });
      const payload = await apiGet<{ data?: ApprovalRecord | null }>(
        `/api/finance/approvals/entity?${params.toString()}`,
        { headers: getAuthHeaders() }
      );
      setApproval(payload.data ?? null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load approval status.";
      setError(message || "Unable to load approval status.");
    } finally {
      setApprovalLoading(false);
    }
  };

  const loadLockStatus = async (companyId: string, year: string, month: number) => {
    const postingDate = getPeriodStartDate(year, month);
    const { data, error: lockError } = await supabase.rpc("erp_fin_period_is_locked", {
      p_company_id: companyId,
      p_posting_date: postingDate.toISOString().slice(0, 10),
    });
    if (lockError) throw lockError;
    setIsLocked(Boolean(data));
  };

  const refreshChecks = async () => {
    if (!ctx?.companyId) return;
    setLoadingChecks(true);
    setError("");
    setNotice("");
    try {
      if (canWrite) {
        const { error: upsertError } = await supabase.rpc("erp_fin_month_close_upsert", {
          p_company_id: ctx.companyId,
          p_fiscal_year: fiscalYear,
          p_period_month: periodMonth,
          p_notes: null,
        });
        if (upsertError) throw upsertError;
      }

      const { data, error: checkError } = await supabase.rpc("erp_fin_month_close_checks", {
        p_company_id: ctx.companyId,
        p_fiscal_year: fiscalYear,
        p_period_month: periodMonth,
      });
      if (checkError) throw checkError;
      setChecks((data as MonthCloseChecks) || null);

      await loadCloseRecord(ctx.companyId, fiscalYear, periodMonth);
      await loadLockStatus(ctx.companyId, fiscalYear, periodMonth);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to refresh checks.";
      setError(message || "Unable to refresh checks.");
    } finally {
      setLoadingChecks(false);
    }
  };

  const handleFinalize = async () => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only finance admins can finalize month close.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/control/month-close/finalize",
        {
          companyId: ctx.companyId,
          fiscalYear,
          periodMonth,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Month close finalized and period locked.");
      await refreshChecks();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to finalize month close.";
      setError(message || "Unable to finalize month close.");
    }
  };

  const handleSubmit = async () => {
    if (!ctx?.companyId || !closeRecord?.id) return;
    if (!canWrite) {
      setError("Only finance admins can submit month close.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/submit",
        {
          companyId: ctx.companyId,
          entityType: "month_close",
          entityId: closeRecord.id,
          note: null,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Month close submitted for approval.");
      await loadApproval(ctx.companyId, closeRecord.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to submit month close.";
      setError(message || "Unable to submit month close.");
    }
  };

  const handleApprove = async () => {
    if (!ctx?.companyId || !closeRecord?.id) return;
    if (!canWrite) {
      setError("Only finance admins can approve month close.");
      return;
    }
    const comment = window.prompt("Approval note (optional):")?.trim() || null;
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/approve",
        {
          companyId: ctx.companyId,
          entityType: "month_close",
          entityId: closeRecord.id,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Month close approved and finalized.");
      await refreshChecks();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to approve month close.";
      setError(message || "Unable to approve month close.");
    }
  };

  const handleReject = async () => {
    if (!ctx?.companyId || !closeRecord?.id) return;
    if (!canWrite) {
      setError("Only finance admins can reject month close.");
      return;
    }
    const comment = window.prompt("Rejection reason (optional):")?.trim() || null;
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/reject",
        {
          companyId: ctx.companyId,
          entityType: "month_close",
          entityId: closeRecord.id,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Month close rejected.");
      await loadApproval(ctx.companyId, closeRecord.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to reject month close.";
      setError(message || "Unable to reject month close.");
    }
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    refreshChecks();
  }, [ctx?.companyId, fiscalYear, periodMonth]);

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading month close…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance Control"
            title="Month Close"
            description="Finalize the monthly close checklist."
          />
          <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#111827" }}>
            Finance Control → Month Close
          </h2>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>No company is linked to this account.</p>
        </div>
      </ErpShell>
    );
  }

  const status = closeRecord?.status || "draft";
  const allOk = Boolean(checks?.all_ok);
  const approvalState = approval?.state ?? "draft";

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Control"
          title="Month Close"
          description="Run validations, finalize close, and lock the period."
          rightActions={
            <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Back to Finance
            </Link>
          }
        />
        <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#111827" }}>
          Finance Control → Month Close
        </h2>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Fiscal Year
            <input
              style={inputStyle}
              value={fiscalYear}
              onChange={(event) => setFiscalYear(event.target.value)}
              placeholder="FY25-26"
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            Period Month
            <select
              style={inputStyle}
              value={periodMonth}
              onChange={(event) => setPeriodMonth(Number(event.target.value))}
            >
              {monthLabels.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label} (Month {index + 1})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={refreshChecks}
            style={secondaryButtonStyle}
            disabled={loadingChecks}
          >
            {loadingChecks ? "Refreshing…" : "Refresh Checks"}
          </button>
          {canBypass ? (
            <button
              type="button"
              onClick={handleFinalize}
              style={{
                ...secondaryButtonStyle,
                backgroundColor: canWrite && allOk ? "#111827" : "#d1d5db",
                color: canWrite && allOk ? "#fff" : "#6b7280",
                borderColor: "transparent",
              }}
              disabled={!canWrite || !allOk || status === "closed"}
            >
              Finalize Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSubmit}
                style={{
                  ...secondaryButtonStyle,
                  backgroundColor: canWrite && allOk ? "#111827" : "#d1d5db",
                  color: canWrite && allOk ? "#fff" : "#6b7280",
                  borderColor: "transparent",
                }}
                disabled={!canWrite || !allOk || approvalState === "submitted" || approvalState === "approved"}
              >
                Submit for Approval
              </button>
              {canWrite && approvalState === "submitted" ? (
                <>
                  <button type="button" onClick={handleApprove} style={secondaryButtonStyle}>
                    Approve
                  </button>
                  <button type="button" onClick={handleReject} style={secondaryButtonStyle}>
                    Reject
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>

        {error && <p style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p>}
        {notice && <p style={{ color: "#16a34a", marginTop: 12 }}>{notice}</p>}

        <div style={{ marginTop: 16, ...cardStyle }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{getFiscalMonthLabel(periodMonth)}</div>
          <div style={{ color: "#6b7280" }}>Status: {status}</div>
          <div style={{ color: "#6b7280" }}>
            Approval state: {approvalLoading ? "Loading…" : approvalState}
          </div>
          <div style={{ color: "#6b7280" }}>
            Requested by: {approval?.requested_by || "—"} · {approval?.requested_at || "—"}
          </div>
          <div style={{ color: "#6b7280" }}>
            Reviewed by: {approval?.reviewed_by || "—"} · {approval?.reviewed_at || "—"}
          </div>
          <div style={{ color: "#6b7280" }}>Review note: {approval?.review_comment || "—"}</div>
          {closeRecord?.closed_at && (
            <div style={{ color: "#6b7280" }}>
              Closed at: {new Date(closeRecord.closed_at).toLocaleString()}
            </div>
          )}
          <div style={{ color: "#6b7280" }}>
            Period locked: {isLocked === null ? "—" : isLocked ? "Yes" : "No"}
          </div>
        </div>

        <div style={{ marginTop: 16, ...cardStyle }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Checklist</div>
          {!checks && <div style={{ color: "#6b7280" }}>No checks loaded yet.</div>}
          {checks && (
            <div style={{ display: "grid", gap: 10 }}>
              {([
                ["Bank reconciliation", checks.bank_reco_done],
                ["GST sales posted", checks.gst_sales_posted],
                ["GST purchase posted", checks.gst_purchase_posted],
                ["Inventory closed", checks.inventory_closed],
                ["AP reviewed", checks.ap_reviewed],
                ["Payroll posted", checks.payroll_posted],
              ] as const).map(([label, item]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>{label}</div>
                  <div style={{ fontWeight: 600, color: item?.ok ? "#16a34a" : "#b91c1c" }}>
                    {item?.ok ? "OK" : "Needs attention"}
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 10, fontWeight: 600 }}>
                All checks: {checks.all_ok ? "Ready" : "Incomplete"}
              </div>
            </div>
          )}
        </div>
      </div>
    </ErpShell>
  );
}
