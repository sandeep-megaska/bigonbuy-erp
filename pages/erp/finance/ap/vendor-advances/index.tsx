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
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { vendorAdvanceCreate, vendorAdvancePost } from "../../../../../lib/erp/vendorBills";
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
  posted_doc_no: string | null;
  is_void: boolean;
};

type VendorAdvanceRecord = {
  id: string;
  vendor_id: string;
  advance_date: string;
  amount: number;
  status: string;
  reference: string | null;
  payment_instrument_id: string | null;
  finance_journal_id: string | null;
  is_void: boolean;
  vendor?: { legal_name: string }[] | null;
  journal?: { doc_no: string | null }[] | null;
};

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

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v.legal_name])), [vendors]);

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

      await Promise.all([loadVendors(context.companyId), loadPaymentAccounts(), loadAdvances(context.companyId)]);
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

  const loadAdvances = async (companyId: string) => {
    setError("");
    let query = supabase
      .from("erp_ap_vendor_advances")
      .select(
        `
          id,
          vendor_id,
          advance_date,
          amount,
          status,
          reference,
          payment_instrument_id,
          finance_journal_id,
          is_void,
          vendor:erp_vendors (legal_name),
          journal:erp_fin_journals (doc_no)
        `,
      )
      .eq("company_id", companyId)
      .gte("advance_date", fromDate)
      .lte("advance_date", toDate)
      .order("advance_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (selectedVendor) {
      query = query.eq("vendor_id", selectedVendor);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error: loadError } = await query;

    if (loadError) {
      setError(loadError.message || "Failed to load vendor advances.");
      return;
    }

    const rows = (data || []) as VendorAdvanceRecord[];

    const mapped = rows.map((row) => ({
      advance_id: row.id,
      vendor_id: row.vendor_id,
      vendor_name: row.vendor?.[0]?.legal_name || vendorMap.get(row.vendor_id) || "",
      advance_date: row.advance_date,
      amount: Number(row.amount || 0),
      status: row.status,
      reference: row.reference,
      payment_instrument_id: row.payment_instrument_id,
      posted_doc_no: row.journal?.[0]?.doc_no ?? null,
      is_void: row.is_void,
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
    const { data, error: postError } = await vendorAdvancePost(advance.advance_id);

    if (postError) {
      setPostingId(null);
      setError(postError.message || "Failed to post vendor advance.");
      return;
    }

    const postedDocNo = (data as { doc_no?: string | null } | null)?.doc_no ?? null;
    setNotice(postedDocNo ? `Approved journal ${postedDocNo}.` : "Vendor advance approved.");

    if (ctx?.companyId) {
      await loadAdvances(ctx.companyId);
    }

    setPostingId(null);
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
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Advance Date</th>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Reference</th>
                    <th style={tableHeaderCellStyle}>Amount</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Journal Doc No</th>
                    <th style={tableHeaderCellStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.map((advance) => (
                    <tr key={advance.advance_id}>
                      <td style={tableCellStyle}>{advance.advance_date}</td>
                      <td style={tableCellStyle}>{advance.vendor_name || vendorMap.get(advance.vendor_id) || "—"}</td>
                      <td style={tableCellStyle}>{advance.reference || "—"}</td>
                      <td style={tableCellStyle}>{formatMoney(advance.amount)}</td>
                      <td style={tableCellStyle}>{statusLabel(advance.status)}</td>
                      <td style={tableCellStyle}>{advance.posted_doc_no || "—"}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {advance.status === "draft" ? (
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => handlePostAdvance(advance)}
                            disabled={postingId === advance.advance_id}
                          >
                            {postingId === advance.advance_id ? "Posting…" : "Post"}
                          </button>
                        ) : (
                          <span style={{ color: "#6b7280" }}>—</span>
                        )}
                      </td>
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
