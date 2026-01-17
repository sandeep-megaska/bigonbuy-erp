import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Rfq = {
  id: string;
  rfq_no: string;
  vendor_id: string;
  deliver_to_warehouse_id: string | null;
};

type Vendor = {
  id: string;
  legal_name: string;
};

type Variant = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  productTitle: string;
};

type RfqLine = {
  id: string;
  variant_id: string;
  qty: number;
};

type QuoteLineDraft = {
  variant_id: string;
  qty: string;
  unit_rate: string;
  gst_note: string;
  notes: string;
};

export default function QuoteCreatePage() {
  const router = useRouter();
  const { rfq: rfqId } = router.query;
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);

  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().split("T")[0]);
  const [validityUntil, setValidityUntil] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<QuoteLineDraft[]>([]);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    if (!rfqId) return;
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

      await loadData(context.companyId, rfqId as string, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, rfqId]);

  async function loadData(companyId: string, rfqValue: string, isActiveFetch = true) {
    setError("");
    const [rfqRes, lineRes, vendorRes, variantRes] = await Promise.all([
      supabase
        .from("erp_rfq")
        .select("id, rfq_no, vendor_id, deliver_to_warehouse_id")
        .eq("company_id", companyId)
        .eq("id", rfqValue)
        .single(),
      supabase
        .from("erp_rfq_lines")
        .select("id, variant_id, qty")
        .eq("company_id", companyId)
        .eq("rfq_id", rfqValue)
        .order("created_at", { ascending: true }),
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, erp_products(title)")
        .eq("company_id", companyId)
        .order("sku"),
    ]);

    if (rfqRes.error || lineRes.error || vendorRes.error || variantRes.error) {
      if (isActiveFetch) {
        setError(
          rfqRes.error?.message ||
            lineRes.error?.message ||
            vendorRes.error?.message ||
            variantRes.error?.message ||
            "Failed to load RFQ for quote."
        );
      }
      return;
    }

    if (isActiveFetch) {
      const rfqData = rfqRes.data as Rfq;
      setRfq(rfqData);
      const vendorList = (vendorRes.data || []) as Vendor[];
      setVendor(vendorList.find((row) => row.id === rfqData.vendor_id) || null);

      const variantRows = (variantRes.data || []) as Array<{
        id: string;
        sku: string;
        size: string | null;
        color: string | null;
        erp_products?: { title?: string | null } | null;
      }>;
      const variantsMapped = variantRows.map((row) => ({
        id: row.id,
        sku: row.sku,
        size: row.size ?? null,
        color: row.color ?? null,
        productTitle: row.erp_products?.title || "",
      }));
      setVariants(variantsMapped);

      const rfqLines = (lineRes.data || []) as RfqLine[];
      setLines(
        rfqLines.map((line) => ({
          variant_id: line.variant_id,
          qty: String(line.qty),
          unit_rate: "",
          gst_note: "",
          notes: "",
        }))
      );
    }
  }

  function updateLine(index: number, next: Partial<QuoteLineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...next } : line)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId || !rfq) return;
    if (!canWrite) {
      setError("Only owner/admin can create vendor quotes.");
      return;
    }

    const normalizedLines = lines
      .map((line) => ({
        variant_id: line.variant_id,
        qty: Number(line.qty),
        unit_rate: Number(line.unit_rate),
        gst_note: line.gst_note.trim() || null,
        notes: line.notes.trim() || null,
      }))
      .filter(
        (line) =>
          line.variant_id &&
          Number.isFinite(line.qty) &&
          line.qty > 0 &&
          Number.isFinite(line.unit_rate) &&
          line.unit_rate > 0
      );

    if (normalizedLines.length === 0) {
      setError("Add unit rates for each RFQ line to create a quote.");
      return;
    }

    setError("");
    const { data: quote, error: quoteError } = await supabase
      .from("erp_vendor_quotes")
      .insert({
        company_id: ctx.companyId,
        rfq_id: rfq.id,
        vendor_id: rfq.vendor_id,
        received_on: receivedOn,
        validity_until: validityUntil || null,
        lead_time_days: leadTimeDays ? Number(leadTimeDays) : null,
        payment_terms_days: paymentTermsDays ? Number(paymentTermsDays) : null,
        status: "received",
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (quoteError) {
      setError(quoteError.message);
      return;
    }

    const { error: lineError } = await supabase.from("erp_vendor_quote_lines").insert(
      normalizedLines.map((line) => ({
        company_id: ctx.companyId,
        quote_id: quote.id,
        variant_id: line.variant_id,
        qty: line.qty,
        unit_rate: line.unit_rate,
        gst_note: line.gst_note,
        notes: line.notes,
      }))
    );

    if (lineError) {
      setError(lineError.message);
      return;
    }

    router.push(`/erp/inventory/quotes/${quote.id}`);
  }

  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const formatVariantLabel = (variantId: string) => {
    const variant = variantMap.get(variantId);
    if (!variant) return "";
    const details = [variant.color, variant.size].filter(Boolean).join(" / ");
    return `${variant.sku} — ${variant.productTitle}${details ? ` (${details})` : ""}`;
  };

  if (!rfqId) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Select an RFQ to create a quote.</div>
      </ErpShell>
    );
  }

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading quote form…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>New Quote</h1>
            <p style={subtitleStyle}>Create a vendor quotation from RFQ {rfq?.rfq_no || ""}.</p>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section style={cardStyle}>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Vendor</div>
                <div style={{ fontWeight: 600 }}>{vendor?.legal_name || "—"}</div>
              </div>
              <label style={{ display: "grid", gap: 6 }}>
                Received On
                <input
                  style={inputStyle}
                  type="date"
                  value={receivedOn}
                  onChange={(event) => setReceivedOn(event.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Validity Until
                <input
                  style={inputStyle}
                  type="date"
                  value={validityUntil}
                  onChange={(event) => setValidityUntil(event.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Lead Time (days)
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  value={leadTimeDays}
                  onChange={(event) => setLeadTimeDays(event.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Payment Terms (days)
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  value={paymentTermsDays}
                  onChange={(event) => setPaymentTermsDays(event.target.value)}
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              Notes
              <textarea
                style={{ ...inputStyle, minHeight: 90 }}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Quote Lines</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>SKU</th>
                    <th style={tableHeaderCellStyle}>Qty</th>
                    <th style={tableHeaderCellStyle}>Unit Rate</th>
                    <th style={tableHeaderCellStyle}>GST Note</th>
                    <th style={tableHeaderCellStyle}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.variant_id}-${index}`}>
                      <td style={tableCellStyle}>{formatVariantLabel(line.variant_id)}</td>
                      <td style={tableCellStyle}>{line.qty}</td>
                      <td style={tableCellStyle}>
                        <input
                          style={inputStyle}
                          type="number"
                          min="0"
                          value={line.unit_rate}
                          onChange={(event) => updateLine(index, { unit_rate: event.target.value })}
                        />
                      </td>
                      <td style={tableCellStyle}>
                        <input
                          style={inputStyle}
                          value={line.gst_note}
                          onChange={(event) => updateLine(index, { gst_note: event.target.value })}
                        />
                      </td>
                      <td style={tableCellStyle}>
                        <input
                          style={inputStyle}
                          value={line.notes}
                          onChange={(event) => updateLine(index, { notes: event.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canWrite}>
                Save Quote
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => rfq && router.push(`/erp/inventory/rfqs/${rfq.id}`)}
              >
                Back to RFQ
              </button>
            </div>
          </form>
        </section>
      </div>
    </ErpShell>
  );
}
