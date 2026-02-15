import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { invoiceListResponseSchema, type InvoiceListRow } from "../../../../lib/erp/invoices";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

const startOfMonth = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return first.toISOString().slice(0, 10);
};

const statusBadgeStyle = (status: string) => {
  if (status === "issued") {
    return { ...badgeStyle, backgroundColor: "#ecfeff", color: "#0e7490" };
  }
  if (status === "cancelled") {
    return { ...badgeStyle, backgroundColor: "#fee2e2", color: "#b91c1c" };
  }
  return { ...badgeStyle, backgroundColor: "#f1f5f9", color: "#0f172a" };
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function InvoiceListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [status, setStatus] = useState("");
  const [docNoQuery, setDocNoQuery] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      if (!router.isReady) return;
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

      await loadInvoices({ initialFrom: startOfMonth(), initialTo: today() });
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const loadInvoices = async (overrides?: { initialFrom?: string; initialTo?: string }) => {
    setIsLoading(true);
    setError(null);

    const effectiveFrom = overrides?.initialFrom ?? fromDate;
    const effectiveTo = overrides?.initialTo ?? toDate;

    let query = supabase
      .from("erp_invoices")
      .select("id, doc_no, status, invoice_date, customer_name, subtotal, tax_total, total, issued_at, created_at")
      .order("invoice_date", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    if (effectiveFrom) {
      query = query.gte("invoice_date", effectiveFrom);
    }

    if (effectiveTo) {
      query = query.lte("invoice_date", effectiveTo);
    }

    if (docNoQuery) {
      query = query.ilike("doc_no", `%${docNoQuery}%`);
    }

    if (customerQuery) {
      query = query.ilike("customer_name", `%${customerQuery}%`);
    }

    const { data, error: listError } = await query;

    if (listError) {
      setError(listError.message);
      setIsLoading(false);
      return;
    }

    const parsed = invoiceListResponseSchema.safeParse(data ?? []);
    if (!parsed.success) {
      setError("Failed to parse invoice list.");
      setIsLoading(false);
      return;
    }

    setInvoices(parsed.data);
    setIsLoading(false);
  };

  const totals = useMemo(
    () => invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
    [invoices]
  );

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading invoices…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>{error || "No company membership found."}</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Invoices"
          description="Create, issue, and track customer invoices."
          rightActions={
            canWrite ? (
              <Link href="/erp/finance/invoices/new" style={primaryButtonStyle}>
                New Invoice
              </Link>
            ) : undefined
          }
        />

        <div style={cardStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>Doc Number</span>
              <input
                value={docNoQuery}
                onChange={(event) => setDocNoQuery(event.target.value)}
                placeholder="FY25-26/INV/000001"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>Customer</span>
              <input
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder="Customer name"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)} style={inputStyle}>
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="issued">Issued</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>From</span>
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#4b5563" }}>To</span>
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} style={inputStyle} />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => loadInvoices()}
              style={primaryButtonStyle}
              disabled={isLoading}
            >
              {isLoading ? "Loading…" : "Apply Filters"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStatus("");
                setDocNoQuery("");
                setCustomerQuery("");
                setFromDate(startOfMonth());
                setToDate(today());
                loadInvoices({ initialFrom: startOfMonth(), initialTo: today() });
              }}
              style={secondaryButtonStyle}
            >
              Reset
            </button>
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Doc No</th>
                <th style={tableHeaderCellStyle}>Customer</th>
                <th style={tableHeaderCellStyle}>Invoice Date</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No invoices found.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/finance/invoices/${invoice.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                        {invoice.doc_no || "Draft"}
                      </Link>
                    </td>
                    <td style={tableCellStyle}>{invoice.customer_name}</td>
                    <td style={tableCellStyle}>{invoice.invoice_date}</td>
                    <td style={tableCellStyle}>
                      <span style={statusBadgeStyle(invoice.status)}>{invoice.status}</span>
                    </td>
                    <td style={tableCellStyle}>{formatMoney(invoice.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 12, color: "#4b5563" }}>Total billed: {formatMoney(totals)}</p>
      </div>
    </>
  );
}
