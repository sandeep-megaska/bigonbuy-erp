import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
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
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Quote = {
  id: string;
  quote_no: string;
  rfq_id: string;
  vendor_id: string;
  received_on: string;
  validity_until: string | null;
  lead_time_days: number | null;
  payment_terms_days: number | null;
  status: string;
  notes: string | null;
};

type QuoteLine = {
  id: string;
  variant_id: string;
  qty: number;
  unit_rate: number;
  gst_note: string | null;
  notes: string | null;
};

type Vendor = {
  id: string;
  legal_name: string;
};

type Rfq = {
  id: string;
  rfq_no: string;
  deliver_to_warehouse_id: string | null;
};

type Variant = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  productTitle: string;
};

export default function QuoteDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    if (!id) return;
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

      await loadData(context.companyId, id as string, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  async function loadData(companyId: string, quoteId: string, isActiveFetch = true) {
    setError("");
    setNotice("");
    const [quoteRes, lineRes, vendorRes, rfqRes, variantRes] = await Promise.all([
      supabase
        .from("erp_vendor_quotes")
        .select(
          "id, quote_no, rfq_id, vendor_id, received_on, validity_until, lead_time_days, payment_terms_days, status, notes"
        )
        .eq("company_id", companyId)
        .eq("id", quoteId)
        .single(),
      supabase
        .from("erp_vendor_quote_lines")
        .select("id, variant_id, qty, unit_rate, gst_note, notes")
        .eq("company_id", companyId)
        .eq("quote_id", quoteId)
        .order("created_at", { ascending: true }),
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId),
      supabase.from("erp_rfq").select("id, rfq_no, deliver_to_warehouse_id").eq("company_id", companyId),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, erp_products(title)")
        .eq("company_id", companyId)
        .order("sku"),
    ]);

    if (quoteRes.error || lineRes.error || vendorRes.error || rfqRes.error || variantRes.error) {
      if (isActiveFetch) {
        setError(
          quoteRes.error?.message ||
            lineRes.error?.message ||
            vendorRes.error?.message ||
            rfqRes.error?.message ||
            variantRes.error?.message ||
            "Failed to load quote."
        );
      }
      return;
    }

    if (isActiveFetch) {
      const quoteData = quoteRes.data as Quote;
      setQuote(quoteData);
      setLines((lineRes.data || []) as QuoteLine[]);
      const vendorList = (vendorRes.data || []) as Vendor[];
      setVendor(vendorList.find((row) => row.id === quoteData.vendor_id) || null);
      const rfqList = (rfqRes.data || []) as Rfq[];
      setRfq(rfqList.find((row) => row.id === quoteData.rfq_id) || null);
      const variantRows = (variantRes.data || []) as Array<{
        id: string;
        sku: string;
        size: string | null;
        color: string | null;
        erp_products?: { title?: string | null } | null;
      }>;
      setVariants(
        variantRows.map((row) => ({
          id: row.id,
          sku: row.sku,
          size: row.size ?? null,
          color: row.color ?? null,
          productTitle: row.erp_products?.title || "",
        }))
      );
    }
  }

  async function handleUpdateStatus(nextStatus: string) {
    if (!ctx?.companyId || !quote) return;
    if (!canWrite) {
      setError("Only owner/admin can update quote status.");
      return;
    }

    setError("");
    const { error: updateError } = await supabase.rpc("erp_inventory_vendor_quote_update_status", {
      p_quote_id: quote.id,
      p_status: nextStatus,
    });

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadData(ctx.companyId, quote.id);
  }

  async function handleCreatePo() {
    if (!ctx?.companyId || !quote) return;
    if (!canWrite) {
      setError("Only owner/admin can create purchase orders.");
      return;
    }
    if (quote.status !== "accepted") {
      setError("Accept the quote before creating a purchase order.");
      return;
    }

    setError("");
    const { data: poId, error: poError } = await supabase.rpc("erp_po_create_draft", {
      p_vendor_id: quote.vendor_id,
      p_status: "draft",
      p_order_date: new Date().toISOString().split("T")[0],
      p_expected_delivery_date: null,
      p_notes: null,
      p_deliver_to_warehouse_id: rfq?.deliver_to_warehouse_id || null,
      p_rfq_id: quote.rfq_id,
      p_vendor_quote_id: quote.id,
      p_quote_ref_no: quote.quote_no,
    });

    if (poError) {
      setError(poError.message);
      return;
    }

    if (typeof poId !== "string") {
      setError("Failed to parse purchase order id.");
      return;
    }

    const { error: lineError } = await supabase.rpc("erp_inventory_purchase_order_lines_insert", {
      p_purchase_order_id: poId,
      p_lines: lines.map((line) => ({
        variant_id: line.variant_id,
        ordered_qty: line.qty,
        unit_cost: line.unit_rate,
      })),
    });

    if (lineError) {
      setError(lineError.message);
      return;
    }

    setNotice("Purchase order draft created.");
    router.push(`/erp/inventory/purchase-orders/${poId}`);
  }

  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const formatVariantLabel = (variantId: string) => {
    const variant = variantMap.get(variantId);
    if (!variant) return "";
    const details = [variant.color, variant.size].filter(Boolean).join(" / ");
    return `${variant.sku} — ${variant.productTitle}${details ? ` (${details})` : ""}`;
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading quote…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>Quote {quote?.quote_no || ""}</h1>
            <p style={subtitleStyle}>Review vendor quote details before issuing a PO.</p>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}
        {notice ? <div style={{ ...cardStyle, borderColor: "#86efac", color: "#166534" }}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Vendor</div>
              <div style={{ fontWeight: 600 }}>{vendor?.legal_name || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>RFQ</div>
              <div style={{ fontWeight: 600 }}>{rfq?.rfq_no || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Status</div>
              <div style={{ fontWeight: 600 }}>{quote?.status || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Received On</div>
              <div style={{ fontWeight: 600 }}>
                {quote?.received_on ? new Date(quote.received_on).toLocaleDateString() : "—"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Validity</div>
              <div style={{ fontWeight: 600 }}>
                {quote?.validity_until ? new Date(quote.validity_until).toLocaleDateString() : "—"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Lead Time (days)</div>
              <div style={{ fontWeight: 600 }}>{quote?.lead_time_days ?? "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Payment Terms (days)</div>
              <div style={{ fontWeight: 600 }}>{quote?.payment_terms_days ?? "—"}</div>
            </div>
          </div>
          {quote?.notes ? <p style={{ marginTop: 12, color: "#4b5563" }}>{quote.notes}</p> : null}
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Quote Lines</h2>
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
              {lines.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No quote lines found.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id}>
                    <td style={tableCellStyle}>{formatVariantLabel(line.variant_id) || line.variant_id}</td>
                    <td style={tableCellStyle}>{line.qty}</td>
                    <td style={tableCellStyle}>{line.unit_rate}</td>
                    <td style={tableCellStyle}>{line.gst_note || "—"}</td>
                    <td style={tableCellStyle}>{line.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Actions</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={!canWrite || quote?.status === "accepted"}
              onClick={() => handleUpdateStatus("accepted")}
            >
              Accept Quote
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={!canWrite || quote?.status === "rejected"}
              onClick={() => handleUpdateStatus("rejected")}
            >
              Reject Quote
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={!canWrite || quote?.status !== "accepted"}
              onClick={handleCreatePo}
            >
              Create PO from Quote
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
