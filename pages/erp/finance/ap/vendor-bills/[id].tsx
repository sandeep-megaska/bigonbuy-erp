import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import {
  vendorAdvanceAllocate,
  vendorAdvanceAllocations,
  vendorAdvanceCreate,
  vendorAdvanceList,
  vendorAdvancePost,
  vendorBillDetail,
  vendorBillLineUpsert,
  vendorBillLineVoid,
  vendorBillPost,
  vendorBillPreview,
  vendorBillUpsert,
  vendorTdsProfileLatest,
} from "../../../../../lib/erp/vendorBills";
import { supabase } from "../../../../../lib/supabaseClient";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value || 0);

type VendorOption = { id: string; legal_name: string; gstin: string | null };

type VariantOption = { id: string; sku: string | null; title: string | null };

type PurchaseOrderOption = { id: string; po_no: string; vendor_id: string };

type GrnOption = { id: string; grn_no: string; purchase_order_id: string };

type BillLine = {
  id?: string;
  localId: string;
  line_no: number;
  variant_id: string;
  description: string;
  hsn: string;
  qty: number;
  unit_rate: number;
  line_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
};

type BillHeader = {
  id?: string;
  bill_no: string;
  bill_date: string;
  due_date: string;
  vendor_id: string;
  vendor_gstin: string;
  place_of_supply_state_code: string;
  po_id: string;
  grn_id: string;
  note: string;
  tds_section: string;
  tds_rate: string;
  status: string;
  finance_journal_id?: string | null;
  subtotal?: number;
  gst_total?: number;
  total?: number;
  tds_amount?: number;
  net_payable?: number;
  created_at?: string;
  updated_at?: string;
};

type AdvanceRow = {
  advance_id: string;
  vendor_id: string;
  vendor_name: string;
  advance_date: string;
  amount: number;
  status: string;
  reference: string | null;
  payment_instrument_id: string | null;
  finance_journal_id: string | null;
  is_void: boolean;
};

type AdvanceAllocation = {
  allocation_id: string;
  advance_id: string;
  allocated_amount: number;
  advance_amount: number;
  advance_date: string;
  reference: string | null;
  status: string;
  is_void: boolean;
};

const emptyHeader: BillHeader = {
  bill_no: "",
  bill_date: new Date().toISOString().slice(0, 10),
  due_date: "",
  vendor_id: "",
  vendor_gstin: "",
  place_of_supply_state_code: "",
  po_id: "",
  grn_id: "",
  note: "",
  tds_section: "",
  tds_rate: "",
  status: "draft",
};

const newLine = (lineNo: number): BillLine => ({
  localId: `${Date.now()}-${lineNo}`,
  line_no: lineNo,
  variant_id: "",
  description: "",
  hsn: "",
  qty: 0,
  unit_rate: 0,
  line_amount: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  cess: 0,
});

