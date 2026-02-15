import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { ErpBadge, ErpButton, ErpCard, ErpTable } from "../../../../../components/erp/ui";
import { inputStyle, pageContainerStyle, subtitleStyle } from "../../../../../components/erp/uiStyles";
import { td, th, trHover } from "../../../../../components/erp/tw";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

const today = () => new Date().toISOString().slice(0, 10);
const last90Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

type InvoiceRow = {
  invoice_id: string;
  customer_id: string;
  customer_name: string | null;
  doc_no: string | null;
  invoice_date: string | null;
  invoice_total: number | null;
  allocated_total: number | null;
  outstanding_amount: number | null;
  currency: string | null;
  status: string | null;
};
type CreditRow = {
  credit_id: string;
  customer_id: string;
  customer_name: string | null;
  credit_date: string | null;
  credit_amount: number | null;
  allocated_total: number | null;
  unallocated_amount: number | null;
  currency: string | null;
  reference_no: string | null;
  note: string | null;
  source: string | null;
};

type AllocationRow = {
  allocation_id: string;
  amount: number;
  status: string;
  comment: string | null;
  alloc_date: string;
  from_entity_id: string;
};

const formatDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB") : "—");
const formatAmount = (v: number | null, c: string | null) =>
  v == null ? "—" : `${c || "INR"} ${Number(v).toLocaleString("en-IN")}`;

