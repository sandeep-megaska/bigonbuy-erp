import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";
import { useCompanyBranding } from "../../../../../lib/erp/useCompanyBranding";
import { noteGetSchema, type NoteGetPayload } from "../../../../../lib/erp/notes";

type PartyDetails = {
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

type Issue = {
  path: string;
  message: string;
};

export default function NotePrintPage() {
  const router = useRouter();
  const { id } = router.query;
  const branding = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorIssues, setErrorIssues] = useState<Issue[]>([]);
  const [note, setNote] = useState<NoteGetPayload | null>(null);
  const [party, setParty] = useState<PartyDetails | null>(null);
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

      await loadData(id as string, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  useEffect(() => {
    if (loading || !note || !branding?.loaded) return;
    if (!logoLoaded || !secondaryLogoLoaded) return;

    let active = true;
    let timer: number | undefined;

    const waitForPrint = async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // Ignore font loading failures; still attempt to print.
        }
      }

      if (!active) return;
      timer = window.setTimeout(() => {
        if (active) window.print();
      }, 500);
    };

    waitForPrint();

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [loading, note, branding?.loaded, logoLoaded, secondaryLogoLoaded]);

  async function loadData(noteId: string, isActiveFetch = true) {
    setError("");
    setErrorIssues([]);
    const { data, error: noteError } = await supabase.rpc("erp_note_get", {
      p_note_id: noteId,
    });

    if (noteError) {
      if (isActiveFetch) setError(noteError.message || "Failed to load note.");
      return;
    }

    const parsed = noteGetSchema.safeParse(data);
    if (!parsed.success) {
      if (isActiveFetch) setError("Failed to parse note payload.");
      return;
    }

    if (isActiveFetch) {
      setNote(parsed.data);
    }

    if (parsed.data.note.party_type === "vendor" && parsed.data.note.party_id) {
      const vendorRes = await supabase
        .from("erp_vendors")
        .select(
          "id, legal_name, gstin, contact_person, phone, email, address, address_line1, address_line2, city, state, pincode, country"
        )
        .eq("id", parsed.data.note.party_id)
        .maybeSingle();

      if (vendorRes.error) {
        if (isActiveFetch) setError(vendorRes.error.message || "Failed to load vendor.");
        return;
      }

      if (isActiveFetch) {
        setParty((vendorRes.data || null) as PartyDetails | null);
      }
    } else if (isActiveFetch) {
      setParty(null);
    }
  }

  const noteHeader = note?.note;
  const lines = note?.lines ?? [];

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("en-IN");
  };

  const currencyCode = branding?.currencyCode || noteHeader?.currency || "INR";

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(round2(value));
  };

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const qty = line.qty ?? 0;
        const unitRate = line.unit_rate ?? 0;
        const taxRate = line.tax_rate ?? 0;
        const lineSubtotal = round2(line.line_subtotal ?? qty * unitRate);
        const lineTax = round2(line.line_tax ?? lineSubtotal * (taxRate / 100));
        const lineTotal = round2(line.line_total ?? lineSubtotal + lineTax);
        return {
          subtotal: acc.subtotal + lineSubtotal,
          tax_total: acc.tax_total + lineTax,
          total: acc.total + lineTotal,
        };
      },
      { subtotal: 0, tax_total: 0, total: 0 }
    );
  }, [lines]);

  const companyLegalName = branding?.legalName || branding?.companyName || "Company";
  const companyAddressText = branding?.addressText || branding?.poFooterAddressText || "";
  const companyAddressLines = companyAddressText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const partyName = party?.legal_name || noteHeader?.party_name || "—";
  const partyAddressLines = [
    party?.address_line1 || party?.address || "",
    party?.address_line2 || "",
    [party?.city, party?.state, party?.pincode].filter(Boolean).join(", "),
    party?.country || "",
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const noteTitle =
    noteHeader?.note_kind === "credit" ? "Credit Note" : noteHeader?.note_kind === "debit" ? "Debit Note" : "Note";
  const partyLabel = noteHeader?.party_type === "customer" ? "Customer" : "Vendor";

  const roundedSubtotal = round2(noteHeader?.subtotal ?? totals.subtotal);
  const roundedTax = round2(noteHeader?.tax_total ?? totals.tax_total);
  const roundedTotal = round2(noteHeader?.total ?? totals.total);
  const computedTotal = round2(roundedSubtotal + roundedTax);
  const roundOff = round2(roundedTotal - computedTotal);
  const noteDocNo = noteHeader?.note_number || "";

  return (
    <div style={printPageStyle} className="note-print note-print-root">
      <div className="note-sheet print-page">
        {error ? (
          <div style={printErrorStyle}>
            <div>{error}</div>
            {errorIssues.length > 0 ? (
              <ul style={printErrorListStyle}>
                {errorIssues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    {issue.path || "note"}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <header style={printHeaderRowStyle} className="note-header">
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
              <div style={printDocTitleStyle}>{noteTitle.toUpperCase()}</div>
            </div>
          </div>
          <div style={printMetaCardStyle}>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Note Number</span>
              <span style={printMetaValueStyle}>{noteDocNo}</span>
            </div>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Date</span>
              <span style={printMetaValueStyle}>{formatDate(noteHeader?.note_date)}</span>
            </div>
            <div style={printMetaRowStyle}>
              <span style={printMetaLabelStyle}>Party</span>
              <span style={printMetaValueStyle}>{partyLabel}</span>
            </div>
            {noteHeader?.status ? (
              <div style={printMetaRowStyle}>
                <span style={printMetaLabelStyle}>Status</span>
                <span style={{ ...printMetaValueStyle, color: "#6b7280", fontWeight: 500 }}>
                  {noteHeader.status}
                </span>
              </div>
            ) : null}
            {noteHeader?.source_type || noteHeader?.source_id ? (
              <div style={printMetaRowStyle}>
                <span style={printMetaLabelStyle}>Reference</span>
                <span style={printMetaValueStyle}>
                  {noteHeader?.source_type || "—"} {noteHeader?.source_id || ""}
                </span>
              </div>
            ) : null}
          </div>
        </header>

        <div className="note-content print-content">
          <main style={printBodyStyle} className="note-body">
            <section style={printSectionStyle} className="note-print-section">
              <div style={printSectionTitleStyle}>{partyLabel}</div>
              <div style={printPartyGridStyle}>
                <div>
                  <div style={printPartyNameStyle}>{partyName}</div>
                  <div style={printDetailTextStyle}>GSTIN: {party?.gstin || "—"}</div>
                  <div style={printDetailTextStyle}>
                    {partyAddressLines.length > 0 ? partyAddressLines.join("\n") : "—"}
                  </div>
                </div>
                <div>
                  <div style={printDetailLabelStyle}>Contact</div>
                  <div style={printDetailTextStyle}>{party?.contact_person || "—"}</div>
                  <div style={printDetailTextStyle}>Phone: {party?.phone || "—"}</div>
                  <div style={printDetailTextStyle}>Email: {party?.email || "—"}</div>
                </div>
              </div>
            </section>

            <section style={printSectionStyle} className="note-print-section">
              <div className="note-table-wrap">
                <table style={printTableStyle} className="note-print-table">
                  <colgroup>
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "12%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={printTableHeaderStyle}>Sl No</th>
                      <th style={printTableHeaderStyle}>SKU</th>
                      <th style={printTableHeaderStyle}>Description</th>
                      <th style={printTableHeaderStyle}>HSN</th>
                      <th style={printTableHeaderStyle}>Qty</th>
                      <th style={printTableHeaderStyle}>Unit Rate</th>
                      <th style={printTableHeaderStyle}>Tax %</th>
                      <th style={printTableHeaderStyle}>Amount</th>
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
                        const lineSubtotal = round2(line.line_subtotal ?? line.qty * (line.unit_rate ?? 0));
                        const lineTax = round2(line.line_tax ?? lineSubtotal * ((line.tax_rate ?? 0) / 100));
                        const lineTotal = round2(line.line_total ?? lineSubtotal + lineTax);
                        return (
                          <tr key={line.id ?? `${line.sku}-${index}`}>
                            <td style={printTableCellStyle}>{index + 1}</td>
                            <td style={printTableCellStyle}>{line.sku || line.variant_id || "—"}</td>
                            <td style={printTableCellStyle}>{line.title || "—"}</td>
                            <td style={printTableCellStyle}>{line.hsn || "—"}</td>
                            <td style={printTableCellStyle}>{line.qty}</td>
                            <td style={printTableCellStyle}>{formatMoney(line.unit_rate ?? null)}</td>
                            <td style={printTableCellStyle}>{(line.tax_rate ?? 0).toFixed(2)}%</td>
                            <td style={printTableCellStyle}>{formatMoney(lineTotal)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section style={printTotalsSectionStyle} className="note-print-section no-break">
              <div style={printTotalsRowStyle}>
                <span style={printMetaLabelStyle}>Subtotal</span>
                <span style={printTotalsValueStyle}>{formatMoney(roundedSubtotal)}</span>
              </div>
              <div style={printTotalsRowStyle}>
                <span style={printMetaLabelStyle}>Tax</span>
                <span style={printTotalsValueStyle}>{formatMoney(roundedTax)}</span>
              </div>
              {Math.abs(roundOff) > 0.009 ? (
                <div style={printTotalsRowStyle}>
                  <span style={printMetaLabelStyle}>Round-off</span>
                  <span style={printTotalsValueStyle}>{formatMoney(roundOff)}</span>
                </div>
              ) : null}
              <div style={{ ...printTotalsRowStyle, fontWeight: 700 }}>
                <span>Total Amount ({currencyCode})</span>
                <span style={printTotalsValueStyle}>{formatMoney(roundedTotal)}</span>
              </div>
            </section>

            {noteHeader?.cancel_reason ? (
              <section style={printSectionStyle} className="note-print-section">
                <div style={printSectionTitleStyle}>Notes / Reason</div>
                <div style={printDetailTextStyle}>{noteHeader.cancel_reason}</div>
              </section>
            ) : null}
          </main>
        </div>

        <footer style={printFooterStyle} className="note-footer print-footer">
          <div style={printFooterTextStyle}>
            {companyAddressLines.length > 0 ? companyAddressLines.join("\n") : "—"}
            {"\n"}GSTIN: {branding?.gstin || "—"}
          </div>
          <div style={printFooterPageStyle}>
            {noteDocNo} – Page <span className="pageNumber"></span> /{" "}
            <span className="totalPages"></span>
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
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 12mm 14mm;
          }

          html,
          body {
            height: auto;
          }

          body {
            background: #fff;
            margin: 0;
            transform: none !important;
            zoom: 1 !important;
          }

          .note-print,
          .note-sheet,
          .note-content,
          .note-body,
          .note-table-wrap,
          .note-header,
          .note-footer {
            overflow: visible !important;
            transform: none !important;
          }

          .note-print-root {
            max-width: none;
            margin: 0 !important;
            padding: 0 !important;
            display: block;
            transform: none !important;
            zoom: 1 !important;
          }

          .note-sheet {
            width: 100%;
            max-width: 100%;
            min-height: calc(297mm - 26mm);
            padding: 0;
            box-sizing: border-box;
            margin: 0 auto;
            position: relative;
            display: flex;
            flex-direction: column;
            transform: none !important;
            zoom: 1 !important;
          }

          .note-header {
            position: static;
            height: auto;
            padding: 0 0 6mm;
            background: #fff;
            display: block;
            margin-bottom: 10px;
            transform: none !important;
            zoom: 1 !important;
          }

          .note-footer {
            position: static;
            height: auto;
            padding: 6mm 0 0;
            background: #fff;
            display: block;
            margin-top: 12px;
            transform: none !important;
            zoom: 1 !important;
          }

          .note-content {
            padding-top: 0;
            padding-bottom: 0;
            display: block;
            flex: 1;
            transform: none !important;
            zoom: 1 !important;
          }

          .note-body {
            margin: 0 !important;
            padding: 0 !important;
            display: block;
            transform: none !important;
            zoom: 1 !important;
          }

          .print-footer {
            margin-top: auto;
          }

          .note-body > .note-print-section:last-child {
            margin-bottom: 0;
          }

          .note-print-section {
            display: block;
            break-inside: auto;
            page-break-inside: auto;
          }

          .note-print-table {
            border-collapse: collapse;
            page-break-inside: auto;
            table-layout: fixed;
            width: 100%;
          }

          .note-print-table thead {
            display: table-header-group;
          }

          .note-print-table tbody {
            display: table-row-group;
          }

          .note-print-table tfoot {
            display: table-footer-group;
          }

          .note-print-table tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .note-print-table th,
          .note-print-table td {
            padding: 8px 10px !important;
            font-size: 12px !important;
          }

          .note-print-table th:nth-child(5),
          .note-print-table th:nth-child(6),
          .note-print-table th:nth-child(7),
          .note-print-table th:nth-child(8),
          .note-print-table td:nth-child(5),
          .note-print-table td:nth-child(6),
          .note-print-table td:nth-child(7),
          .note-print-table td:nth-child(8) {
            text-align: right !important;
          }

          .note-print-table th:nth-child(2),
          .note-print-table td:nth-child(2),
          .note-print-table th:nth-child(3),
          .note-print-table td:nth-child(3) {
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .note-table-wrap {
            display: block;
            overflow: visible !important;
            height: auto;
            padding-top: 2mm !important;
          }

          .no-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
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

const printErrorListStyle = {
  margin: "6px 0 0",
  paddingLeft: 18,
};

const printHeaderRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap" as const,
  marginBottom: 24,
};

const printBodyStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
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
  fontSize: 11,
  color: "#6b7280",
  marginTop: 6,
  whiteSpace: "pre-line" as const,
};

const printDocTitleStyle = {
  marginTop: 12,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "#0f172a",
};

const printMetaCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "12px 14px",
  minWidth: 220,
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
  backgroundColor: "#fff",
};

const printMetaRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 12,
};

const printMetaLabelStyle = {
  color: "#6b7280",
  fontSize: 11,
};

const printMetaValueStyle = {
  color: "#111827",
  fontWeight: 600,
  textAlign: "right" as const,
};

const printSectionStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "12px 14px",
  backgroundColor: "#fff",
};

const printSectionTitleStyle = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  marginBottom: 8,
  color: "#111827",
};

const printPartyGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const printPartyNameStyle = {
  fontSize: 15,
  fontWeight: 800,
};

const printDetailLabelStyle = {
  fontSize: 11,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

const printDetailTextStyle = {
  fontSize: 12,
  color: "#4b5563",
  whiteSpace: "pre-line" as const,
};

const printTableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 11,
};

const printTableHeaderStyle = {
  textAlign: "left" as const,
  background: "#f3f4f6",
  fontWeight: 600,
  padding: "6px 8px",
  borderBottom: "1px solid #e5e7eb",
};

const printTableCellStyle = {
  padding: "6px 8px",
  borderBottom: "1px solid #e5e7eb",
  verticalAlign: "top" as const,
};

const printTotalsSectionStyle = {
  marginLeft: "auto",
  maxWidth: 320,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "12px 14px",
  backgroundColor: "#f9fafb",
};

const printTotalsRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "4px 0",
  fontSize: 12,
};

const printTotalsValueStyle = {
  fontWeight: 600,
};

const printFooterStyle = {
  marginTop: 24,
  paddingTop: 12,
  borderTop: "1px solid #e5e7eb",
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

const printFooterPageStyle = {
  fontSize: 11,
  color: "#6b7280",
};
