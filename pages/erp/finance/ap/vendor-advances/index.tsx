import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { apiGet, apiPost } from "../../../../../lib/erp/apiFetch";
import { isMakerCheckerBypassAllowed } from "../../../../../lib/erp/featureFlags";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { vendorAdvanceCreate, vendorAdvanceList } from "../../../../../lib/erp/vendorBills";
import { supabase } from "../../../../../lib/supabaseClient";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value || 0);

const statusLabel = (status: string) => {
  switch (status) {
    case "draft":
      return "Draft";
    case "approved":
      return "Approved (Posted)";
    case "void":
      return "Void";
    default:
      return status;
  }
};

const today = () => new Date().toISOString().slice(0, 10);
const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

type VendorOption = {
  id: string;
  legal_name: string;
};

type PaymentAccountOption = {
  id: string;
  code: string;
  name: string;
};

type VendorAdvanceRow = {
  advance_id: string;
  vendor_id: string;
  vendor_name: string;
  advance_date: string;
  amount: number;
  status: string;
  reference: string | null;
  payment_instrument_id: string | null;
  journal_doc_no: string | null;
  is_void: boolean;
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

/**
 * Dependency map:
 * UI: /erp/finance/ap/vendor-advances -> RPC: erp_ap_vendor_advances_list,
 *                                        erp_ap_vendor_advance_create,
 *                                        erp_ap_vendor_advance_approve_and_post
 * RPC tables: erp_ap_vendor_advances, erp_vendors, erp_fin_journals
 */
export default function VendorAdvancesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [advances, setAdvances] = useState<VendorAdvanceRow[]>([]);

  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());
  const [selectedVendor, setSelectedVendor] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [formVendorId, setFormVendorId] = useState("");
  const [formDate, setFormDate] = useState(today());
  const [formAmount, setFormAmount] = useState("");
  const [formReference, setFormReference] = useState("");
  const [formPaymentAccount, setFormPaymentAccount] = useState("");
  const [approvalMap, setApprovalMap] = useState<Record<string, ApprovalRecord>>({});
  const [approvalLoading, setApprovalLoading] = useState(false);

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v.legal_name])), [vendors]);

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "finance"].includes(ctx.roleKey);
  }, [ctx?.roleKey]);

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
        setLoading(false);
        return;
      }

      await Promise.all([
        loadVendors(context.companyId),
        loadPaymentAccounts(),
        loadAdvances(context.companyId),
        loadApprovals(context.companyId),
      ]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadVendors = async (companyId: string) => {
    const { data, error: loadError } = await supabase
      .from("erp_vendors")
      .select("id, legal_name")
      .eq("company_id", companyId)
      .order("legal_name");

    if (loadError) {
      setError(loadError.message || "Failed to load vendors.");
      return;
    }

    setVendors((data || []) as VendorOption[]);
  };

  const loadPaymentAccounts = async () => {
    const { data, error: loadError } = await supabase.rpc("erp_gl_accounts_picklist", {
      p_q: null,
      p_include_inactive: false,
    });

    if (loadError) {
      setError(loadError.message || "Failed to load payment accounts.");
      return;
    }

    setPaymentAccounts((data || []) as PaymentAccountOption[]);
  };

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadApprovals = async (companyId: string) => {
    if (!ctx?.session?.access_token) return;
    setApprovalLoading(true);
    try {
      const params = new URLSearchParams({
        companyId,
        entityType: "ap_advance",
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
      const message = e instanceof Error ? e.message : "Failed to load approvals.";
      setError(message || "Failed to load approvals.");
    } finally {
      setApprovalLoading(false);
    }
  };

  const loadAdvances = async (_companyId: string) => {
    setError("");
    const { data, error: loadError } = await vendorAdvanceList(
      selectedVendor || null,
      statusFilter || null,
    );

    if (loadError) {
      setError(loadError.message || "Failed to load vendor advances.");
      return;
    }

    const rows = (data || []) as VendorAdvanceRow[];

    const mapped = rows
      .filter((row) => row.advance_date >= fromDate && row.advance_date <= toDate)
      .map((row) => ({
        ...row,
        vendor_name: row.vendor_name || vendorMap.get(row.vendor_id) || "",
        amount: Number(row.amount || 0),
      }));

    setAdvances(mapped);
  };

  const handleFilterApply = async () => {
    if (!ctx?.companyId) return;
    await loadAdvances(ctx.companyId);
  };

  const handleCreateAdvance = async () => {
    setError("");
    setNotice("");

    if (!formVendorId) {
      setError("Select a vendor to create an advance.");
      return;
    }

    const amount = Number(formAmount || 0);
    if (!amount || amount <= 0) {
      setError("Advance amount must be greater than zero.");
      return;
    }
    if (!formPaymentAccount) {
      setError("Select a payment account before saving the advance.");
      return;
    }

    const { error: createError } = await vendorAdvanceCreate({
      p_vendor_id: formVendorId,
      p_amount: amount,
      p_advance_date: formDate,
      p_payment_instrument_id: formPaymentAccount,
      p_reference: formReference || null,
    });

    if (createError) {
      setError(createError.message || "Failed to create vendor advance.");
      return;
    }

    setFormAmount("");
    setFormReference("");
    setNotice("Vendor advance saved as draft.");

    if (ctx?.companyId) {
      await loadAdvances(ctx.companyId);
    }
  };

  const handlePostAdvance = async (advance: VendorAdvanceRow) => {
    setError("");
    setNotice("");

    if (!advance.payment_instrument_id) {
      setError("Payment account is required before posting this advance.");
      return;
    }

    setPostingId(advance.advance_id);
    try {
      const payload = await apiPost<{ data?: { doc_no?: string | null } | null }>(
        "/api/finance/ap/vendor-advances/post",
        { advanceId: advance.advance_id },
        { headers: getAuthHeaders() }
      );
      const postedDocNo = payload?.data?.doc_no ?? null;
      setNotice(postedDocNo ? `Approved journal ${postedDocNo}.` : "Vendor advance approved.");
      if (ctx?.companyId) {
        await loadAdvances(ctx.companyId);
        await loadApprovals(ctx.companyId);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to post vendor advance.";
      setError(message || "Failed to post vendor advance.");
    } finally {
      setPostingId(null);
    }
  };

  const handleSubmitAdvance = async (advanceId: string) => {
    if (!ctx?.companyId) return;
    setPostingId(advanceId);
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/submit",
        {
          companyId: ctx.companyId,
          entityType: "ap_advance",
          entityId: advanceId,
          note: null,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Vendor advance submitted for approval.");
      await loadApprovals(ctx.companyId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to submit vendor advance.";
      setError(message || "Failed to submit vendor advance.");
    } finally {
      setPostingId(null);
    }
  };

  const handleApproveAdvance = async (advanceId: string) => {
    if (!ctx?.companyId) return;
    const comment = window.prompt("Approval note (optional):")?.trim() || null;
    setPostingId(advanceId);
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/approve",
        {
          companyId: ctx.companyId,
          entityType: "ap_advance",
          entityId: advanceId,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Vendor advance approved and posted.");
      await loadAdvances(ctx.companyId);
      await loadApprovals(ctx.companyId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to approve vendor advance.";
      setError(message || "Failed to approve vendor advance.");
    } finally {
      setPostingId(null);
    }
  };

  const handleRejectAdvance = async (advanceId: string) => {
    if (!ctx?.companyId) return;
    const comment = window.prompt("Rejection reason (optional):")?.trim() || null;
    setPostingId(advanceId);
    setError("");
    setNotice("");
    try {
      await apiPost(
        "/api/finance/approvals/reject",
        {
          companyId: ctx.companyId,
          entityType: "ap_advance",
          entityId: advanceId,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setNotice("Vendor advance rejected.");
      await loadApprovals(ctx.companyId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to reject vendor advance.";
      setError(message || "Failed to reject vendor advance.");
    } finally {
      setPostingId(null);
    }
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Vendor Advances"
          description="Create vendor advances, save drafts, and post to the ledger."
        />

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}
        {notice ? <div style={{ ...cardStyle, borderColor: "#86efac", color: "#166534" }}>{notice}</div> : null}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Create Vendor Advance</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              Vendor
              <select style={inputStyle} value={formVendorId} onChange={(e) => setFormVendorId(e.target.value)}>
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Advance Date
              <input style={inputStyle} type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Amount
              <input style={inputStyle} type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Reference
              <input style={inputStyle} value={formReference} onChange={(e) => setFormReference(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Payment Account
              <select
                style={inputStyle}
                value={formPaymentAccount}
                onChange={(e) => setFormPaymentAccount(e.target.value)}
              >
                <option value="">Select account</option>
                {paymentAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={primaryButtonStyle} onClick={handleCreateAdvance}>
              Save Draft
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              From
              <input style={inputStyle} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              To
              <input style={inputStyle} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Vendor
              <select style={inputStyle} value={selectedVendor} onChange={(e) => setSelectedVendor(e.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Status
              <select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved (Posted)</option>
                <option value="void">Void</option>
              </select>
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={secondaryButtonStyle} onClick={handleFilterApply}>
              Apply Filters
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          {loading ? (
            <p>Loading advances...</p>
          ) : advances.length === 0 ? (
            <p>No vendor advances found.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              {approvalLoading ? <p>Loading approvals…</p> : null}
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Advance Date</th>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Reference</th>
                    <th style={tableHeaderCellStyle}>Amount</th>
                    <th style={tableHeaderCellStyle}>Approval</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Journal Doc No</th>
                    <th style={tableHeaderCellStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map((advance) => (
                    <tr key={advance.advance_id}>
                      {(() => {
                        const approvalState = approvalMap[advance.advance_id]?.state ?? "draft";
                        return (
                          <>
                      <td style={tableCellStyle}>{advance.advance_date}</td>
                      <td style={tableCellStyle}>{advance.vendor_name || vendorMap.get(advance.vendor_id) || "—"}</td>
                      <td style={tableCellStyle}>{advance.reference || "—"}</td>
                      <td style={tableCellStyle}>{formatMoney(advance.amount)}</td>
                      <td style={tableCellStyle}>{approvalState}</td>
                      <td style={tableCellStyle}>{statusLabel(advance.status)}</td>
                      <td style={tableCellStyle}>{advance.journal_doc_no || "—"}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {advance.status === "draft" ? (
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {canBypass ? (
                              <button
                                type="button"
                                style={secondaryButtonStyle}
                                onClick={() => handlePostAdvance(advance)}
                                disabled={postingId === advance.advance_id}
                              >
                                {postingId === advance.advance_id ? "Posting…" : "Post"}
                              </button>
                            ) : approvalState === "submitted" ? (
                              <>
                                <button
                                  type="button"
                                  style={primaryButtonStyle}
                                  onClick={() => handleApproveAdvance(advance.advance_id)}
                                  disabled={postingId === advance.advance_id || !canWrite}
                                >
                                  {postingId === advance.advance_id ? "Approving…" : "Approve"}
                                </button>
                                <button
                                  type="button"
                                  style={secondaryButtonStyle}
                                  onClick={() => handleRejectAdvance(advance.advance_id)}
                                  disabled={postingId === advance.advance_id || !canWrite}
                                >
                                  Reject
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                style={secondaryButtonStyle}
                                onClick={() => handleSubmitAdvance(advance.advance_id)}
                                disabled={postingId === advance.advance_id || !canWrite}
                              >
                                {postingId === advance.advance_id ? "Submitting…" : "Submit"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#6b7280" }}>—</span>
                        )}
                      </td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
