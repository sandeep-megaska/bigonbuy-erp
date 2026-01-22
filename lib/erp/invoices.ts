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
  discount_percent: z.coerce.number().optional(),
  tax_percent: z.coerce.number().optional(),
  line_subtotal: z.coerce.number().optional(),
  line_tax: z.coerce.number().optional(),
  line_total: z.coerce.number().optional(),
  taxable_amount: z.coerce.number().optional(),
  cgst_amount: z.coerce.number().optional(),
  sgst_amount: z.coerce.number().optional(),
  igst_amount: z.coerce.number().optional(),
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
  place_of_supply_state_code: z.string().nullable().optional(),
  place_of_supply_state_name: z.string().nullable().optional(),
  billing_address_line1: z.string().nullable(),
  billing_address_line2: z.string().nullable(),
  billing_city: z.string().nullable(),
  billing_state: z.string().nullable(),
  billing_state_code: z.string().nullable().optional(),
  billing_state_name: z.string().nullable().optional(),
  billing_pincode: z.string().nullable(),
  billing_country: z.string().nullable(),
  shipping_address_line1: z.string().nullable(),
  shipping_address_line2: z.string().nullable(),
  shipping_city: z.string().nullable(),
  shipping_state: z.string().nullable(),
  shipping_state_code: z.string().nullable().optional(),
  shipping_state_name: z.string().nullable().optional(),
  shipping_pincode: z.string().nullable(),
  shipping_country: z.string().nullable(),
  currency: z.string(),
  subtotal: z.coerce.number(),
  tax_total: z.coerce.number(),
  igst_total: z.coerce.number(),
  cgst_total: z.coerce.number(),
  sgst_total: z.coerce.number(),
  total: z.coerce.number(),
  taxable_amount: z.coerce.number().optional(),
  cgst_amount: z.coerce.number().optional(),
  sgst_amount: z.coerce.number().optional(),
  igst_amount: z.coerce.number().optional(),
  gst_amount: z.coerce.number().optional(),
  total_amount: z.coerce.number().optional(),
  is_inter_state: z.boolean().nullable().optional(),
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
  discount_percent?: number;
  tax_percent?: number;
};

export type InvoiceFormPayload = {
  id?: string | null;
  invoice_date: string;
  customer_name: string;
  customer_gstin?: string | null;
  place_of_supply: string;
  place_of_supply_state_code?: string | null;
  place_of_supply_state_name?: string | null;
  currency: string;
  billing_address_line1?: string | null;
  billing_address_line2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_state_code?: string | null;
  billing_state_name?: string | null;
  billing_pincode?: string | null;
  billing_country?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_state_code?: string | null;
  shipping_state_name?: string | null;
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
