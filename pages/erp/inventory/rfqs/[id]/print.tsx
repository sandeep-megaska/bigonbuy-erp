import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";
import { supabase } from "../../../../../lib/supabaseClient";

type Rfq = {
  id: string;
  rfq_no: string;
  vendor_id: string;
  requested_on: string;
  needed_by: string | null;
  deliver_to_warehouse_id: string | null;
  status: string;
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

type RfqLine = {
  id: string;
  variant_id: string;
  qty: number;
  notes: string | null;
};

type VariantOption = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  productTitle: string;
  styleCode: string | null;
  hsnCode: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
};

export default function RfqPrintPage() {
  const router = useRouter();
  const { id } = router.query;
  const branding = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [lines, setLines] = useState<RfqLine[]>([]);
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
    if (loading || !rfq || !branding?.loaded) return;
    if (!logoLoaded || !secondaryLogoLoaded) return;

    const timer = window.setTimeout(() => {
      window.print();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [loading, rfq, branding?.loaded, logoLoaded, secondaryLogoLoaded]);

  async function loadData(companyId: string, rfqId: string, isActiveFetch = true) {
    setError("");
    const rfqRes = await supabase
      .from("erp_rfq")
      .select("id, rfq_no, vendor_id, requested_on, needed_by, deliver_to_warehouse_id, status, notes")
      .eq("company_id", companyId)
      .eq("id", rfqId)
      .single();

    if (rfqRes.error) {
      if (isActiveFetch) setError(rfqRes.error.message);
      return;
    }

    const [lineRes, vendorRes, variantRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_rfq_lines")
        .select("id, variant_id, qty, notes")
        .eq("company_id", companyId)
        .eq("rfq_id", rfqId)
        .order("created_at", { ascending: true }),
      supabase
        .from("erp_vendors")
        .select(
          "id, legal_name, gstin, contact_person, phone, email, address, address_line1, address_line2, city, state, pincode, country"
        )
        .eq("company_id", companyId)
        .eq("id", rfqRes.data.vendor_id)
        .maybeSingle(),
      supabase
        .from("erp_variants")
        .select("id, sku, size, color, erp_products(title, style_code, hsn_code)")
        .eq("company_id", companyId)
        .order("sku"),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (lineRes.error || vendorRes.error || variantRes.error || warehouseRes.error) {
      if (isActiveFetch) {
        setError(
          lineRes.error?.message ||
            vendorRes.error?.message ||
            variantRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load RFQ."
        );
      }
      return;
    }

    if (isActiveFetch) {
      setRfq(rfqRes.data as Rfq);
      setVendor((vendorRes.data as Vendor) || null);
      setLines((lineRes.data || []) as RfqLine[]);
      const variantRows = (variantRes.data || []) as Array<{
        id: string;
        sku: string;
        size: string | null;
        color: string | null;
        erp_products?: { title?: string | null; style_code?: string | null; hsn_code?: string | null } | null;
      }>;
      setVariants(
        variantRows.map((row) => ({
          id: row.id,
          sku: row.sku,
          size: row.size ?? null,
          color: row.color ?? null,
          productTitle: row.erp_products?.title || "",
          styleCode: row.erp_products?.style_code ?? null,
          hsnCode: row.erp_products?.hsn_code ?? null,
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

  const deliveryWarehouse =
    warehouses.find((warehouse) => warehouse.id === rfq?.deliver_to_warehouse_id) || warehouses[0];

  return (
    <div style={printPageStyle} className="rfq-print-root">
      {error ? <div style={printErrorStyle}>{error}</div> : null}

      <div style={printHeaderRowStyle} className="rfq-print-section">
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
            <div style={printDocumentTitleStyle}>REQUEST FOR QUOTATION (RFQ)</div>
          </div>
        </div>
        <div style={printMetaCardStyle}>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>RFQ Number</span>
            <span style={printMetaValueStyle}>{rfq?.rfq_no || "—"}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Requested On</span>
            <span style={printMetaValueStyle}>{formatDate(rfq?.requested_on)}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Needed By</span>
            <span style={printMetaValueStyle}>{formatDate(rfq?.needed_by)}</span>
          </div>
          <div style={printMetaRowStyle}>
            <span style={printMetaLabelStyle}>Deliver To</span>
            <span style={printMetaValueStyle}>{deliveryWarehouse?.name || "—"}</span>
          </div>
          {rfq?.status ? (
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Status</span>
              <span style={{ ...printMetaValueStyle, color: "#6b7280", fontWeight: 500 }}>{rfq.status}</span>
            </div>
          ) : null}
        </div>
      </div>

      <section style={printSectionStyle} className="rfq-print-section">
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

      <section style={printSectionStyle} className="rfq-print-section">
        <table style={printTableStyle} className="rfq-print-table">
          <thead>
            <tr>
              <th style={printTableHeaderStyle}>Sl No</th>
              <th style={printTableHeaderStyle}>SKU</th>
              <th style={printTableHeaderStyle}>Style</th>
              <th style={printTableHeaderStyle}>HSN</th>
              <th style={printTableHeaderStyle}>Size</th>
              <th style={printTableHeaderStyle}>Color</th>
              <th style={printTableHeaderStyle}>Qty</th>
              <th style={printTableHeaderStyle}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td style={printTableCellStyle} colSpan={8}>
                  No line items found.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => {
                const variant = variantMap.get(line.variant_id);
                return (
                  <tr key={line.id}>
                    <td style={printTableCellStyle}>{index + 1}</td>
                    <td style={printTableCellStyle}>{variant?.sku || line.variant_id}</td>
                    <td style={printTableCellStyle}>{variant?.styleCode || "—"}</td>
                    <td style={printTableCellStyle}>{variant?.hsnCode || "—"}</td>
                    <td style={printTableCellStyle}>{variant?.size || "—"}</td>
                    <td style={printTableCellStyle}>{variant?.color || "—"}</td>
                    <td style={printTableCellStyle}>{line.qty}</td>
                    <td style={printTableCellStyle}>{line.notes || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {rfq?.notes ? (
        <section style={printSectionStyle} className="rfq-print-section">
          <div style={printSectionTitleStyle}>Notes</div>
          <div style={printDetailTextStyle}>{rfq.notes}</div>
        </section>
      ) : null}

      {termsLines.length > 0 ? (
        <section style={printSectionStyle} className="rfq-print-section">
          <div style={printSectionTitleStyle}>Terms &amp; Conditions</div>
          <ul style={printBulletListStyle}>
            {termsLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer style={printFooterStyle} className="rfq-print-footer">
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
          @page {
            margin: 0;
          }

          body {
            background: #fff;
            margin: 0;
          }

          .rfq-print-root {
            max-width: none;
            padding: 0;
          }

          .rfq-print-table {
            page-break-inside: auto;
          }

          .rfq-print-table thead {
            display: table-header-group;
          }

          .rfq-print-table tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .rfq-print-section,
          .rfq-print-footer {
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
  height: 32,
  width: "auto",
  objectFit: "contain" as const,
};

const printLogoFallbackStyle = {
  width: 96,
  height: 56,
  borderRadius: 8,
  backgroundColor: "#0f172a",
  color: "#fff",
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  letterSpacing: "0.12em",
};

const printCompanyNameStyle = {
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 4,
};

const printCompanySubTextStyle = {
  fontSize: 12,
  color: "#475569",
  marginBottom: 6,
};

const printCompanyAddressStyle = {
  fontSize: 12,
  color: "#475569",
  whiteSpace: "pre-line" as const,
  marginBottom: 10,
};

const printDocumentTitleStyle = {
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "#111827",
};

const printMetaCardStyle = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 16,
  minWidth: 220,
  backgroundColor: "#f8fafc",
};

const printMetaRowStyle = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 16,
  fontSize: 12,
  marginBottom: 8,
};

const printMetaLabelStyle = {
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  fontSize: 11,
};

const printMetaValueStyle = {
  fontWeight: 600,
  color: "#111827",
  textAlign: "right" as const,
};

const printSectionStyle = {
  marginBottom: 20,
};

const printSectionTitleStyle = {
  fontSize: 13,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "#475569",
  marginBottom: 12,
};

const printVendorGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const printVendorNameStyle = {
  fontSize: 15,
  fontWeight: 700,
  marginBottom: 6,
};

const printDetailLabelStyle = {
  fontSize: 12,
  fontWeight: 600,
  color: "#111827",
  marginBottom: 4,
};

const printDetailTextStyle = {
  fontSize: 12,
  color: "#475569",
  whiteSpace: "pre-line" as const,
  marginBottom: 4,
};

const printTableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  border: "1px solid #e2e8f0",
};

const printTableHeaderStyle = {
  textAlign: "left" as const,
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "#475569",
  padding: "10px 12px",
  borderBottom: "1px solid #e2e8f0",
  backgroundColor: "#f8fafc",
};

const printTableCellStyle = {
  fontSize: 12,
  padding: "10px 12px",
  borderBottom: "1px solid #e2e8f0",
  color: "#111827",
  verticalAlign: "top" as const,
};

const printBulletListStyle = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 12,
  color: "#475569",
  display: "grid",
  gap: 6,
};

const printFooterStyle = {
  borderTop: "1px solid #e2e8f0",
  paddingTop: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  marginTop: 24,
};

const printFooterTextStyle = {
  fontSize: 11,
  color: "#475569",
  whiteSpace: "pre-line" as const,
};
