import { z } from "zod";

export const invoiceLineSchema = z.object({
  id: z.string().uuid().optional(),
  line_no: z.coerce.number().optional(),
  item_type: z.string(),
  variant_id: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  title: z.string().nullable(),
  hsn: z.string().nullable(),
  qty: z.coerce.number(),
  unit_rate: z.coerce.number(),
  tax_rate: z.coerce.number(),
  line_subtotal: z.coerce.number().optional(),
  line_tax: z.coerce.number().optional(),
  line_total: z.coerce.number().optional(),
});

export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const invoiceHeaderSchema = z.object({
  id: z.string().uuid(),
  doc_no: z.string().nullable(),
  status: z.string(),
  invoice_date: z.string(),
  customer_name: z.string(),
  customer_gstin: z.string().nullable(),
  place_of_supply: z.string(),
  billing_address_line1: z.string().nullable(),
  billing_address_line2: z.string().nullable(),
  billing_city: z.string().nullable(),
  billing_state: z.string().nullable(),
  billing_pincode: z.string().nullable(),
  billing_country: z.string().nullable(),
  shipping_address_line1: z.string().nullable(),
  shipping_address_line2: z.string().nullable(),
  shipping_city: z.string().nullable(),
  shipping_state: z.string().nullable(),
  shipping_pincode: z.string().nullable(),
  shipping_country: z.string().nullable(),
  currency: z.string(),
  subtotal: z.coerce.number(),
  tax_total: z.coerce.number(),
  igst_total: z.coerce.number(),
  cgst_total: z.coerce.number(),
  sgst_total: z.coerce.number(),
  total: z.coerce.number(),
  issued_at: z.string().nullable(),
  issued_by: z.string().uuid().nullable().optional(),
  cancelled_at: z.string().nullable(),
  cancelled_by: z.string().uuid().nullable().optional(),
  cancel_reason: z.string().nullable(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const invoiceListRowSchema = z.object({
  id: z.string().uuid(),
  doc_no: z.string().nullable(),
  status: z.string(),
  invoice_date: z.string(),
  customer_name: z.string(),
  subtotal: z.coerce.number(),
  tax_total: z.coerce.number(),
  total: z.coerce.number(),
  issued_at: z.string().nullable(),
  created_at: z.string().optional(),
});

export const invoiceListResponseSchema = z.array(invoiceListRowSchema);

export type InvoiceListRow = z.infer<typeof invoiceListRowSchema>;

export type InvoiceLineInput = {
  id?: string | null;
  line_no?: number;
  item_type: string;
  variant_id: string | null;
  sku: string;
  title: string;
  hsn: string;
  qty: number;
  unit_rate: number;
  tax_rate: number;
};

export type InvoiceFormPayload = {
  id?: string | null;
  invoice_date: string;
  customer_name: string;
  customer_gstin?: string | null;
  place_of_supply: string;
  currency: string;
  billing_address_line1?: string | null;
  billing_address_line2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_pincode?: string | null;
  billing_country?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_pincode?: string | null;
  shipping_country?: string | null;
  lines: InvoiceLineInput[];
};

export const ensureNumber = (value: string | number) => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
