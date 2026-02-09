import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type AsnPrintLine = {
  po_line_id: string;
  sku: string;
  product_name?: string | null;
  size?: string | null;
  color?: string | null;
  qty: number;
};
export type AsnPrintCarton = { carton_id: string; carton_no: number; total_qty: number; lines: AsnPrintLine[] };
export type AsnPrintData = {
  asn: { id: string; asn_no?: string | null; dispatch_date?: string | null; eta_date?: string | null; status?: string | null };
  vendor: { vendor_code?: string | null; vendor_name?: string | null };
  po: { po_no?: string | null; code?: string | null };
  cartons: AsnPrintCarton[];
  totals: { total_cartons: number; total_qty: number; sku_count: number };
};

function fmtDate(v?: string | null) { return v || "—"; }
function label(line: AsnPrintLine) {
  const parts = [line.product_name, line.size && `Size ${line.size}`, line.color && `Color ${line.color}`].filter(Boolean);
  return parts.length ? `${line.sku} — ${parts.join(" • ")}` : line.sku;
}

export async function generatePackingSlipPdf(data: AsnPrintData, format: "slip" | "a4") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageSize: [number, number] = format === "a4" ? [595, 842] : [420, 612];
  const margin = 28;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const write = (text: string, opts?: { size?: number; bold?: boolean; x?: number; right?: number }) => {
    const size = opts?.size ?? 10;
    const f = opts?.bold ? bold : font;
    const x = opts?.x ?? margin;
    if (typeof opts?.right === "number") {
      const tw = f.widthOfTextAtSize(text, size);
      page.drawText(text, { x: opts.right - tw, y, size, font: f });
    } else {
      page.drawText(text, { x, y, size, font: f });
    }
    y -= size + 4;
  };
  const ensure = (min = 60) => {
    if (y < min) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - margin;
    }
  };

  write("MEGASKA — ASN PACKING SLIP", { size: 14, bold: true });
  write(`ASN: ${data.asn.asn_no || data.asn.id.slice(0, 8)}    Status: ${data.asn.status || "—"}`);
  write(`Vendor: ${data.vendor.vendor_code || "—"}${data.vendor.vendor_name ? ` (${data.vendor.vendor_name})` : ""}`);
  write(`PO: ${data.po.po_no || data.po.code || "—"}`);
  write(`Dispatch Date (When vendor sends boxes): ${fmtDate(data.asn.dispatch_date)}`);
  write(`ETA (Expected arrival): ${fmtDate(data.asn.eta_date)}`);
  write(`Summary: Total boxes ${data.totals.total_cartons} | Total pcs ${data.totals.total_qty}`, { bold: true });
  y -= 4;

  data.cartons.forEach((carton) => {
    ensure();
    write(`Box-${carton.carton_no} (Total ${carton.total_qty})`, { bold: true, size: 11 });
    write("SKU / Item", { bold: true, size: 9 });
    y += 13;
    write("Qty", { bold: true, size: 9, right: pageSize[0] - margin });

    if (!carton.lines.length) {
      write("No scanned items", { size: 9 });
    } else {
      carton.lines.forEach((line) => {
        ensure();
        const left = label(line);
        write(left, { size: 9, x: margin });
        y += 13;
        write(String(line.qty), { size: 9, right: pageSize[0] - margin });
      });
    }
    y -= 4;
  });

  ensure();
  page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: pageSize[0] - margin, y: y + 8 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  write("Generated from barcode packing (carton-wise).", { size: 8 });
  write(`Generated at: ${new Date().toISOString()}`, { size: 8 });

  return Buffer.from(await pdf.save());
}

export async function generateBoxLabelsPdf(data: AsnPrintData) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size: [number, number] = [420, 297];

  data.cartons.forEach((carton) => {
    const page = pdf.addPage(size);
    const center = size[0] / 2;
    const drawC = (txt: string, y: number, s: number, isBold = false) => {
      const f = isBold ? bold : font;
      const w = f.widthOfTextAtSize(txt, s);
      page.drawText(txt, { x: center - w / 2, y, size: s, font: f });
    };
    drawC(`ASN ${data.asn.asn_no || data.asn.id.slice(0, 8)}`, 236, 28, true);
    drawC(`Box ${carton.carton_no} of ${data.totals.total_cartons}`, 178, 40, true);
    drawC(`Vendor: ${data.vendor.vendor_code || "—"}`, 130, 18, false);
    drawC(`PO: ${data.po.po_no || data.po.code || "—"}`, 104, 16, false);
    drawC(`Total pcs: ${carton.total_qty}`, 60, 24, true);
  });

  return Buffer.from(await pdf.save());
}
