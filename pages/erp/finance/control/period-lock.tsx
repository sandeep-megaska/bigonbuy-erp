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

type PeriodLockRow = {
  id: string;
  company_id: string;
  fiscal_year: string;
  period_month: number;
  is_locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  lock_reason: string | null;
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

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const labelStyle = {
  fontSize: 12,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
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

export default function PeriodLockPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fiscalYear, setFiscalYear] = useState(getFiscalYearLabel());
  const [locks, setLocks] = useState<PeriodLockRow[]>([]);
  const [loadingLocks, setLoadingLocks] = useState(false);
  const [approvalMap, setApprovalMap] = useState<Record<string, { state: string; comment?: string | null }>>({});
  const [isSubmittingApproval, setIsSubmittingApproval] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState<string | null>(null);

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

  const fetchLocks = async (companyId: string, year: string) => {
    setLoadingLocks(true);
    setError(null);
    setErrorDetails(null);
    setNotice("");
    try {
      const { data, error: fetchError } = await supabase.rpc("erp_fin_period_locks_list", {
        p_company_id: companyId,
        p_fiscal_year: year,
      });
      if (fetchError) throw fetchError;
      setLocks((data as PeriodLockRow[]) || []);
      await loadUnlockApprovals(companyId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load period locks.";
      reportError(message || "Unable to load period locks.", "Unable to load period locks.");
    } finally {
      setLoadingLocks(false);
    }
  };

  const loadUnlockApprovals = async (companyId: string) => {
    const { data, error: approvalsError } = await supabase.rpc("erp_fin_approvals_list", {
      p_company_id: companyId,
      p_state: null,
      p_entity_type: "period_unlock",
    });
    if (approvalsError) {
      reportError(approvalsError, "Failed to load unlock approvals.");
      return;
    }
    const map: Record<string, { state: string; comment?: string | null }> = {};
    (data as ApprovalRow[] | null)?.forEach((row) => {
      map[row.entity_id] = { state: row.state, comment: row.review_comment };
    });
    setApprovalMap(map);
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    fetchLocks(ctx.companyId, fiscalYear);
  }, [ctx?.companyId, fiscalYear]);

  const handleLock = async (month: number) => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      reportError("Only finance admins can lock periods.", "Only finance admins can lock periods.");
      return;
    }
    const reason = window.prompt("Reason for locking this period (optional):")?.trim() || null;
    setError(null);
    setErrorDetails(null);
    setNotice("");
    try {
      const { error: lockError } = await supabase.rpc("erp_fin_period_lock", {
        p_company_id: ctx.companyId,
        p_fiscal_year: fiscalYear,
        p_period_month: month,
        p_reason: reason,
      });
      if (lockError) throw lockError;
      setNotice(`Locked FY ${fiscalYear} month ${month}.`);
      await fetchLocks(ctx.companyId, fiscalYear);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to lock period.";
      reportError(message || "Unable to lock period.", "Unable to lock period.");
    }
  };

  const handleRequestUnlock = async (lock: PeriodLockRow) => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      reportError("Only finance admins can unlock periods.", "Only finance admins can unlock periods.");
      return;
    }
    const confirmed = window.confirm(
      `Request unlock for FY ${fiscalYear} month ${lock.period_month}? This should be rare.`
    );
    if (!confirmed) return;
    const reason = window.prompt("Reason for unlocking this period (optional):")?.trim() || null;
    setError(null);
    setErrorDetails(null);
    setNotice(null);
    setIsSubmittingApproval(lock.id);
    try {
      if (canBypass) {
        const { error: unlockError } = await supabase.rpc("erp_fin_period_unlock", {
          p_company_id: ctx.companyId,
          p_fiscal_year: fiscalYear,
          p_period_month: lock.period_month,
          p_reason: reason,
          p_use_maker_checker: false,
        });
        if (unlockError) throw unlockError;
        setNotice(`Unlocked FY ${fiscalYear} month ${lock.period_month}.`);
      } else {
        const { error: submitError } = await supabase.rpc("erp_fin_submit_for_approval", {
          p_company_id: ctx.companyId,
          p_entity_type: "period_unlock",
          p_entity_id: lock.id,
          p_note: reason,
        });
        if (submitError) throw submitError;
        setNotice(`Unlock requested for FY ${fiscalYear} month ${lock.period_month}.`);
      }
      await fetchLocks(ctx.companyId, fiscalYear);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to unlock period.";
      reportError(message || "Unable to unlock period.", "Unable to unlock period.");
    } finally {
      setIsSubmittingApproval(null);
    }
  };

  const handleApproveUnlock = async (lock: PeriodLockRow) => {
    if (!ctx?.companyId) return;
    setIsApproving(lock.id);
    setError(null);
    setErrorDetails(null);
    setNotice(null);
    try {
      const { error: approveError } = await supabase.rpc("erp_fin_approve", {
        p_company_id: ctx.companyId,
        p_entity_type: "period_unlock",
        p_entity_id: lock.id,
        p_comment: null,
      });
      if (approveError) throw approveError;
      setNotice(`Unlock approved for FY ${fiscalYear} month ${lock.period_month}.`);
      await fetchLocks(ctx.companyId, fiscalYear);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to approve unlock.";
      reportError(message || "Unable to approve unlock.", "Unable to approve unlock.");
    } finally {
      setIsApproving(null);
    }
  };

  const handleRejectUnlock = async (lock: PeriodLockRow) => {
    if (!ctx?.companyId) return;
    const comment = window.prompt("Rejection reason (required):")?.trim();
    if (!comment) {
      reportError("Rejection note is required.", "Rejection note is required.");
      return;
    }
    setError(null);
    setErrorDetails(null);
    setNotice(null);
    try {
      const { error: rejectError } = await supabase.rpc("erp_fin_reject", {
        p_company_id: ctx.companyId,
        p_entity_type: "period_unlock",
        p_entity_id: lock.id,
        p_comment: comment,
      });
      if (rejectError) throw rejectError;
      await fetchLocks(ctx.companyId, fiscalYear);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to reject unlock.";
      reportError(message || "Unable to reject unlock.", "Unable to reject unlock.");
    }
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading period locks…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance Control"
            title="Period Locks"
            description="Manage locked fiscal periods."
          />
          <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#111827" }}>
            Finance Control → Period Lock
          </h2>
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>No company is linked to this account.</p>
        </div>
      </ErpShell>
    );
  }

  const lockMap = new Map(locks.map((lock) => [lock.period_month, lock]));

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Control"
          title="Period Locks"
          description="Lock fiscal months to prevent new finance postings."
          rightActions={
            <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Back to Finance
            </Link>
          }
        />
        <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#111827" }}>
          Finance Control → Period Lock
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
          <button
            type="button"
            onClick={() => ctx?.companyId && fetchLocks(ctx.companyId, fiscalYear)}
            style={secondaryButtonStyle}
            disabled={loadingLocks}
          >
            {loadingLocks ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? (
          <ErrorBanner message={error} details={errorDetails} onRetry={() => ctx?.companyId && fetchLocks(ctx.companyId, fiscalYear)} />
        ) : null}
        {notice && <p style={{ color: "#16a34a", marginTop: 12 }}>{notice}</p>}

        <div style={{ marginTop: 16, ...gridStyle }}>
          {monthLabels.map((label, index) => {
            const periodMonth = index + 1;
            const lock = lockMap.get(periodMonth);
            const isLocked = lock?.is_locked ?? false;
            const approval = lock?.id ? approvalMap[lock.id] : null;
            return (
              <div key={periodMonth} style={cardStyle}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {label} <span style={{ color: "#6b7280" }}>· Month {periodMonth}</span>
                </div>
                <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
                  <div>
                    <span style={labelStyle}>Status</span>
                    <div style={{ fontWeight: 600, color: isLocked ? "#b91c1c" : "#16a34a" }}>
                      {isLocked ? "Locked" : "Open"}
                    </div>
                  </div>
                  <div>
                    <span style={labelStyle}>Reason</span>
                    <div>{lock?.lock_reason || "—"}</div>
                  </div>
                  <div>
                    <span style={labelStyle}>Locked At</span>
                    <div>{lock?.locked_at ? new Date(lock.locked_at).toLocaleString() : "—"}</div>
                  </div>
                  <div>
                    <span style={labelStyle}>Unlock Approval</span>
                    <div>{approval?.state || "—"}</div>
                  </div>
                </div>
                {canWrite && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => handleLock(periodMonth)}
                      style={{
                        ...secondaryButtonStyle,
                        backgroundColor: isLocked ? "#d1d5db" : "#111827",
                        color: isLocked ? "#6b7280" : "#fff",
                        borderColor: "transparent",
                      }}
                      disabled={isLocked}
                    >
                      Lock Month
                    </button>
                    {isLocked ? (
                      <button
                        type="button"
                        onClick={() => lock && handleRequestUnlock(lock)}
                        style={{
                          ...secondaryButtonStyle,
                          backgroundColor: "#fff",
                        }}
                        disabled={Boolean(isSubmittingApproval && lock?.id === isSubmittingApproval) || approval?.state === "submitted"}
                      >
                        {canBypass ? "Unlock Month" : approval?.state === "submitted" ? "Unlock Requested" : "Request Unlock"}
                      </button>
                    ) : (
                      <button type="button" style={{ ...secondaryButtonStyle, backgroundColor: "#d1d5db" }} disabled>
                        Unlock Month
                      </button>
                    )}
                    {canWrite && approval?.state === "submitted" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => lock && handleApproveUnlock(lock)}
                          style={secondaryButtonStyle}
                          disabled={isApproving === lock?.id}
                        >
                          {isApproving === lock?.id ? "Approving…" : "Approve Unlock"}
                        </button>
                        <button
                          type="button"
                          onClick={() => lock && handleRejectUnlock(lock)}
                          style={secondaryButtonStyle}
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ErpShell>
  );
}
