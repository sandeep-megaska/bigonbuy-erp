import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { apiGet, apiPost } from "../../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type ApprovalRow = {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  state: string;
  requested_by: string | null;
  requested_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  entity_label?: string | null;
  entity_ref_no?: string | null;
  entity_amount?: number | null;
  entity_date?: string | null;
};

const entityTypeLabel: Record<string, string> = {
  ap_bill: "Vendor Bill",
  ap_payment: "Vendor Payment",
  ap_advance: "Vendor Advance",
  vendor_bill: "Vendor Bill",
  vendor_payment: "Vendor Payment",
  month_close: "Month Close",
  period_unlock: "Period Unlock",
  payroll_post: "Payroll Post",
};

const entityLink = (entityType: string, entityId: string) => {
  switch (entityType) {
    case "ap_bill":
    case "vendor_bill":
      return `/erp/finance/ap/vendor-bills/${entityId}`;
    case "ap_payment":
    case "vendor_payment":
      return `/erp/finance/vendor-payments/${entityId}`;
    case "ap_advance":
      return "/erp/finance/ap/vendor-advances";
    case "month_close":
      return "/erp/finance/control/month-close";
    case "period_unlock":
      return "/erp/finance/control/period-lock";
    case "payroll_post":
      return `/erp/hr/payroll/runs/${entityId}`;
    default:
      return null;
  }
};

const formatAmount = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null;
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
};

export default function ApprovalsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [stateFilter, setStateFilter] = useState("submitted");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const canApprove = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx?.roleKey]
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

  const loadApprovals = async () => {
    if (!ctx?.companyId) return;
    setIsRefreshing(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ companyId: ctx.companyId });
      if (stateFilter) {
        params.set("state", stateFilter);
      }
      const payload = await apiGet<{ data?: ApprovalRow[] }>(
        `/api/finance/approvals/list?${params.toString()}`,
        { headers: getAuthHeaders() }
      );
      setApprovals((payload.data || []) as ApprovalRow[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load approvals.";
      setError(message || "Failed to load approvals.");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    void loadApprovals();
  }, [ctx?.companyId, stateFilter]);

  const handleApprove = async (approval: ApprovalRow) => {
    if (!ctx?.companyId) return;
    const comment = window.prompt("Approval note (optional):")?.trim() || null;
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/approve",
        {
          companyId: ctx.companyId,
          entityType: approval.entity_type,
          entityId: approval.entity_id,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Approval completed.");
      await loadApprovals();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to approve.";
      setError(message || "Failed to approve.");
    }
  };

  const handleReject = async (approval: ApprovalRow) => {
    if (!ctx?.companyId) return;
    const comment = window.prompt("Rejection reason (optional):")?.trim() || null;
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/reject",
        {
          companyId: ctx.companyId,
          entityType: approval.entity_type,
          entityId: approval.entity_id,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Approval rejected.");
      await loadApprovals();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to reject.";
      setError(message || "Failed to reject.");
    }
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading approvals…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance Control"
            title="Approvals"
            description="Review finance approvals submitted for posting."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>No company is linked to this account.</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance Control"
          title="Approvals"
          description="Review and action submitted finance approvals."
          rightActions={
            <Link href="/erp/finance" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Back to Finance
            </Link>
          }
        />

        <div style={{ ...cardStyle, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            State
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
              style={{ ...secondaryButtonStyle, width: 200 }}
            >
              <option value="submitted">Submitted</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="">All</option>
            </select>
          </label>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={loadApprovals}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? <div style={{ ...cardStyle, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div> : null}
        {notice ? <div style={{ ...cardStyle, borderColor: "#86efac", color: "#166534" }}>{notice}</div> : null}

        <div style={{ ...cardStyle, padding: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Entity Type</th>
                  <th style={tableHeaderCellStyle}>Entity</th>
                  <th style={tableHeaderCellStyle}>State</th>
                  <th style={tableHeaderCellStyle}>Requested By</th>
                  <th style={tableHeaderCellStyle}>Requested At</th>
                  <th style={tableHeaderCellStyle}>Reviewed By</th>
                  <th style={tableHeaderCellStyle}>Reviewed At</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {approvals.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={8}>
                      No approvals found.
                    </td>
                  </tr>
                ) : (
                  approvals.map((approval) => {
                    const link = entityLink(approval.entity_type, approval.entity_id);
                    const displayLabel =
                      approval.entity_label ||
                      entityTypeLabel[approval.entity_type] ||
                      approval.entity_type;
                    const detailParts: string[] = [];
                    if (approval.entity_ref_no) {
                      detailParts.push(approval.entity_ref_no);
                    }
                    const formattedAmount = formatAmount(approval.entity_amount);
                    if (formattedAmount) {
                      detailParts.push(`₹${formattedAmount}`);
                    }
                    const formattedDate = formatDate(approval.entity_date);
                    if (formattedDate) {
                      detailParts.push(formattedDate);
                    }
                    const detailText = detailParts.join(" • ");
                    return (
                      <tr key={approval.id}>
                        <td style={tableCellStyle}>
                          {entityTypeLabel[approval.entity_type] || approval.entity_type}
                        </td>
                        <td style={tableCellStyle}>
                          {link ? (
                            <Link href={link} style={{ color: "inherit", textDecoration: "none" }}>
                              <div style={{ fontWeight: 600 }}>{displayLabel}</div>
                              <div style={{ fontSize: 12, color: "#6b7280" }}>
                                {detailText || "—"}
                              </div>
                            </Link>
                          ) : (
                            <>
                              <div style={{ fontWeight: 600 }}>{displayLabel}</div>
                              <div style={{ fontSize: 12, color: "#6b7280" }}>
                                {detailText || "—"}
                              </div>
                            </>
                          )}
                        </td>
                        <td style={tableCellStyle}>{approval.state}</td>
                        <td style={tableCellStyle}>{approval.requested_by || "—"}</td>
                        <td style={tableCellStyle}>{approval.requested_at || "—"}</td>
                        <td style={tableCellStyle}>{approval.reviewed_by || "—"}</td>
                        <td style={tableCellStyle}>{approval.reviewed_at || "—"}</td>
                        <td style={tableCellStyle}>
                          {canApprove && approval.state === "submitted" ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                style={primaryButtonStyle}
                                onClick={() => handleApprove(approval)}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                style={secondaryButtonStyle}
                                onClick={() => handleReject(approval)}
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: "#6b7280" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ErpShell>
  );
}