export default function VendorBillDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const billId = typeof id === "string" ? id : "";
  const isNew = billId === "new" || !billId;

  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [header, setHeader] = useState<BillHeader>(emptyHeader);
  const [lines, setLines] = useState<BillLine[]>([newLine(1)]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [grns, setGrns] = useState<GrnOption[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [allocations, setAllocations] = useState<AdvanceAllocation[]>([]);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [paymentAccounts, setPaymentAccounts] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceDate, setAdvanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [advanceReference, setAdvanceReference] = useState("");
  const [advanceAccountId, setAdvanceAccountId] = useState("");

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + (line.line_amount || 0), 0);
    const gstTotal = lines.reduce((sum, line) => sum + line.cgst + line.sgst + line.igst + line.cess, 0);
    const total = subtotal + gstTotal;
    const tdsRate = Number(header.tds_rate || 0) || 0;
    const tdsAmount = (subtotal * tdsRate) / 100;
    const netPayable = total - tdsAmount;
    return { subtotal, gstTotal, total, tdsAmount, netPayable };
  }, [lines, header.tds_rate]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await Promise.all([loadVendors(context.companyId), loadVariants(context.companyId), loadPaymentAccounts()]);

      if (!isNew) {
        await loadBillDetail(billId);
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, billId, isNew]);

  useEffect(() => {
    if (!header.vendor_id) return;
    loadVendorLinkedData(header.vendor_id);
    loadVendorTds(header.vendor_id, header.bill_date);
  }, [header.vendor_id, header.bill_date]);

  const loadVendors = async (companyId: string) => {
    const { data, error: loadError } = await supabase
      .from("erp_vendors")
      .select("id, legal_name, gstin")
      .eq("company_id", companyId)
      .order("legal_name");

    if (loadError) {
      setError(loadError.message || "Failed to load vendors.");
      return;
    }

    setVendors((data || []) as VendorOption[]);
  };

  const loadVariants = async (companyId: string) => {
    const { data, error: loadError } = await supabase
      .from("erp_variants")
      .select("id, sku, title")
      .eq("company_id", companyId)
      .order("sku")
      .limit(200);

    if (loadError) {
      setError(loadError.message || "Failed to load variants.");
      return;
    }

    setVariants((data || []) as VariantOption[]);
  };

  const loadPaymentAccounts = async () => {
    const { data, error: loadError } = await supabase.rpc("erp_gl_accounts_picklist", {
      p_q: null,
      p_include_inactive: false,
    });

    if (loadError) {
      setError(loadError.message || "Failed to load payment accounts.");
      return;
    }

    setPaymentAccounts((data || []) as Array<{ id: string; code: string; name: string }>);
  };

  const loadVendorLinkedData = async (vendorId: string) => {
    if (!ctx?.companyId) return;
    const [poRes, advancesRes] = await Promise.all([
      supabase
        .from("erp_purchase_orders")
        .select("id, po_no, vendor_id")
        .eq("company_id", ctx.companyId)
        .eq("vendor_id", vendorId)
        .order("order_date", { ascending: false }),
      vendorAdvanceList(vendorId, "approved"),
    ]);

    if (poRes.error) {
      setError(poRes.error.message || "Failed to load purchase orders.");
    } else {
      setPurchaseOrders((poRes.data || []) as PurchaseOrderOption[]);
    }

    if (!poRes.error) {
      const poIds = (poRes.data || []).map((po) => po.id);
      if (poIds.length) {
        const { data, error: grnError } = await supabase
          .from("erp_grns")
          .select("id, grn_no, purchase_order_id")
          .eq("company_id", ctx.companyId)
          .in("purchase_order_id", poIds)
          .order("received_at", { ascending: false });

        if (grnError) {
          setError(grnError.message || "Failed to load GRNs.");
        } else {
          setGrns((data || []) as GrnOption[]);
        }
      } else {
        setGrns([]);
      }
    }

    if (advancesRes.error) {
      setError(advancesRes.error.message || "Failed to load advances.");
    } else {
      setAdvances((advancesRes.data || []) as AdvanceRow[]);
    }

    if (!isNew && billId) {
      await loadAllocations(billId);
    }
  };

  const loadBillDetail = async (targetId: string) => {
    const { data, error: loadError } = await vendorBillDetail(targetId);

    if (loadError) {
      setError(loadError.message || "Failed to load vendor bill.");
      return;
    }

    const detail = data as any;
    if (!detail?.header) return;

    setHeader({
      id: detail.header.id,
      bill_no: detail.header.bill_no || "",
      bill_date: detail.header.bill_date || new Date().toISOString().slice(0, 10),
      due_date: detail.header.due_date || "",
      vendor_id: detail.header.vendor_id || "",
      vendor_gstin: detail.header.vendor_gstin || "",
      place_of_supply_state_code: detail.header.place_of_supply_state_code || "",
      po_id: detail.header.po_id || "",
      grn_id: detail.header.grn_id || "",
      note: detail.header.note || "",
      tds_section: detail.header.tds_section || "",
      tds_rate: detail.header.tds_rate != null ? String(detail.header.tds_rate) : "",
      status: detail.header.status || "draft",
      finance_journal_id: detail.header.finance_journal_id,
      subtotal: detail.header.subtotal,
      gst_total: detail.header.gst_total,
      total: detail.header.total,
      tds_amount: detail.header.tds_amount,
      net_payable: detail.header.net_payable,
      created_at: detail.header.created_at,
      updated_at: detail.header.updated_at,
    });

    const loadedLines = (detail.lines || []).map((line: any) => ({
      id: line.id,
      localId: line.id,
      line_no: line.line_no,
      variant_id: line.variant_id || "",
      description: line.description || "",
      hsn: line.hsn || "",
      qty: Number(line.qty || 0),
      unit_rate: Number(line.unit_rate || 0),
      line_amount: Number(line.line_amount || line.taxable_value || 0),
      cgst: Number(line.cgst || 0),
      sgst: Number(line.sgst || 0),
      igst: Number(line.igst || 0),
      cess: Number(line.cess || 0),
    }));

    setLines(loadedLines.length ? loadedLines : [newLine(1)]);
  };

  const loadVendorTds = async (vendorId: string, forDate: string) => {
    if (!vendorId) return;
    const { data, error: loadError } = await vendorTdsProfileLatest(vendorId, forDate);
    if (loadError) {
      setError(loadError.message || "Failed to load TDS profile.");
      return;
    }

    if (!header.tds_section && data?.tds_section) {
      setHeader((prev) => ({
        ...prev,
        tds_section: data.tds_section || "",
        tds_rate: data.tds_rate != null ? String(data.tds_rate) : "",
      }));
    }
  };

  const loadAllocations = async (targetId: string) => {
    const { data, error: loadError } = await vendorAdvanceAllocations(targetId);
    if (loadError) {
      setError(loadError.message || "Failed to load advance allocations.");
      return;
    }

    setAllocations((data || []) as AdvanceAllocation[]);
  };

  const handleHeaderChange = (field: keyof BillHeader, value: string) => {
    setHeader((prev) => ({ ...prev, [field]: value }));
  };

  const handleLineChange = (lineId: string, field: keyof BillLine, value: string) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.localId !== lineId) return line;
        const next = { ...line, [field]: value } as BillLine;
        if (field === "qty" || field === "unit_rate") {
          const qty = Number(next.qty || 0);
          const rate = Number(next.unit_rate || 0);
          next.line_amount = qty * rate;
        }
        return next;
      })
    );
  };

  const addLine = () => {
    setLines((prev) => [...prev, newLine(prev.length + 1)]);
  };

  const removeLine = async (line: BillLine) => {
    if (line.id) {
      const { error: voidError } = await vendorBillLineVoid(line.id, "Removed from bill");
      if (voidError) {
        setError(voidError.message || "Failed to void line.");
        return;
      }
    }
    setLines((prev) => prev.filter((item) => item.localId !== line.localId));
  };

  const handleSave = async () => {
    if (!header.vendor_id) {
      setError("Vendor is required.");
      return;
    }
    if (!header.bill_no) {
      setError("Bill number is required.");
      return;
    }

    setError("");
    const payload = {
      id: header.id,
      vendor_id: header.vendor_id,
      bill_no: header.bill_no,
      bill_date: header.bill_date,
      due_date: header.due_date || null,
      vendor_gstin: header.vendor_gstin || null,
      place_of_supply_state_code: header.place_of_supply_state_code || null,
      po_id: header.po_id || null,
      grn_id: header.grn_id || null,
      note: header.note || null,
      tds_section: header.tds_section || null,
      tds_rate: header.tds_rate ? Number(header.tds_rate) : null,
    };

    const { data, error: saveError } = await vendorBillUpsert(payload);
    if (saveError) {
      setError(saveError.message || "Failed to save vendor bill.");
      return;
    }

    const savedBillId = (data as unknown as string) || header.id;

    for (const [index, line] of lines.entries()) {
      const linePayload = {
        id: line.id,
        bill_id: savedBillId,
        line_no: index + 1,
        variant_id: line.variant_id || null,
        description: line.description || null,
        hsn: line.hsn || null,
        qty: Number(line.qty || 0),
        unit_rate: Number(line.unit_rate || 0),
        line_amount: Number(line.line_amount || 0),
        taxable_value: Number(line.line_amount || 0),
        cgst: Number(line.cgst || 0),
        sgst: Number(line.sgst || 0),
        igst: Number(line.igst || 0),
        cess: Number(line.cess || 0),
      };

      const { error: lineError } = await vendorBillLineUpsert(linePayload);
      if (lineError) {
        setError(lineError.message || "Failed to save line item.");
        return;
      }
    }

    if (isNew && savedBillId) {
      router.replace(`/erp/finance/ap/vendor-bills/${savedBillId}`);
      return;
    }

    await loadBillDetail(savedBillId as string);
  };

  const handlePreview = async () => {
    if (!header.id) return;
    const { data, error: previewError } = await vendorBillPreview(header.id);
    if (previewError) {
      setError(previewError.message || "Failed to preview posting.");
      return;
    }
    setPreview(data);
  };

  const handlePost = async () => {
    if (!header.id) return;
    const { error: postError } = await vendorBillPost(header.id);
    if (postError) {
      setError(postError.message || "Failed to post vendor bill.");
      return;
    }
    await loadBillDetail(header.id);
    await handlePreview();
  };

  const handleAdvanceAllocate = async (advanceId: string) => {
    if (!header.id) return;
    const amount = Number(allocationAmounts[advanceId] || 0);
    if (!amount) return;
    const { error: allocateError } = await vendorAdvanceAllocate(header.id, advanceId, amount);
    if (allocateError) {
      setError(allocateError.message || "Failed to allocate advance.");
      return;
    }
    setAllocationAmounts((prev) => ({ ...prev, [advanceId]: "" }));
    await loadAllocations(header.id);
  };

  const handleCreateAdvance = async () => {
    if (!header.vendor_id) {
      setError("Select vendor before creating advance.");
      return;
    }
    if (!advanceAmount || !advanceAccountId) {
      setError("Advance amount and payment account are required.");
      return;
    }

    const { data, error: createError } = await vendorAdvanceCreate({
      p_vendor_id: header.vendor_id,
      p_amount: Number(advanceAmount),
      p_advance_date: advanceDate,
      p_payment_instrument_id: advanceAccountId,
      p_reference: advanceReference || null,
      p_po_id: header.po_id || null,
      p_notes: "Created from vendor bill",
    });

    if (createError) {
      setError(createError.message || "Failed to create advance.");
      return;
    }

    const advanceId = data as string;
    const { error: postError } = await vendorAdvancePost(advanceId);
    if (postError) {
      setError(postError.message || "Failed to post advance.");
      return;
    }

    setAdvanceAmount("");
    setAdvanceReference("");
    await loadVendorLinkedData(header.vendor_id);
  };

  const remainingAdvanceMap = useMemo(() => {
    const map = new Map<string, number>();
    advances.forEach((advance) => {
      const allocated = allocations
        .filter((allocation) => allocation.advance_id === advance.advance_id)
        .reduce((sum, allocation) => sum + allocation.allocated_amount, 0);
      map.set(advance.advance_id, Math.max(advance.amount - allocated, 0));
    });
    return map;
  }, [advances, allocations]);

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Vendor Bill"
          subtitle="Link PO/GRN, capture GST, TDS, and post AP journals."
          actions={
            <button type="button" style={primaryButtonStyle} onClick={handleSave}>
              Save Bill
            </button>
          }
        />

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Bill Header</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              Vendor
              <select
                style={inputStyle}
                value={header.vendor_id}
                onChange={(e) => handleHeaderChange("vendor_id", e.target.value)}
              >
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Bill No
              <input style={inputStyle} value={header.bill_no} onChange={(e) => handleHeaderChange("bill_no", e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Bill Date
              <input
                style={inputStyle}
                type="date"
                value={header.bill_date}
                onChange={(e) => handleHeaderChange("bill_date", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Due Date
              <input
                style={inputStyle}
                type="date"
                value={header.due_date}
                onChange={(e) => handleHeaderChange("due_date", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Vendor GSTIN
              <input
                style={inputStyle}
                value={header.vendor_gstin}
                onChange={(e) => handleHeaderChange("vendor_gstin", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Place of Supply
              <input
                style={inputStyle}
                value={header.place_of_supply_state_code}
                onChange={(e) => handleHeaderChange("place_of_supply_state_code", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Linked PO
              <select style={inputStyle} value={header.po_id} onChange={(e) => handleHeaderChange("po_id", e.target.value)}>
                <option value="">None</option>
                {purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.po_no}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Linked GRN
              <select style={inputStyle} value={header.grn_id} onChange={(e) => handleHeaderChange("grn_id", e.target.value)}>
                <option value="">None</option>
                {grns.map((grn) => (
                  <option key={grn.id} value={grn.id}>
                    {grn.grn_no}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Status
              <input style={inputStyle} value={header.status} disabled />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
            Notes
            <textarea
              style={{ ...inputStyle, minHeight: 80 }}
              value={header.note}
              onChange={(e) => handleHeaderChange("note", e.target.value)}
            />
          </label>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Line Items</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>#</th>
                  <th style={tableHeaderCellStyle}>Variant</th>
                  <th style={tableHeaderCellStyle}>Description</th>
                  <th style={tableHeaderCellStyle}>HSN</th>
                  <th style={tableHeaderCellStyle}>Qty</th>
                  <th style={tableHeaderCellStyle}>Rate</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>CGST</th>
                  <th style={tableHeaderCellStyle}>SGST</th>
                  <th style={tableHeaderCellStyle}>IGST</th>
                  <th style={tableHeaderCellStyle}>Cess</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.localId}>
                    <td style={tableCellStyle}>{index + 1}</td>
                    <td style={tableCellStyle}>
                      <select
                        style={inputStyle}
                        value={line.variant_id}
                        onChange={(e) => handleLineChange(line.localId, "variant_id", e.target.value)}
                      >
                        <option value="">Select</option>
                        {variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.sku ? `${variant.sku} - ${variant.title || ""}` : variant.id}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        value={line.description}
                        onChange={(e) => handleLineChange(line.localId, "description", e.target.value)}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        value={line.hsn}
                        onChange={(e) => handleLineChange(line.localId, "hsn", e.target.value)}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        value={line.qty}
                        onChange={(e) => handleLineChange(line.localId, "qty", e.target.value)}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        value={line.unit_rate}
                        onChange={(e) => handleLineChange(line.localId, "unit_rate", e.target.value)}
                      />
                    </td>
                    <td style={tableCellStyle}>{formatMoney(line.line_amount)}</td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        value={line.cgst}
                        onChange={(e) => handleLineChange(line.localId, "cgst", e.target.value)}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        value={line.sgst}
                        onChange={(e) => handleLineChange(line.localId, "sgst", e.target.value)}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        value={line.igst}
                        onChange={(e) => handleLineChange(line.localId, "igst", e.target.value)}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <input
                        style={inputStyle}
                        type="number"
                        value={line.cess}
                        onChange={(e) => handleLineChange(line.localId, "cess", e.target.value)}
                      />
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => removeLine(line)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={secondaryButtonStyle} onClick={addLine}>
              Add Line
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Tax & TDS Summary</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <strong>Subtotal:</strong> {formatMoney(totals.subtotal)}
            </div>
            <div>
              <strong>GST Total:</strong> {formatMoney(totals.gstTotal)}
            </div>
            <div>
              <strong>Total:</strong> {formatMoney(totals.total)}
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              TDS Section
              <input
                style={inputStyle}
                value={header.tds_section}
                onChange={(e) => handleHeaderChange("tds_section", e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              TDS Rate (%)
              <input
                style={inputStyle}
                type="number"
                value={header.tds_rate}
                onChange={(e) => handleHeaderChange("tds_rate", e.target.value)}
              />
            </label>
            <div>
              <strong>TDS Amount:</strong> {formatMoney(totals.tdsAmount)}
            </div>
            <div>
              <strong>Net Payable:</strong> {formatMoney(totals.netPayable)}
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Advances & Allocations</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              Advance Amount
              <input style={inputStyle} value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Advance Date
              <input
                style={inputStyle}
                type="date"
                value={advanceDate}
                onChange={(e) => setAdvanceDate(e.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Payment Account
              <select style={inputStyle} value={advanceAccountId} onChange={(e) => setAdvanceAccountId(e.target.value)}>
                <option value="">Select account</option>
                {paymentAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Reference
              <input
                style={inputStyle}
                value={advanceReference}
                onChange={(e) => setAdvanceReference(e.target.value)}
              />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={secondaryButtonStyle} onClick={handleCreateAdvance}>
              Create & Post Advance
            </button>
          </div>

          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Advance Date</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Available</th>
                  <th style={tableHeaderCellStyle}>Allocate</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {advances.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No approved advances.
                    </td>
                  </tr>
                ) : (
                  advances.map((advance) => (
                    <tr key={advance.advance_id}>
                      <td style={tableCellStyle}>{advance.advance_date}</td>
                      <td style={tableCellStyle}>{advance.reference || "—"}</td>
                      <td style={tableCellStyle}>{formatMoney(advance.amount)}</td>
                      <td style={tableCellStyle}>{formatMoney(remainingAdvanceMap.get(advance.advance_id) || 0)}</td>
                      <td style={tableCellStyle}>
                        <input
                          style={inputStyle}
                          value={allocationAmounts[advance.advance_id] || ""}
                          onChange={(e) =>
                            setAllocationAmounts((prev) => ({ ...prev, [advance.advance_id]: e.target.value }))
                          }
                        />
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => handleAdvanceAllocate(advance.advance_id)}
                        >
                          Allocate
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Advance</th>
                  <th style={tableHeaderCellStyle}>Allocated Amount</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {allocations.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={3}>
                      No allocations yet.
                    </td>
                  </tr>
                ) : (
                  allocations.map((allocation) => (
                    <tr key={allocation.allocation_id}>
                      <td style={tableCellStyle}>{allocation.reference || allocation.advance_id}</td>
                      <td style={tableCellStyle}>{formatMoney(allocation.allocated_amount)}</td>
                      <td style={tableCellStyle}>{allocation.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Posting</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={secondaryButtonStyle} onClick={handlePreview} disabled={!header.id}>
              Preview Journal
            </button>
            <button type="button" style={primaryButtonStyle} onClick={handlePost} disabled={!header.id}>
              Post Bill
            </button>
          </div>
          {preview ? (
            <div style={{ marginTop: 12 }}>
              <p>
                <strong>Subtotal:</strong> {formatMoney(preview.totals?.subtotal || 0)} | <strong>GST:</strong>{" "}
                {formatMoney(preview.totals?.gst_total || 0)} | <strong>TDS:</strong>{" "}
                {formatMoney(preview.totals?.tds_amount || 0)} | <strong>Net Payable:</strong>{" "}
                {formatMoney(preview.totals?.net_payable || 0)}
              </p>
              {preview.errors?.length ? (
                <div style={{ color: "#b91c1c" }}>
                  {preview.errors.map((msg: string, idx: number) => (
                    <div key={`${msg}-${idx}`}>{msg}</div>
                  ))}
                </div>
              ) : null}
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Account</th>
                      <th style={tableHeaderCellStyle}>Memo</th>
                      <th style={tableHeaderCellStyle}>Debit</th>
                      <th style={tableHeaderCellStyle}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preview.journal_lines || []).map((line: any, index: number) => (
                      <tr key={`${line.account_code}-${index}`}>
                        <td style={tableCellStyle}>
                          {line.account_code} - {line.account_name}
                        </td>
                        <td style={tableCellStyle}>{line.memo}</td>
                        <td style={tableCellStyle}>{formatMoney(Number(line.debit || 0))}</td>
                        <td style={tableCellStyle}>{formatMoney(Number(line.credit || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Audit</h2>
          <p>
            <strong>Created:</strong> {header.created_at || "—"}
          </p>
          <p>
            <strong>Updated:</strong> {header.updated_at || "—"}
          </p>
        </section>
      </div>
    </ErpShell>
  );
}
