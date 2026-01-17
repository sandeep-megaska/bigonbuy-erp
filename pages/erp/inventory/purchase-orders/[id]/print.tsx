import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";

type PurchaseOrder = {
  id: string;
  po_no: string;
  vendor_id: string;
  status: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
};

type Vendor = {
  id: string;
  legal_name: string;
  gstin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
};

type PurchaseOrderLine = {
  id: string;
  variant_id: string;
  ordered_qty: number;
  unit_cost: number | null;
};

type VariantOption = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  productTitle: string;
};

type WarehouseOption = {
  id: string;
  name: string;
};

export default function PurchaseOrderPrintPage() {
  const router = useRouter();
  const { id } = router.query;
  const branding = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const [secondaryLogoLoaded, setSecondaryLogoLoaded] = useState(false);

  const logoUrl = branding?.bigonbuyLogoUrl ?? null;
  const secondaryLogoUrl = branding?.megaskaLogoUrl ?? null;

  useEffect(() => {
    setLogoLoaded(!logoUrl);
  }, [logoUrl]);

  useEffect(() => {
    setSecondaryLogoLoaded(!secondaryLogoUrl);
  }, [secondaryLogoUrl]);

  useEffect(() => {
    if (!id) return;
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

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

  useEffect(() => {
    if (loading || !po || !branding?.loaded) return;
    if (!logoLoaded || !secondaryLogoLoaded) return;

    const timer = window.setTimeout(() => {
      window.print();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [loading, po, branding?.loaded, logoLoaded, secondaryLogoLoaded]);

  async function loadData(companyId: string, poId: string, isActiveFetch = true) {
    setError("");
    const [poRes, lineRes, vendorRes, variantRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_purchase_orders")
        .select("id, po_no, vendor_id, status, order_date, expected_delivery_date, notes")
        .eq("company_id", companyId)
        .eq("id", poId)
        .single(),
      supabase
        .from("erp_purchase_order_lines")
        .select("id, variant_id, ordered_qty, unit_cost")
        .eq("company_id", companyId)
        .eq("purchase_order_id", poId)
        .order("created_at", { ascending: true }),
      supabase
        .from("erp_vendors")
        .select(
          "id, legal_name, gstin, contact_person, phone, email, address, address_line1, address_line2, city, state, pincode, country"
        )
        .eq("company_id", companyId),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, erp_products(title)")
        .eq("company_id", companyId)
        .order("sku"),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (poRes.error || lineRes.error || vendorRes.error || variantRes.error || warehouseRes.error) {
      if (isActiveFetch) {
        setError(
          poRes.error?.message ||
            lineRes.error?.message ||
            vendorRes.error?.message ||
            variantRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load purchase order."
        );
      }
      return;
    }

    if (isActiveFetch) {
      setPo(poRes.data as PurchaseOrder);
      const vendorList = (vendorRes.data || []) as Vendor[];
      setVendor(vendorList.find((row) => row.id === poRes.data?.vendor_id) || null);
      setLines((lineRes.data || []) as PurchaseOrderLine[]);
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
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
    }
  }

  const variantMap = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString();
  };

  const currencyCode = branding?.currencyCode || "INR";

  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const subtotal = lines.reduce((sum, line) => {
    if (line.unit_cost === null) return sum;
    return sum + line.unit_cost * line.ordered_qty;
  }, 0);

  const companyLegalName = branding?.legalName || branding?.companyName || "Company";
  const companyAddressText = branding?.addressText || branding?.poFooterAddressText || "";
  const companyAddressLines = companyAddressText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const vendorAddressLines = [
    vendor?.address_line1 || vendor?.address || "",
    vendor?.address_line2 || "",
    [vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(", "),
    vendor?.country || "",
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const termsLines = (branding?.poTermsText || "")
    .split("\n")
    .map((line) => line.replace(/^[•*-]\s*/, "").trim())
    .filter(Boolean);

  const deliveryWarehouse = warehouses[0];

  return (
    <div style={printPageStyle}>
      {error ? <div style={printErrorStyle}>{error}</div> : null}
      <div style={printHeaderRowStyle} className="po-print-section">
        <div style={printBrandBlockStyle}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Bigonbuy logo"
              style={printLogoStyle}
              onLoad={() => setLogoLoaded(true)}
              onError={() => setLogoLoaded(true)}
            />
          ) : (
            <div style={printLogoFallbackStyle}>BIGONBUY</div>
          )}
          <div>
            <div style={printCompanyNameStyle}>{companyLegalName}</div>
            <div style={printCompanySubTextStyle}>GSTIN: {branding?.gstin || "—"}</div>
            <div style={printCompanyAddressStyle}>
              {companyAddressLines.length > 0 ? companyAddressLines.join("\n") : "—"}
            </div>
            <div style={printPoTitleStyle}>Purchase Order</div>
          </div>
        </div>
        <div style={printMetaCardStyle}>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>PO Number</span>
            <span style={printMetaValueStyle}>{po?.po_no || "—"}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>PO Date</span>
            <span style={printMetaValueStyle}>{formatDate(po?.order_date)}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Expected Delivery</span>
            <span style={printMetaValueStyle}>{formatDate(po?.expected_delivery_date)}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Deliver To</span>
            <span style={printMetaValueStyle}>{deliveryWarehouse?.name || "—"}</span>
          </div>
          {po?.status ? (
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Status</span>
              <span style={{ ...printMetaValueStyle, color: "#6b7280", fontWeight: 500 }}>{po.status}</span>
            </div>
          ) : null}
        </div>
      </div>

      <section style={printSectionStyle} className="po-print-section">
        <div style={printSectionTitleStyle}>Vendor</div>
        <div style={printVendorGridStyle}>
          <div>
            <div style={printVendorNameStyle}>{vendor?.legal_name || "—"}</div>
            <div style={printDetailTextStyle}>GSTIN: {vendor?.gstin || "—"}</div>
            <div style={printDetailTextStyle}>
              {vendorAddressLines.length > 0 ? vendorAddressLines.join("\n") : "—"}
            </div>
          </div>
          <div>
            <div style={printDetailLabelStyle}>Contact</div>
            <div style={printDetailTextStyle}>{vendor?.contact_person || "—"}</div>
            <div style={printDetailTextStyle}>Phone: {vendor?.phone || "—"}</div>
            <div style={printDetailTextStyle}>Email: {vendor?.email || "—"}</div>
          </div>
        </div>
      </section>

      <section style={printSectionStyle} className="po-print-section">
        <table style={printTableStyle} className="po-print-table">
          <thead>
            <tr>
              <th style={printTableHeaderStyle}>Sl No</th>
              <th style={printTableHeaderStyle}>SKU</th>
              <th style={printTableHeaderStyle}>Item</th>
              <th style={printTableHeaderStyle}>Variant</th>
              <th style={printTableHeaderStyle}>Qty</th>
              <th style={printTableHeaderStyle}>Unit Rate</th>
              <th style={printTableHeaderStyle}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td style={printTableCellStyle} colSpan={7}>
                  No line items found.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => {
                const variant = variantMap.get(line.variant_id);
                const variantLabel = [variant?.color, variant?.size].filter(Boolean).join(" / ") || "—";
                const lineTotal = line.unit_cost !== null ? line.unit_cost * line.ordered_qty : null;
                return (
                  <tr key={line.id}>
                    <td style={printTableCellStyle}>{index + 1}</td>
                    <td style={printTableCellStyle}>{variant?.sku || line.variant_id}</td>
                    <td style={printTableCellStyle}>{variant?.productTitle || "—"}</td>
                    <td style={printTableCellStyle}>{variantLabel}</td>
                    <td style={printTableCellStyle}>{line.ordered_qty}</td>
                    <td style={printTableCellStyle}>{formatMoney(line.unit_cost)}</td>
                    <td style={printTableCellStyle}>{formatMoney(lineTotal)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <section style={printTotalsSectionStyle} className="po-print-section">
        <div style={printTotalsRowStyle}>
          <span style={printMetaLabelStyle}>Subtotal</span>
          <span style={printTotalsValueStyle}>{formatMoney(subtotal)}</span>
        </div>
        <div style={{ ...printTotalsRowStyle, fontWeight: 700 }}>
          <span>Total Amount ({currencyCode})</span>
          <span style={printTotalsValueStyle}>{formatMoney(subtotal)}</span>
        </div>
      </section>

      {termsLines.length > 0 ? (
        <section style={printSectionStyle} className="po-print-section">
          <div style={printSectionTitleStyle}>Terms &amp; Conditions</div>
          <ul style={printBulletListStyle}>
            {termsLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section style={printSignatureRowStyle} className="po-print-section">
        <div style={printSignatureBlockStyle}>
          <div style={printSignatureLineStyle} />
          <div style={printSignatureLabelStyle}>Authorized Signatory</div>
        </div>
        <div style={printSignatureBlockStyle}>
          <div style={printSignatureLineStyle} />
          <div style={printSignatureLabelStyle}>Vendor Acceptance</div>
        </div>
      </section>

      <footer style={printFooterStyle} className="po-print-footer">
        <div style={printFooterTextStyle}>
          {companyAddressLines.length > 0 ? companyAddressLines.join("\n") : "—"}
          {"\n"}GSTIN: {branding?.gstin || "—"}
        </div>
        {secondaryLogoUrl ? (
          <img
            src={secondaryLogoUrl}
            alt="Megaska logo"
            style={printSecondaryLogoStyle}
            onLoad={() => setSecondaryLogoLoaded(true)}
            onError={() => setSecondaryLogoLoaded(true)}
          />
        ) : (
          <div style={printFooterTextStyle}>MEGASKA</div>
        )}
      </footer>

      <style jsx global>{`
        @media print {
          body {
            background: #fff;
          }

          .po-print-table {
            page-break-inside: auto;
          }

          .po-print-table thead {
            display: table-header-group;
          }

          .po-print-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .po-print-section,
          .po-print-footer {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}

const printPageStyle = {
  maxWidth: 980,
  margin: "0 auto",
  padding: "32px 24px",
  backgroundColor: "#ffffff",
  color: "#111827",
  fontFamily: "Inter, system-ui, sans-serif",
};

const printErrorStyle = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  fontSize: 12,
};

const printHeaderRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap" as const,
  marginBottom: 24,
};

const printBrandBlockStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 16,
  flex: "1 1 320px",
};

const printLogoStyle = {
  height: 56,
  width: "auto",
  objectFit: "contain" as const,
};

const printSecondaryLogoStyle = {
  height: 36,
  width: "auto",
  objectFit: "contain" as const,
};

const printLogoFallbackStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 56,
  padding: "0 16px",
  borderRadius: 10,
  backgroundColor: "#111827",
  color: "#fff",
  fontSize: 12,
  letterSpacing: "0.12em",
  fontWeight: 700,
};

const printCompanyNameStyle = {
  fontSize: 20,
  fontWeight: 700,
  color: "#111827",
};

const printCompanySubTextStyle = {
  fontSize: 12,
  color: "#4b5563",
  marginTop: 4,
};

const printCompanyAddressStyle = {
  marginTop: 6,
  fontSize: 12,
  color: "#4b5563",
  whiteSpace: "pre-line" as const,
};

const printPoTitleStyle = {
  marginTop: 10,
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  color: "#6b7280",
  fontWeight: 700,
};

const printMetaCardStyle = {
  minWidth: 240,
  padding: "12px 16px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  backgroundColor: "#f9fafb",
};

const printMetaRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  fontSize: 12,
  padding: "4px 0",
};

const printMetaLabelStyle = {
  color: "#6b7280",
};

const printMetaValueStyle = {
  fontWeight: 600,
  color: "#111827",
};

const printSectionStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "16px 18px",
  marginBottom: 20,
  backgroundColor: "#fff",
};

const printSectionTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: "#111827",
  marginBottom: 8,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

const printVendorGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const printVendorNameStyle = {
  fontSize: 15,
  fontWeight: 700,
  color: "#111827",
  marginBottom: 4,
};

const printDetailLabelStyle = {
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "#9ca3af",
  marginBottom: 6,
};

const printDetailTextStyle = {
  fontSize: 12,
  color: "#4b5563",
  whiteSpace: "pre-line" as const,
};

const printTableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 12,
};

const printTableHeaderStyle = {
  textAlign: "left" as const,
  backgroundColor: "#f3f4f6",
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 600,
};

const printTableCellStyle = {
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  verticalAlign: "top" as const,
};

const printTotalsSectionStyle = {
  marginLeft: "auto",
  maxWidth: 320,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "12px 16px",
  backgroundColor: "#f9fafb",
  marginBottom: 20,
};

const printTotalsRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  padding: "4px 0",
  fontSize: 13,
};

const printTotalsValueStyle = {
  fontWeight: 600,
};

const printBulletListStyle = {
  margin: "0 0 0 18px",
  padding: 0,
  fontSize: 12,
  color: "#4b5563",
};

const printSignatureRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 24,
  marginBottom: 24,
};

const printSignatureBlockStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
};

const printSignatureLineStyle = {
  height: 1,
  backgroundColor: "#111827",
  opacity: 0.3,
  marginTop: 24,
};

const printSignatureLabelStyle = {
  fontSize: 12,
  color: "#4b5563",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

const printFooterStyle = {
  borderTop: "1px solid #e5e7eb",
  paddingTop: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap" as const,
};

const printFooterTextStyle = {
  fontSize: 11,
  color: "#6b7280",
  whiteSpace: "pre-line" as const,
};