export default function ArOutstandingPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => last90Days(), []);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(start);
  const [toDate, setToDate] = useState(end);
  const [query, setQuery] = useState("");
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>([]);
  const [creditRows, setCreditRows] = useState<CreditRow[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null);
  const [allocationAmount, setAllocationAmount] = useState("");
  const [allocationDate, setAllocationDate] = useState(today());
  const [allocationNote, setAllocationNote] = useState("");
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);

  const selectedInvoice = invoiceRows.find((x) => x.invoice_id === selectedInvoiceId) || null;
  const selectedCredit = creditRows.find((x) => x.credit_id === selectedCreditId) || null;

  useEffect(() => {
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session) return;
      const context = await getCompanyContext(session);
      setCtx(context);
      setLoading(false);
    })();
  }, [router]);

  const loadData = async () => {
    if (!ctx?.companyId) return;
    setError(null);
    const [{ data: inv, error: invErr }, { data: cr, error: crErr }] = await Promise.all([
      supabase.rpc("erp_ar_invoices_outstanding_list", {
        p_customer_id: null,
        p_from: fromDate,
        p_to: toDate,
        p_q: query || null,
        p_limit: 200,
        p_offset: 0,
      }),
      supabase.rpc("erp_ar_credits_unallocated_list", {
        p_customer_id: null,
        p_from: fromDate,
        p_to: toDate,
        p_q: query || null,
        p_limit: 200,
        p_offset: 0,
      }),
    ]);
    if (invErr || crErr) {
      setError(invErr?.message || crErr?.message || "Failed loading AR outstanding");
      return;
    }
    setInvoiceRows((inv || []) as InvoiceRow[]);
    setCreditRows((cr || []) as CreditRow[]);
  };

  const loadAllocations = async (invoiceId: string) => {
    if (!ctx?.companyId) return;
    const { data, error: listErr } = await supabase.rpc("erp_fin_allocations_list", {
      p_company_id: ctx.companyId,
      p_to_entity_type: "customer_invoice",
      p_to_entity_id: invoiceId,
      p_from_entity_type: null,
      p_from_entity_id: null,
    });
    if (listErr) {
      setError(listErr.message || "Failed loading allocations");
      return;
    }
    setAllocations((data || []) as AllocationRow[]);
  };

  useEffect(() => {
    loadData();
  }, [ctx?.companyId]);

  useEffect(() => {
    if (selectedInvoiceId) loadAllocations(selectedInvoiceId);
  }, [selectedInvoiceId]);

  const handleAllocate = async () => {
    if (!ctx?.companyId || !selectedInvoice || !selectedCredit) return;
    const amount = Number(allocationAmount);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter valid amount");
    const { error: allocErr } = await supabase.rpc("erp_fin_allocations_create", {
      p_company_id: ctx.companyId,
      p_from_entity_type: "customer_note",
      p_from_entity_id: selectedCredit.credit_id,
      p_to_entity_type: "customer_invoice",
      p_to_entity_id: selectedInvoice.invoice_id,
      p_amount: amount,
      p_comment: allocationNote || null,
    });
    if (allocErr) return setError(allocErr.message || "Allocation failed");
    setAllocationAmount("");
    setAllocationDate(today());
    setAllocationNote("");
    await loadData();
    await loadAllocations(selectedInvoice.invoice_id);
  };

  if (loading) return <div style={pageContainerStyle}>Loading…</div>;

  return (
    <div style={pageContainerStyle}>
      <ErpPageHeader
        eyebrow="Finance"
        title="AR Outstanding"
        description="Allocate customer credit notes against open customer invoices."
      />
      {error ? <ErpBadge tone="danger">{error}</ErpBadge> : null}
      <ErpCard>
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            From
            <input style={inputStyle} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            To
            <input style={inputStyle} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label>
            Search
            <input style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ErpButton onClick={loadData}>Refresh</ErpButton>
        </div>
      </ErpCard>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
        <ErpCard title="Invoices">
          <ErpTable>
            <thead>
              <tr>
                <th className={th}>Doc</th>
                <th className={th}>Customer</th>
                <th className={th}>Date</th>
                <th className={th}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {invoiceRows.map((r) => (
                <tr
                  key={r.invoice_id}
                  onClick={() => setSelectedInvoiceId(r.invoice_id)}
                  className={trHover}
                  style={{ cursor: "pointer", background: r.invoice_id === selectedInvoiceId ? "#eff6ff" : "transparent" }}
                >
                  <td className={td}>{r.doc_no || "—"}</td>
                  <td className={td}>{r.customer_name || "—"}</td>
                  <td className={td}>{formatDate(r.invoice_date)}</td>
                  <td className={td}>{formatAmount(r.outstanding_amount, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </ErpTable>
        </ErpCard>
        <ErpCard title="Credits (CN)">
          <ErpTable>
            <thead>
              <tr>
                <th className={th}>Ref</th>
                <th className={th}>Customer</th>
                <th className={th}>Date</th>
                <th className={th}>Unallocated</th>
              </tr>
            </thead>
            <tbody>
              {creditRows.map((r) => (
                <tr
                  key={r.credit_id}
                  onClick={() => setSelectedCreditId(r.credit_id)}
                  className={trHover}
                  style={{ cursor: "pointer", background: r.credit_id === selectedCreditId ? "#eff6ff" : "transparent" }}
                >
                  <td className={td}>{r.reference_no || "—"}</td>
                  <td className={td}>{r.customer_name || "—"}</td>
                  <td className={td}>{formatDate(r.credit_date)}</td>
                  <td className={td}>{formatAmount(r.unallocated_amount, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </ErpTable>
        </ErpCard>
      </div>

      <ErpCard title="Allocate">
        <p style={subtitleStyle}>
          {selectedInvoice ? `Invoice ${selectedInvoice.doc_no}` : "Select invoice"} ·{" "}
          {selectedCredit ? `Credit ${selectedCredit.reference_no}` : "Select credit"}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            Amount
            <input style={inputStyle} value={allocationAmount} onChange={(e) => setAllocationAmount(e.target.value)} />
          </label>
          <label>
            Date
            <input style={inputStyle} type="date" value={allocationDate} onChange={(e) => setAllocationDate(e.target.value)} />
          </label>
          <label>
            Note
            <input style={inputStyle} value={allocationNote} onChange={(e) => setAllocationNote(e.target.value)} />
          </label>
          <ErpButton variant="secondary" onClick={handleAllocate} disabled={!selectedInvoice || !selectedCredit}>
            Allocate
          </ErpButton>
        </div>
        <h4 style={{ marginTop: 16 }}>Allocations</h4>
        {allocations.length === 0 ? (
          <p style={subtitleStyle}>No allocations</p>
        ) : (
          <ErpTable>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Amount</th>
                <th className={th}>Status</th>
                <th className={th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.allocation_id} className={trHover}>
                  <td className={td}>{formatDate(a.alloc_date)}</td>
                  <td className={td}>{formatAmount(a.amount, "INR")}</td>
                  <td className={td}>{a.status}</td>
                  <td className={td}>{a.comment || "—"}</td>
                </tr>
              ))}
            </tbody>
          </ErpTable>
        )}
      </ErpCard>
    </div>
  );
}
