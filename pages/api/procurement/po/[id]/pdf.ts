import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type PurchaseOrderPayload = {
  po: {
    id: string;
    doc_no: string | null;
    po_no: string | null;
    status: string;
    order_date: string;
    expected_delivery_date: string | null;
    notes: string | null;
    deliver_to_warehouse_id: string | null;
    vendor_id: string;
  };
  vendor: {
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
  } | null;
  deliver_to: { id: string; name: string } | null;
  lines: Array<{
    id: string;
    variant_id: string;
    ordered_qty: number;
    unit_cost: number | null;
    sku: string | null;
    size: string | null;
    color: string | null;
    product_title: string | null;
    hsn_code: string | null;
    style_code: string | null;
  }>;
  company: {
    company_id: string;
    legal_name: string | null;
    brand_name: string | null;
    currency_code: string | null;
    gstin: string | null;
    address_text: string | null;
    po_terms_text: string | null;
    po_footer_address_text: string | null;
    bigonbuy_logo_path: string | null;
    megaska_logo_path: string | null;
  } | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type ApiResponse = ErrorResponse | Buffer;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN");
};

function buildPoHtml(payload: PurchaseOrderPayload) {
  const { po, vendor, lines, company } = payload;
  const currencyCode = company?.currency_code || "INR";

  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(round2(value));
  };

  const vendorAddressLines = [
    vendor?.address_line1 || vendor?.address || "",
    vendor?.address_line2 || "",
    [vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(", "),
    vendor?.country || "",
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const termsLines = (company?.po_terms_text || "")
    .split("\n")
    .map((line) => line.replace(/^[•*-]\s*/, "").trim())
    .filter(Boolean);

  const subtotal = lines.reduce((sum, line) => {
    if (line.unit_cost === null || line.unit_cost === undefined) return sum;
    const roundedUnitRate = round2(line.unit_cost);
    const lineTotal = round2(line.ordered_qty * roundedUnitRate);
    return sum + lineTotal;
  }, 0);

  const lineRows =
    lines.length === 0
      ? `<tr><td class="cell" colspan="9">No line items found.</td></tr>`
      : lines
          .map((line, index) => {
            const roundedUnitRate =
              line.unit_cost !== null && line.unit_cost !== undefined ? round2(line.unit_cost) : null;
            const lineTotal = roundedUnitRate !== null ? round2(line.ordered_qty * roundedUnitRate) : null;

            return `
              <tr>
                <td class="cell">${index + 1}</td>
                <td class="cell">${escapeHtml(line.sku || line.variant_id)}</td>
                <td class="cell">${escapeHtml(line.style_code || "—")}</td>
                <td class="cell">${escapeHtml(line.hsn_code || "—")}</td>
                <td class="cell">${escapeHtml(line.size || "—")}</td>
                <td class="cell">${escapeHtml(line.color || "—")}</td>
                <td class="cell numeric">${line.ordered_qty}</td>
                <td class="cell numeric">${escapeHtml(formatMoney(roundedUnitRate))}</td>
                <td class="cell numeric">${escapeHtml(formatMoney(lineTotal))}</td>
              </tr>
            `;
          })
          .join("");

  const poLabel = po.doc_no || "";

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #111827; font-size: 12px; }
          main { padding: 0; }
          .section { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
          .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
          .vendor-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
          .vendor-name { font-size: 15px; font-weight: 800; }
          .detail-text { color: #4b5563; white-space: pre-line; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          thead { display: table-header-group; }
          th { text-align: left; background: #f3f4f6; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
          td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          tr { page-break-inside: avoid; }
          .numeric { text-align: right; }
          .totals { margin-left: auto; max-width: 280px; background: #f9fafb; border-radius: 10px; padding: 10px 12px; border: 1px solid #e5e7eb; }
          .totals-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 12px; }
          .terms { margin: 0 0 0 18px; padding: 0; color: #4b5563; }
          .signature { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; margin-top: 8px; }
          .signature-line { height: 1px; background: #111827; opacity: 0.3; margin-top: 20px; }
          .signature-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #4b5563; margin-top: 6px; }
          .no-break { page-break-inside: avoid; }
        </style>
      </head>
      <body>
        <main>
          <section class="section">
            <div class="section-title">Vendor</div>
            <div class="vendor-grid">
              <div>
                <div class="vendor-name">${escapeHtml(vendor?.legal_name || "—")}</div>
                <div class="detail-text">GSTIN: ${escapeHtml(vendor?.gstin || "—")}</div>
                <div class="detail-text">${escapeHtml(vendorAddressLines.length > 0 ? vendorAddressLines.join("\n") : "—")}</div>
              </div>
              <div>
                <div class="detail-text">Contact: ${escapeHtml(vendor?.contact_person || "—")}</div>
                <div class="detail-text">Phone: ${escapeHtml(vendor?.phone || "—")}</div>
                <div class="detail-text">Email: ${escapeHtml(vendor?.email || "—")}</div>
              </div>
            </div>
          </section>

          <section class="section">
            <table>
              <thead>
                <tr>
                  <th>Sl No</th>
                  <th>SKU</th>
                  <th>Style</th>
                  <th>HSN</th>
                  <th>Size</th>
                  <th>Color</th>
                  <th class="numeric">Qty</th>
                  <th class="numeric">Unit Rate</th>
                  <th class="numeric">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${lineRows}
              </tbody>
            </table>
          </section>

          <section class="totals no-break">
            <div class="totals-row">
              <span>Subtotal</span>
              <span>${escapeHtml(formatMoney(round2(subtotal)))}</span>
            </div>
            <div class="totals-row" style="font-weight: 700;">
              <span>Total Amount (${escapeHtml(currencyCode)})</span>
              <span>${escapeHtml(formatMoney(round2(subtotal)))}</span>
            </div>
            <div style="font-size: 11px; color: #6b7280; margin-top: 4px;">GST: As applicable / extra</div>
          </section>

          ${
            termsLines.length > 0
              ? `<section class="section">
                  <div class="section-title">Terms &amp; Conditions</div>
                  <ul class="terms">
                    ${termsLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
                  </ul>
                </section>`
              : ""
          }

          ${
            po.notes
              ? `<section class="section">
                  <div class="section-title">Notes</div>
                  <div class="detail-text">${escapeHtml(po.notes)}</div>
                </section>`
              : ""
          }

          <section class="signature no-break">
            <div>
              <div class="signature-line"></div>
              <div class="signature-label">Authorized Signatory</div>
            </div>
            <div>
              <div class="signature-line"></div>
              <div class="signature-label">Vendor Acceptance</div>
            </div>
          </section>
        </main>
      </body>
    </html>
  `;
}

function buildHeaderFooter(payload: PurchaseOrderPayload, logoUrl: string | null, footerLogoUrl: string | null) {
  const { po, deliver_to, company } = payload;
  const companyName = company?.legal_name || company?.brand_name || "Bigonbuy";
  const footerAddress = company?.po_footer_address_text || company?.address_text || "";
  const poLabel = po.doc_no || "";

  const headerLogoMarkup = logoUrl
    ? `<img src="${logoUrl}" style="height: 28px; width: auto;" />`
    : `<div style="font-size: 10px; font-weight: 700; letter-spacing: 0.1em;">BIGONBUY</div>`;

  const footerLogoMarkup = footerLogoUrl
    ? `<img src="${footerLogoUrl}" style="height: 22px; width: auto;" />`
    : `<div style="font-size: 10px; font-weight: 700; letter-spacing: 0.1em;">MEGASKA</div>`;

  // Chromium-compatible header/footer HTML (pageNumber/totalPages work)
  const headerTemplate = `
    <div style="width: 100%; padding: 0 40px; font-family: Inter, system-ui, sans-serif; color: #111827;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${headerLogoMarkup}
          <div>
            <div style="font-size: 12px; font-weight: 700;">${escapeHtml(companyName)}</div>
            <div style="font-size: 16px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 800; margin-top: 4px;">Purchase Order</div>
          </div>
        </div>
        <div style="text-align: right; font-size: 9px; color: #111827;">
          <div><span style="color: #6b7280;">PO</span> ${escapeHtml(poLabel)}</div>
          <div><span style="color: #6b7280;">Date</span> ${escapeHtml(formatDate(po.order_date))}</div>
          <div><span style="color: #6b7280;">Deliver To</span> ${escapeHtml(deliver_to?.name || "—")}</div>
          <div><span style="color: #6b7280;">Status</span> ${escapeHtml(po.status || "—")}</div>
        </div>
      </div>
    </div>
  `;

  const footerTemplate = `
    <div style="width: 100%; padding: 0 40px; font-family: Inter, system-ui, sans-serif; color: #6b7280; font-size: 9px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid #e5e7eb; padding-top: 6px;">
        <div style="white-space: pre-line; flex: 1;">
          ${escapeHtml(footerAddress || "—")}
        </div>
        <div style="text-align: center;">
          ${footerLogoMarkup}
        </div>
        <div style="text-align: right; min-width: 140px;">
          ${escapeHtml(poLabel)} – Page <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      </div>
    </div>
  `;

  return { headerTemplate, footerTemplate };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const GOTENBERG_URL = process.env.GOTENBERG_URL;
  if (!GOTENBERG_URL) {
    return res.status(500).json({ ok: false, error: "Missing GOTENBERG_URL env var" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const poId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!poId) {
    return res.status(400).json({ ok: false, error: "Purchase order id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_proc_po_pdf_payload", { p_po_id: poId });
    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load purchase order",
        details: error.details || error.hint || error.code,
      });
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "Purchase order not found" });
    }

    const payload = data as PurchaseOrderPayload;

    // Resolve logo URLs (signed preferred)
    const storage = userClient.storage.from("erp-assets");
    const resolveUrl = async (path: string | null | undefined) => {
      if (!path) return null;
      const { data: signed, error: signedError } = await storage.createSignedUrl(path, 3600);
      if (!signedError && signed?.signedUrl) return signed.signedUrl;
      const { data: publicData } = storage.getPublicUrl(path);
      return publicData?.publicUrl ?? null;
    };

    const [headerLogoUrl, footerLogoUrl] = await Promise.all([
      resolveUrl(payload.company?.bigonbuy_logo_path || null),
      resolveUrl(payload.company?.megaska_logo_path || null),
    ]);

    const html = buildPoHtml(payload);
    const { headerTemplate, footerTemplate } = buildHeaderFooter(payload, headerLogoUrl, footerLogoUrl);

    // Gotenberg Chromium HTML conversion (multipart form)
    // Endpoint: /forms/chromium/convert/html
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    form.append("files", new Blob([headerTemplate], { type: "text/html" }), "header.html");
    form.append("files", new Blob([footerTemplate], { type: "text/html" }), "footer.html");

    // Print settings
    form.append("paperWidth", "8.27");  // A4 width in inches
    form.append("paperHeight", "11.69"); // A4 height in inches
    form.append("marginTop", "0.9");     // inches (~80px)
    form.append("marginBottom", "0.7");  // inches (~60px)
    form.append("marginLeft", "0.5");    // inches (~40px)
    form.append("marginRight", "0.5");   // inches (~40px)
    form.append("printBackground", "true");
    form.append("displayHeaderFooter", "true");

    const url = `${GOTENBERG_URL.replace(/\/$/, "")}/forms/chromium/convert/html`;
    const resp = await fetch(url, { method: "POST", body: form as any });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return res.status(500).json({
        ok: false,
        error: `Gotenberg error (${resp.status})`,
        details: text.slice(0, 2000),
      });
    }

    const pdfArrayBuffer = await resp.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);

    const filename = `PO_${payload.po.doc_no || ""}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
