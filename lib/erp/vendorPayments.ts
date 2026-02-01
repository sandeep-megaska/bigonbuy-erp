import { z } from "zod";
import { supabase } from "../supabaseClient";

export const vendorPaymentRowSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  vendor_name: z.string().nullable(),
  payment_date: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  mode: z.string(),
  reference_no: z.string().nullable(),
  note: z.string().nullable(),
  source: z.string(),
  source_ref: z.string().nullable(),
  payment_instrument_id: z.string().uuid().nullable(),
  status: z.string(),
  finance_journal_id: z.string().uuid().nullable(),
  journal_doc_no: z.string().nullable(),
  is_void: z.coerce.boolean(),
  created_at: z.string(),
  created_by: z.string().uuid(),
  updated_at: z.string(),
  updated_by: z.string().uuid(),
  allocation_count: z.coerce.number().int(),
  matched: z.coerce.boolean(),
  matched_bank_txn_id: z.string().uuid().nullable(),
  matched_bank_txn_date: z.string().nullable(),
  matched_bank_txn_amount: z.coerce.number().nullable(),
  matched_bank_txn_description: z.string().nullable(),
});

export const vendorPaymentListSchema = z.array(vendorPaymentRowSchema);

export type VendorPaymentRow = z.infer<typeof vendorPaymentRowSchema>;

export type VendorPaymentSearchParams = {
  from?: string | null;
  to?: string | null;
  vendorId?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
};

export type VendorPaymentUpsertPayload = {
  id?: string | null;
  vendorId: string;
  paymentDate: string;
  amount: number;
  paymentInstrumentId?: string | null;
  currency: string;
  mode: string;
  reference?: string | null;
  notes?: string | null;
  source?: string | null;
  sourceRef?: string | null;
};

export type VendorPaymentDraftPayload = {
  vendorId: string;
  paymentDate: string;
  amount: number;
  paymentInstrumentId?: string | null;
  reference?: string | null;
  notes?: string | null;
};

export async function searchVendorPayments(params: VendorPaymentSearchParams) {
  return supabase.rpc("erp_ap_vendor_payments_search", {
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_vendor_id: params.vendorId ?? null,
    p_q: params.query ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
}

export async function getVendorPayment(paymentId: string) {
  return supabase.rpc("erp_ap_vendor_payment_get", {
    p_id: paymentId,
  });
}

export async function upsertVendorPayment(payload: VendorPaymentUpsertPayload) {
  return supabase.rpc("erp_ap_vendor_payment_upsert", {
    p_id: payload.id ?? null,
    p_vendor_id: payload.vendorId,
    p_payment_date: payload.paymentDate,
    p_amount: payload.amount,
    p_payment_instrument_id: payload.paymentInstrumentId ?? null,
    p_reference: payload.reference ?? null,
    p_notes: payload.notes ?? null,
    p_currency: payload.currency,
    p_mode: payload.mode,
    p_source: payload.source ?? "manual",
    p_source_ref: payload.sourceRef ?? null,
  });
}

export async function createVendorPaymentDraft(payload: VendorPaymentDraftPayload) {
  return supabase.rpc("erp_ap_vendor_payment_create_draft", {
    p_vendor_id: payload.vendorId,
    p_payment_date: payload.paymentDate,
    p_amount: payload.amount,
    p_payment_instrument_id: payload.paymentInstrumentId ?? null,
    p_reference: payload.reference ?? null,
    p_notes: payload.notes ?? null,
  });
}

export async function approveVendorPayment(paymentId: string) {
  return supabase.rpc("erp_ap_vendor_payment_approve", {
    p_vendor_payment_id: paymentId,
  });
}

export async function setVendorPaymentAllocations(paymentId: string, allocations: unknown[]) {
  return supabase.rpc("erp_ap_vendor_payment_set_allocations", {
    p_vendor_payment_id: paymentId,
    p_allocations: allocations,
  });
}

export async function voidVendorPayment(paymentId: string, reason: string) {
  return supabase.rpc("erp_ap_vendor_payment_void", {
    p_id: paymentId,
    p_void_reason: reason,
  });
}
