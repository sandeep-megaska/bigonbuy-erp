import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type FinanceNotePayload = {
  note: {
    id: string;
    note_no: string | null;
    party_type: string;
    note_kind: string;
    status: string;
    note_date: string;
    party_id: string | null;
    party_name: string;
    currency: string | null;
    subtotal: number;
    tax_total: number;
    total: number;
    source_type: string | null;
    source_id: string | null;
    cancel_reason: string | null;
  };
  party: {
    name: string | null;
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
  lines: Array<{
    id: string;
    line_no: number | null;
    item_type: string;
    variant_id: string | null;
    sku: string | null;
    title: string | null;
    hsn: string | null;
    qty: number;
    unit_rate: number | null;
    tax_rate: number | null;
    line_subtotal: number | null;
    line_tax: number | null;
    line_total: number | null;
  }>;
  company: {
    company_id: string;
    legal_name: string | null;
    brand_name: string | null;
    currency_code: string | null;
    gstin: string | null;
    address_text: string | null;
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

const formatNoteKind = (value?: string | null) => (value === "credit" ? "Credit Note" : "Debit Note");

function buildNoteHtml(payload: FinanceNotePayload) {
  const { note, party, lines, company } = payload;
  const currencyCode = company?.currency_code || note.currency || "INR";

  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(round2(value));
  };

  const partyAddressLines = [
    party?.address_line1 || party?.address || "",
    party?.address_line2 || "",
    [party?.city, party?.state, party?.pincode].filter(Boolean).join(", "),
    party?.country || "",
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const lineRows =
    lines.length === 0
      ? `<tr><td class="cell" colspan="7">No line items found.</td></tr>`
      : lines
          .map((line, index) => {
            const roundedUnitRate =
              line.unit_rate !== null && line.unit_rate !== undefined ? round2(line.unit_rate) : null;
            const lineSubtotal = round2(line.line_subtotal ?? (line.qty * (roundedUnitRate || 0)));
            const taxRate = line.tax_rate ?? 0;
            const lineTax = round2(line.line_tax ?? (lineSubtotal * (taxRate / 100)));
            const lineTotal = round2(line.line_total ?? (lineSubtotal + lineTax));

            return `
              <tr>
                <td class="cell">${index + 1}</td>
                <td class="cell">${escapeHtml(line.sku || line.variant_id || "—")}</td>
                <td class="cell">${escapeHtml(line.hsn || "—")}</td>
                <td class="cell numeric">${line.qty}</td>
                <td class="cell numeric">${escapeHtml(formatMoney(roundedUnitRate))}</td>
                <td class="cell numeric">${taxRate.toFixed(2)}%</td>
                <td class="cell numeric">${escapeHtml(formatMoney(lineTotal))}</td>
              </tr>
            `;
          })
          .join("");

  const roundedSubtotal = round2(note.subtotal ?? 0);
  const roundedTax = round2(note.tax_total ?? 0);
  const roundedTotal = round2(note.total ?? 0);
  const computedTotal = round2(roundedSubtotal + roundedTax);
  const roundOff = round2(roundedTotal - computedTotal);

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
          .party-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
          .party-name { font-size: 15px; font-weight: 800; }
          .detail-text { color: #4b5563; white-space: pre-line; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          thead { display: table-header-group; }
          th { text-align: left; background: #f3f4f6; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
          td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          tr { page-break-inside: avoid; }
          .numeric { text-align: right; }
          .totals { margin-left: auto; max-width: 280px; background: #f9fafb; border-radius: 10px; padding: 10px 12px; border: 1px solid #e5e7eb; }
          .totals-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 12px; }
          .no-break { page-break-inside: avoid; }
        </style>
      </head>
      <body>
        <main>
          <section class="section">
            <div class="section-title">${note.party_type === "vendor" ? "Vendor" : "Customer"}</div>
            <div class="party-grid">
              <div>
                <div class="party-name">${escapeHtml(party?.name || note.party_name || "—")}</div>
                <div class="detail-text">GSTIN: ${escapeHtml(party?.gstin || "—")}</div>
                <div class="detail-text">${escapeHtml(partyAddressLines.length > 0 ? partyAddressLines.join("\n") : "—")}</div>
              </div>
              <div>
                <div class="detail-text">Contact: ${escapeHtml(party?.contact_person || "—")}</div>
                <div class="detail-text">Phone: ${escapeHtml(party?.phone || "—")}</div>
                <div class="detail-text">Email: ${escapeHtml(party?.email || "—")}</div>
              </div>
            </div>
          </section>

          <section class="section">
            <table>
              <thead>
                <tr>
                  <th>Sl No</th>
                  <th>SKU</th>
                  <th>HSN</th>
                  <th class="numeric">Qty</th>
                  <th class="numeric">Unit Rate</th>
                  <th class="numeric">Tax %</th>
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
              <span>${escapeHtml(formatMoney(roundedSubtotal))}</span>
            </div>
            <div class="totals-row">
              <span>Tax</span>
              <span>${escapeHtml(formatMoney(roundedTax))}</span>
            </div>
            ${Math.abs(roundOff) > 0.009 ? `<div class="totals-row"><span>Round-off</span><span>${escapeHtml(formatMoney(roundOff))}</span></div>` : ""}
            <div class="totals-row" style="font-weight: 700;">
              <span>Total Amount (${escapeHtml(currencyCode)})</span>
              <span>${escapeHtml(formatMoney(roundedTotal))}</span>
            </div>
          </section>

          ${
            note.source_type || note.source_id
              ? `<section class="section">
                  <div class="section-title">Reference</div>
                  <div class="detail-text">${escapeHtml(note.source_type || "—")} ${escapeHtml(note.source_id || "")}</div>
                </section>`
              : ""
          }

          ${
            note.cancel_reason
              ? `<section class="section">
                  <div class="section-title">Cancellation Reason</div>
                  <div class="detail-text">${escapeHtml(note.cancel_reason)}</div>
                </section>`
              : ""
          }
        </main>
      </body>
    </html>
  `;
}

function buildHeaderFooter(payload: FinanceNotePayload, logoUrl: string | null, footerLogoUrl: string | null) {
  const { note, company } = payload;
  const companyName = company?.legal_name || company?.brand_name || "Bigonbuy";
  const companyAddress = company?.address_text || "";

  const headerLogoMarkup = logoUrl
    ? `<img src="${logoUrl}" style="height: 28px; width: auto;" />`
    : `<div style="font-size: 10px; font-weight: 700; letter-spacing: 0.1em;">BIGONBUY</div>`;

  const footerLogoMarkup = footerLogoUrl
    ? `<img src="${footerLogoUrl}" style="height: 22px; width: auto;" />`
    : `<div style="font-size: 10px; font-weight: 700; letter-spacing: 0.1em;">MEGASKA</div>`;

  const headerTemplate = `
    <div style="width: 100%; padding: 0 40px; font-family: Inter, system-ui, sans-serif; color: #111827;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${headerLogoMarkup}
        </div>
        <div style="flex: 1; text-align: center;">
          <div style="font-size: 12px; font-weight: 700;">${escapeHtml(companyName)}</div>
          <div style="font-size: 9px; color: #6b7280;">GSTIN: ${escapeHtml(company?.gstin || "—")}</div>
          <div style="font-size: 9px; color: #6b7280; white-space: pre-line;">${escapeHtml(companyAddress || "—")}</div>
        </div>
        <div style="text-align: right; font-size: 9px; color: #111827; border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 8px; min-width: 160px;">
          <div><span style="color: #6b7280;">Note</span> ${escapeHtml(note.note_no || note.id)}</div>
          <div><span style="color: #6b7280;">Date</span> ${escapeHtml(formatDate(note.note_date))}</div>
          <div><span style="color: #6b7280;">Type</span> ${escapeHtml(formatNoteKind(note.note_kind))}</div>
          <div><span style="color: #6b7280;">Party</span> ${escapeHtml(note.party_type === "customer" ? "Customer" : "Vendor")}</div>
          <div><span style="color: #6b7280;">Status</span> ${escapeHtml(note.status || "—")}</div>
        </div>
      </div>
    </div>
  `;

  const footerTemplate = `
    <div style="width: 100%; padding: 0 40px; font-family: Inter, system-ui, sans-serif; color: #6b7280; font-size: 9px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid #e5e7eb; padding-top: 6px;">
        <div style="white-space: pre-line; flex: 1;">
          ${escapeHtml(companyAddress || "—")}
        </div>
        <div style="text-align: center;">
          ${footerLogoMarkup}
        </div>
        <div style="text-align: right; min-width: 160px;">
          ${escapeHtml(note.note_no || note.id)} — Page <span class="pageNumber"></span> / <span class="totalPages"></span>
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

  const noteId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!noteId) {
    return res.status(400).json({ ok: false, error: "Note id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_finance_note_pdf_payload", { p_note_id: noteId });
    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load note",
        details: error.details || error.hint || error.code,
      });
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "Note not found" });
    }

    const payload = data as FinanceNotePayload;

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

    const html = buildNoteHtml(payload);
    const { headerTemplate, footerTemplate } = buildHeaderFooter(payload, headerLogoUrl, footerLogoUrl);

    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    form.append("files", new Blob([headerTemplate], { type: "text/html" }), "header.html");
    form.append("files", new Blob([footerTemplate], { type: "text/html" }), "footer.html");
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.69");
    form.append("marginTop", "0.9");
    form.append("marginBottom", "0.7");
    form.append("marginLeft", "0.5");
    form.append("marginRight", "0.5");
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

    const prefix = payload.note.note_kind === "credit" ? "CN" : "DN";
    const filename = `${prefix}-${payload.note.note_no || payload.note.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
