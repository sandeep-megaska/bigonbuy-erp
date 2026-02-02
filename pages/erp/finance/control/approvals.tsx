import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import ErrorBanner from "../../../../components/erp/ErrorBanner";
import {
  inputStyle,
  pageContainerStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { humanizeApiError } from "../../../../lib/erp/errors";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type ApprovalRow = {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  state: string;
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
};

const entityOptions = [
  { label: "All", value: "" },
  { label: "Vendor Bills", value: "ap_bill" },
  { label: "Vendor Payments", value: "ap_payment" },
  { label: "Vendor Advances", value: "ap_advance" },
  { label: "Month Close", value: "month_close" },
  { label: "Period Unlock", value: "period_unlock" },
];

const stateOptions = [
  { label: "Submitted", value: "submitted" },
  { label: "Draft", value: "draft" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "" },
];

const entityLinkMap: Record<string, (id: string) => string> = {
  ap_bill: (id) => `/erp/finance/ap/vendor-bills/${id}`,
  ap_payment: (id) => `/erp/finance/vendor-payments/${id}`,
  ap_advance: () => "/erp/finance/ap/vendor-advances",
  month_close: () => "/erp/finance/control/month-close",
  period_unlock: () => "/erp/finance/control/period-lock",
};

const formatDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";

export default function FinanceApprovalsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [stateFilter, setStateFilter] = useState("submitted");
  const [entityFilter, setEntityFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadApprovals = async () => {
    if (!ctx?.companyId) return;
    setIsLoading(true);
    setError(null);
    setErrorDetails(null);

    try {
      const { data, error: loadError } = await supabase.rpc("erp_fin_approvals_list", {
        p_company_id: ctx.companyId,
        p_state: stateFilter || null,
        p_entity_type: entityFilter || null,
      });
      if (loadError) throw loadError;

      const rows = (data || []) as ApprovalRow[];
      const filtered = rows.filter((row) => {
        if (!fromDate && !toDate) return true;
        const requestedDate = row.requested_at?.slice(0, 10);
        if (fromDate && requestedDate < fromDate) return false;
        if (toDate && requestedDate > toDate) return false;
        return true;
      });
      setApprovals(filtered);
    } catch (err) {
      setError(humanizeApiError(err) || "Failed to load approvals.");
      setErrorDetails(err instanceof Error ? err.message : null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!ctx?.companyId) return;
    loadApprovals();
  }, [ctx?.companyId, stateFilter, entityFilter, fromDate, toDate]);

  const handleApprove = async (row: ApprovalRow) => {
    if (!ctx?.companyId) return;
    const comment = window.prompt("Approval note (optional):")?.trim() || null;
    try {
      const { error: approveError } = await supabase.rpc("erp_fin_approve", {
        p_company_id: ctx.companyId,
        p_entity_type: row.entity_type,
        p_entity_id: row.entity_id,
        p_comment: comment,
      });
      if (approveError) throw approveError;
      await loadApprovals();
    } catch (err) {
      setError(humanizeApiError(err) || "Failed to approve request.");
      setErrorDetails(err instanceof Error ? err.message : null);
    }
  };

  const handleReject = async (row: ApprovalRow) => {
    if (!ctx?.companyId) return;
    const comment = window.prompt("Rejection reason (required):")?.trim();
    if (!comment) {
      setError("Rejection note is required.");
      return;
    }
    try {
      const { error: rejectError } = await supabase.rpc("erp_fin_reject", {
        p_company_id: ctx.companyId,
        p_entity_type: row.entity_type,
        p_entity_id: row.entity_id,
        p_comment: comment,
      });
      if (rejectError) throw rejectError;
      await loadApprovals();
    } catch (err) {
      setError(humanizeApiError(err) || "Failed to reject request.");
      setErrorDetails(err instanceof Error ? err.message : null);
    }
  };

  const getEntityLink = (entityType: string, entityId: string) =>
    entityLinkMap[entityType]?.(entityId) ?? "/erp/finance";

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
            description="Manage maker-checker approvals."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
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
          description="Review submitted approvals and respond quickly."
          rightActions={
            <button type="button" style={secondaryButtonStyle} onClick={loadApprovals}>
              Refresh
            </button>
          }
        />

        {error ? (
          <ErrorBanner message={error} details={errorDetails} onRetry={loadApprovals} />
        ) : null}

        <section style={filterGridStyle}>
          <label style={filterLabelStyle}>
            State
            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} style={inputStyle}>
              {stateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={filterLabelStyle}>
            Entity type
            <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} style={inputStyle}>
              {entityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={filterLabelStyle}>
            From
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} style={inputStyle} />
          </label>
          <label style={filterLabelStyle}>
            To
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} style={inputStyle} />
          </label>
        </section>

        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Entity</th>
                <th style={tableHeaderCellStyle}>Entity ID</th>
                <th style={tableHeaderCellStyle}>Requested By</th>
                <th style={tableHeaderCellStyle}>Requested At</th>
                <th style={tableHeaderCellStyle}>Note</th>
                <th style={tableHeaderCellStyle}>State</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((row) => (
                <tr key={row.id}>
                  <td style={tableCellStyle}>{row.entity_type}</td>
                  <td style={tableCellStyle}>
                    <Link href={getEntityLink(row.entity_type, row.entity_id)} style={linkStyle}>
                      {row.entity_id}
                    </Link>
                  </td>
                  <td style={tableCellStyle}>{row.requested_by}</td>
                  <td style={tableCellStyle}>{formatDateTime(row.requested_at)}</td>
                  <td style={tableCellStyle}>{row.review_comment || "—"}</td>
                  <td style={tableCellStyle}>{row.state}</td>
                  <td style={tableCellStyle}>
                    {canApprove && row.state === "submitted" ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          style={actionButtonStyle}
                          onClick={() => handleApprove(row)}
                          disabled={isLoading}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          style={rejectButtonStyle}
                          onClick={() => handleReject(row)}
                          disabled={isLoading}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {approvals.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...tableCellStyle, color: "#6b7280" }}>
                    {isLoading ? "Loading approvals…" : "No approvals found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ErpShell>
  );
}

const filterGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
};

const filterLabelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#111827",
};

const linkStyle = {
  color: "#1d4ed8",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: 13,
};

const actionButtonStyle = {
  ...secondaryButtonStyle,
  padding: "6px 10px",
  fontSize: 12,
};

const rejectButtonStyle = {
  ...secondaryButtonStyle,
  padding: "6px 10px",
  fontSize: 12,
  borderColor: "#fecaca",
  color: "#b91c1c",
  backgroundColor: "#fff1f2",
};
