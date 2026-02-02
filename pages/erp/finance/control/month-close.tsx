import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import ErrorBanner from "../../../../components/erp/ErrorBanner";
import {
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { supabase } from "../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { humanizeApiError } from "../../../../lib/erp/errors";
import { canBypassMakerChecker } from "../../../../lib/erp/featureFlags";

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

type ApprovalRow = {
  entity_id: string;
  state: string;
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
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fiscalYear, setFiscalYear] = useState(getFiscalYearLabel());
  const [periodMonth, setPeriodMonth] = useState(getFiscalPeriodMonth());
  const [checks, setChecks] = useState<MonthCloseChecks | null>(null);
  const [closeRecord, setCloseRecord] = useState<CloseRecord | null>(null);
  const [isLocked, setIsLocked] = useState<boolean | null>(null);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [approvalState, setApprovalState] = useState<string | null>(null);
  const [approvalComment, setApprovalComment] = useState<string | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  const canBypass = useMemo(() => canBypassMakerChecker(ctx?.roleKey), [ctx?.roleKey]);

  const reportError = (err: unknown, fallback: string) => {
    setError(humanizeApiError(err) || fallback);
    if (err instanceof Error) {
      setErrorDetails(err.message);
    } else if (typeof err === "string") {
      setErrorDetails(err);
    } else {
      setErrorDetails(null);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        reportError(
          context.membershipError || "No active company membership found for this user.",
          "No active company membership found for this user."
        );
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
    const record = (data as CloseRecord) || null;
    setCloseRecord(record);
    return record;
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

  const loadApprovalStatus = async (companyId: string, closeId: string) => {
    const { data, error: approvalError } = await supabase.rpc("erp_fin_approvals_list", {
      p_company_id: companyId,
      p_state: null,
      p_entity_type: "month_close",
    });
    if (approvalError) throw approvalError;
    const match = (data as ApprovalRow[] | null)?.find((row) => row.entity_id === closeId);
    setApprovalState(match?.state ?? null);
    setApprovalComment(match?.review_comment ?? null);
  };

  const refreshChecks = async () => {
    if (!ctx?.companyId) return;
    setLoadingChecks(true);
    setError(null);
    setErrorDetails(null);
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

      const record = await loadCloseRecord(ctx.companyId, fiscalYear, periodMonth);
      await loadLockStatus(ctx.companyId, fiscalYear, periodMonth);
      if (record?.id) {
        await loadApprovalStatus(ctx.companyId, record.id);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to refresh checks.";
      reportError(message || "Unable to refresh checks.", "Unable to refresh checks.");
    } finally {
      setLoadingChecks(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      reportError("Only finance admins can submit month close.", "Only finance admins can submit month close.");
      return;
    }
    if (!closeRecord?.id) {
      reportError("Month close record not found.", "Month close record not found.");
      return;
    }
    setError(null);
    setErrorDetails(null);
    setNotice(null);
    setIsSubmittingApproval(true);
    try {
      if (canBypass) {
        const { error: finalizeError } = await supabase.rpc("erp_fin_month_close_finalize", {
          p_company_id: ctx.companyId,
          p_fiscal_year: fiscalYear,
          p_period_month: periodMonth,
          p_use_maker_checker: false,
        });
        if (finalizeError) throw finalizeError;
        setNotice("Month close finalized and period locked.");
      } else {
        const { error: submitError } = await supabase.rpc("erp_fin_submit_for_approval", {
          p_company_id: ctx.companyId,
          p_entity_type: "month_close",
          p_entity_id: closeRecord.id,
          p_note: closeRecord.notes || null,
        });
        if (submitError) throw submitError;
        setNotice("Month close submitted for approval.");
      }
      await refreshChecks();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to submit month close.";
      reportError(message || "Unable to submit month close.", "Unable to submit month close.");
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const handleApprove = async () => {
    if (!ctx?.companyId || !closeRecord?.id) return;
    setIsApproving(true);
    setError(null);
    setErrorDetails(null);
    setNotice(null);
    try {
      const { error: approveError } = await supabase.rpc("erp_fin_approve", {
        p_company_id: ctx.companyId,
        p_entity_type: "month_close",
        p_entity_id: closeRecord.id,
        p_comment: null,
      });
      if (approveError) throw approveError;
      setNotice("Month close approved and finalized.");
      await refreshChecks();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to approve month close.";
      reportError(message || "Unable to approve month close.", "Unable to approve month close.");
    } finally {
      setIsApproving(false);
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
          <button
            type="button"
            onClick={handleSubmitForApproval}
            style={{
              ...secondaryButtonStyle,
              backgroundColor: canWrite && allOk ? "#111827" : "#d1d5db",
              color: canWrite && allOk ? "#fff" : "#6b7280",
              borderColor: "transparent",
            }}
            disabled={!canWrite || !allOk || status === "closed" || isSubmittingApproval}
          >
            {isSubmittingApproval
              ? "Submitting…"
              : canBypass
                ? "Finalize Close"
                : "Submit for Approval"}
          </button>
          {canWrite && approvalState === "submitted" ? (
            <button
              type="button"
              onClick={handleApprove}
              style={secondaryButtonStyle}
              disabled={isApproving}
            >
              {isApproving ? "Approving…" : "Approve"}
            </button>
          ) : null}
        </div>

        {error ? (
          <ErrorBanner message={error} details={errorDetails} onRetry={refreshChecks} />
        ) : null}
        {notice && <p style={{ color: "#16a34a", marginTop: 12 }}>{notice}</p>}

        <div style={{ marginTop: 16, ...cardStyle }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{getFiscalMonthLabel(periodMonth)}</div>
          <div style={{ color: "#6b7280" }}>Status: {status}</div>
          {closeRecord?.closed_at && (
            <div style={{ color: "#6b7280" }}>
              Closed at: {new Date(closeRecord.closed_at).toLocaleString()}
            </div>
          )}
          <div style={{ color: "#6b7280" }}>
            Period locked: {isLocked === null ? "—" : isLocked ? "Yes" : "No"}
          </div>
          <div style={{ color: "#6b7280" }}>
            Approval: {approvalState || "draft"}
          </div>
          {approvalComment ? <div style={{ color: "#6b7280" }}>{approvalComment}</div> : null}
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
