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
import { apiGet, apiPost } from "../../../../lib/erp/apiFetch";
import { canBypassMakerChecker } from "../../../../lib/erp/featureFlags";
import { humanizeApiError, type HumanizedError } from "../../../../lib/erp/errors";
import { supabase } from "../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  session: { access_token?: string } | null;
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

type ApprovalRecord = {
  id: string;
  entity_id: string;
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
  const [error, setError] = useState<HumanizedError | null>(null);
  const [notice, setNotice] = useState("");
  const [fiscalYear, setFiscalYear] = useState(getFiscalYearLabel());
  const [locks, setLocks] = useState<PeriodLockRow[]>([]);
  const [loadingLocks, setLoadingLocks] = useState(false);
  const [approvalMap, setApprovalMap] = useState<Record<string, ApprovalRecord>>({});
  const [approvalLoading, setApprovalLoading] = useState(false);

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx]);

  const canBypass = useMemo(() => canBypassMakerChecker(ctx?.roleKey), [ctx?.roleKey]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        reportError(context.membershipError || "No active company membership found for this user.");
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
    setNotice("");
    try {
      const { data, error: fetchError } = await supabase.rpc("erp_fin_period_locks_list", {
        p_company_id: companyId,
        p_fiscal_year: year,
      });
      if (fetchError) throw fetchError;
      setLocks((data as PeriodLockRow[]) || []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load period locks.";
      reportError(message || "Unable to load period locks.");
    } finally {
      setLoadingLocks(false);
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

  const reportError = (err: unknown) => {
    setError(humanizeApiError(err));
  };

  const loadApprovals = async (companyId: string) => {
    if (!ctx?.session?.access_token) return;
    setApprovalLoading(true);
    try {
      const params = new URLSearchParams({
        companyId,
        entityType: "period_unlock",
      });
      const payload = await apiGet<{ data?: ApprovalRecord[] }>(
        `/api/finance/approvals/list?${params.toString()}`,
        { headers: getAuthHeaders() }
      );
      const map: Record<string, ApprovalRecord> = {};
      (payload.data || []).forEach((row) => {
        map[row.entity_id] = row;
      });
      setApprovalMap(map);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load approval states.";
      reportError(message || "Unable to load approval states.");
    } finally {
      setApprovalLoading(false);
    }
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    fetchLocks(ctx.companyId, fiscalYear);
    loadApprovals(ctx.companyId);
  }, [ctx?.companyId, fiscalYear]);

  const handleLock = async (month: number) => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      reportError("Only finance admins can lock periods.");
      return;
    }
    const reason = window.prompt("Reason for locking this period (optional):")?.trim() || null;
    setError(null);
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
      reportError(message || "Unable to lock period.");
    }
  };

  const handleUnlock = async (month: number) => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      reportError("Only finance admins can unlock periods.");
      return;
    }
    const confirmed = window.confirm(`Unlock FY ${fiscalYear} month ${month}? This should be rare.`);
    if (!confirmed) return;
    const reason = window.prompt("Reason for unlocking this period (optional):")?.trim() || null;
    setError(null);
    setNotice("");
    try {
      if (canBypass) {
        await apiPost(
          "/api/finance/control/period-lock/unlock",
          {
            companyId: ctx.companyId,
            fiscalYear,
            periodMonth: month,
            reason,
          },
          { headers: getAuthHeaders() }
        );
        setNotice(`Unlocked FY ${fiscalYear} month ${month}.`);
        await fetchLocks(ctx.companyId, fiscalYear);
      } else {
        const lock = locks.find((row) => row.period_month === month);
        if (!lock?.id) {
          reportError("Approval record could not be created for this period.");
          return;
        }
        await apiPost(
          "/api/finance/approvals/submit",
          {
            companyId: ctx.companyId,
            entityType: "period_unlock",
            entityId: lock.id,
            note: reason,
          },
          { headers: getAuthHeaders() }
        );
        setNotice(`Unlock request submitted for FY ${fiscalYear} month ${month}.`);
        await loadApprovals(ctx.companyId);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to unlock period.";
      reportError(message || "Unable to unlock period.");
    }
  };

  const handleApproveUnlock = async (lockId: string, month: number) => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      reportError("Only finance admins can approve unlocks.");
      return;
    }
    const comment = window.prompt("Approval note (optional):")?.trim() || null;
    setError(null);
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/approve",
        {
          companyId: ctx.companyId,
          entityType: "period_unlock",
          entityId: lockId,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice(`Unlock approved for FY ${fiscalYear} month ${month}.`);
      await fetchLocks(ctx.companyId, fiscalYear);
      await loadApprovals(ctx.companyId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to approve unlock.";
      reportError(message || "Unable to approve unlock.");
    }
  };

  const handleRejectUnlock = async (lockId: string, month: number) => {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      reportError("Only finance admins can reject unlocks.");
      return;
    }
    const comment = window.prompt("Rejection reason (optional):")?.trim() || null;
    setError(null);
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/reject",
        {
          companyId: ctx.companyId,
          entityType: "period_unlock",
          entityId: lockId,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice(`Unlock request rejected for FY ${fiscalYear} month ${month}.`);
      await loadApprovals(ctx.companyId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to reject unlock.";
      reportError(message || "Unable to reject unlock.");
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
          {error ? (
            <ErrorBanner message={error.message} />
          ) : (
            <p style={{ color: "#b91c1c" }}>Unable to load company context.</p>
          )}
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
            onClick={() => {
              if (!ctx?.companyId) return;
              fetchLocks(ctx.companyId, fiscalYear);
              loadApprovals(ctx.companyId);
            }}
            style={secondaryButtonStyle}
            disabled={loadingLocks}
          >
            {loadingLocks ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? <ErrorBanner message={error.message} /> : null}
        {notice && <p style={{ color: "#16a34a", marginTop: 12 }}>{notice}</p>}

        <div style={{ marginTop: 16, ...gridStyle }}>
          {monthLabels.map((label, index) => {
            const periodMonth = index + 1;
            const lock = lockMap.get(periodMonth);
            const isLocked = lock?.is_locked ?? false;
            const approvalState = lock?.id ? approvalMap[lock.id]?.state ?? "draft" : "draft";
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
                    <span style={labelStyle}>Approval</span>
                    <div>{approvalLoading ? "Loading…" : approvalState}</div>
                  </div>
                  <div>
                    <span style={labelStyle}>Requested By</span>
                    <div>{lock?.id ? approvalMap[lock.id]?.requested_by || "—" : "—"}</div>
                  </div>
                  <div>
                    <span style={labelStyle}>Reason</span>
                    <div>{lock?.lock_reason || "—"}</div>
                  </div>
                  <div>
                    <span style={labelStyle}>Locked At</span>
                    <div>{lock?.locked_at ? new Date(lock.locked_at).toLocaleString() : "—"}</div>
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
                    <button
                      type="button"
                      onClick={() => handleUnlock(periodMonth)}
                      style={{
                        ...secondaryButtonStyle,
                        backgroundColor: !isLocked ? "#d1d5db" : "#fff",
                      }}
                      disabled={
                        !isLocked ||
                        (!canBypass && (approvalState === "submitted" || approvalState === "approved"))
                      }
                    >
                      {canBypass ? "Unlock Month" : approvalState === "submitted" ? "Unlock Submitted" : "Submit Unlock"}
                    </button>
                    {!canBypass && approvalState === "submitted" && lock?.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApproveUnlock(lock.id, periodMonth)}
                          style={secondaryButtonStyle}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectUnlock(lock.id, periodMonth)}
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
