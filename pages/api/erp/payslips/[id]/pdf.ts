import type { NextApiRequest, NextApiResponse } from "next";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type PayslipPayload = {
  payslip?: {
    payslip_no?: string | null;
    period_year?: number;
    period_month?: number;
    employee_name?: string | null;
    employee_code?: string | null;
    designation?: string | null;
    department?: string | null;
    basic?: number | null;
    hra?: number | null;
    allowances?: number | null;
    gross?: number | null;
    deductions?: number | null;
    net_pay?: number | null;
    notes?: string | null;
  };
  earnings?: Array<{ code?: string; name?: string | null; amount?: number | null }>;
  deductions?: Array<{ code?: string; name?: string | null; amount?: number | null }>;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };

type ApiResponse = ErrorResponse | Buffer;

function formatAmount(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(num);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
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

  const payslipId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!payslipId) {
    return res.status(400).json({ ok: false, error: "Payslip id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_payslip_get", {
      p_payslip_id: payslipId,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load payslip",
        details: error.details || error.hint || error.code,
      });
    }

    const payload = (data || {}) as PayslipPayload;
    const payslip = payload.payslip || {};

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { height } = page.getSize();
    let y = height - 50;
    const left = 50;

    const drawText = (text: string, size = 12, bold = false) => {
      page.drawText(text, {
        x: left,
        y,
        size,
        font: bold ? fontBold : font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= size + 6;
    };

    drawText("Payslip", 20, true);
    drawText("Bigonbuy Trading Pvt Ltd", 12, true);
    drawText(`Payslip #: ${payslip.payslip_no || payslipId}`, 11);
    drawText(`Period: ${payslip.period_year}-${String(payslip.period_month || "").padStart(2, "0")}`, 11);
    y -= 8;

    drawText("Employee Details", 12, true);
    drawText(`Name: ${payslip.employee_name || "—"}`, 11);
    drawText(`Code: ${payslip.employee_code || "—"}`, 11);
    if (payslip.designation) drawText(`Designation: ${payslip.designation}`, 11);
    if (payslip.department) drawText(`Department: ${payslip.department}`, 11);
    y -= 8;

    drawText("Earnings", 12, true);
    drawText(`Basic: ${formatAmount(payslip.basic)}`, 11);
    drawText(`HRA: ${formatAmount(payslip.hra)}`, 11);
    drawText(`Allowances: ${formatAmount(payslip.allowances)}`, 11);

    (payload.earnings || []).forEach((line) => {
      drawText(`${line.name || line.code || "Earning"}: ${formatAmount(line.amount ?? null)}`, 11);
    });

    drawText(`Gross: ${formatAmount(payslip.gross)}`, 11, true);
    y -= 6;

    drawText("Deductions", 12, true);
    if ((payload.deductions || []).length === 0) {
      drawText("No deductions", 11);
    } else {
      (payload.deductions || []).forEach((line) => {
        drawText(`${line.name || line.code || "Deduction"}: ${formatAmount(line.amount ?? null)}`, 11);
      });
    }

    drawText(`Total Deductions: ${formatAmount(payslip.deductions)}`, 11, true);
    drawText(`Net Pay: ${formatAmount(payslip.net_pay)}`, 12, true);

    if (payslip.notes) {
      y -= 6;
      drawText("Notes", 12, true);
      drawText(String(payslip.notes), 11);
    }

    const pdfBytes = await pdfDoc.save();
    const filename = `Payslip-${payslip.payslip_no || payslipId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
