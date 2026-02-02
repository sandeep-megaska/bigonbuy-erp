import { supabase } from "../supabaseClient";

export const vendorBillList = (params: {
  from: string;
  to: string;
  vendorId?: string | null;
  status?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
}) =>
  supabase.rpc("erp_ap_vendor_bills_list", {
    p_from: params.from,
    p_to: params.to,
    p_vendor_id: params.vendorId ?? null,
    p_status: params.status ?? null,
    p_q: params.query ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });

export const vendorBillDetail = (billId: string) =>
  supabase.rpc("erp_ap_vendor_bill_detail", {
    p_bill_id: billId,
  });

export const vendorBillUpsert = (payload: Record<string, unknown>) =>
  supabase.rpc("erp_ap_vendor_bill_upsert", {
    p_bill: payload,
  });

export const vendorBillLineUpsert = (payload: Record<string, unknown>) =>
  supabase.rpc("erp_ap_vendor_bill_line_upsert", {
    p_line: payload,
  });

export const vendorBillLineVoid = (lineId: string, reason?: string | null) =>
  supabase.rpc("erp_ap_vendor_bill_line_void", {
    p_line_id: lineId,
    p_reason: reason ?? null,
  });

export const vendorBillPreview = (billId: string) =>
  supabase.rpc("erp_ap_vendor_bill_post_preview", {
    p_bill_id: billId,
  });

export const vendorBillPost = (billId: string) =>
  supabase.rpc("erp_ap_vendor_bill_post", {
    p_bill_id: billId,
    p_use_maker_checker: false,
  });

export const vendorAdvanceList = (vendorId?: string | null, status?: string | null) =>
  supabase.rpc("erp_ap_vendor_advances_list", {
    p_vendor_id: vendorId ?? null,
    p_status: status ?? null,
  });

export const vendorAdvanceCreate = (payload: Record<string, unknown>) =>
  supabase.rpc("erp_ap_vendor_advance_create", payload);

export const vendorAdvancePost = (advanceId: string) =>
  supabase.rpc("erp_ap_vendor_advance_approve_and_post", {
    p_advance_id: advanceId,
    p_use_maker_checker: false,
  });

export const vendorAdvanceAllocations = (billId: string) =>
  supabase.rpc("erp_ap_vendor_bill_advance_allocations_list", {
    p_bill_id: billId,
  });

export const vendorAdvanceAllocate = (billId: string, advanceId: string, amount: number) =>
  supabase.rpc("erp_ap_vendor_bill_advance_allocate", {
    p_bill_id: billId,
    p_advance_id: advanceId,
    p_amount: amount,
  });

export const vendorAdvanceVoidAllocation = (allocationId: string, reason?: string | null) =>
  supabase.rpc("erp_ap_vendor_bill_advance_void", {
    p_allocation_id: allocationId,
    p_reason: reason ?? null,
  });

export const vendorTdsProfileLatest = (vendorId: string, forDate?: string | null) =>
  supabase.rpc("erp_vendor_tds_profile_latest", {
    p_vendor_id: vendorId,
    p_for_date: forDate ?? null,
  });
