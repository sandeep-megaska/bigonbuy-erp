import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageWrapperStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import VariantTypeahead, { type VariantSearchResult } from "../../../../components/inventory/VariantTypeahead";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Vendor = {
  id: string;
  legal_name: string;
};

type Warehouse = {
  id: string;
  name: string;
};

type LineDraft = {
  variant_id: string;
  qty: string;
  variant: VariantSearchResult | null;
};

export default function RfqCreatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [vendorId, setVendorId] = useState("");
  const [requestedOn, setRequestedOn] = useState(() => new Date().toISOString().split("T")[0]);
  const [neededBy, setNeededBy] = useState("");
  const [deliverToWarehouseId, setDeliverToWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ variant_id: "", qty: "", variant: null }]);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

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

      await loadData(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadData(companyId: string, isActiveFetch = true) {
    setError("");
    const [vendorRes, warehouseRes] = await Promise.all([
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (vendorRes.error || warehouseRes.error) {
      if (isActiveFetch) {
        setError(
          vendorRes.error?.message ||
            warehouseRes.error?.message ||
            "Failed to load RFQ data."
        );
      }
      return;
    }

    if (isActiveFetch) {
      setVendors((vendorRes.data || []) as Vendor[]);
      setWarehouses((warehouseRes.data || []) as Warehouse[]);
      if (vendorRes.data?.[0]?.id) setVendorId(vendorRes.data[0].id);
      if (warehouseRes.data?.[0]?.id) setDeliverToWarehouseId(warehouseRes.data[0].id);
    }
  }

  function updateLine(index: number, next: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...next } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, { variant_id: "", qty: "", variant: null }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setRequestedOn(new Date().toISOString().split("T")[0]);
    setNeededBy("");
    setNotes("");
    setLines([{ variant_id: "", qty: "", variant: null }]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin can create RFQs.");
      return;
    }
    if (!vendorId) {
      setError("Select a vendor to create an RFQ.");
      return;
    }

    const normalizedLines = lines
      .map((line) => ({
        variant_id: line.variant_id,
        qty: Number(line.qty),
        notes: null,
      }))
      .filter((line) => line.variant_id && Number.isFinite(line.qty) && line.qty > 0);

    if (normalizedLines.length === 0) {
      setError("Add at least one line with a valid quantity.");
      return;
    }

    setError("");
    const { data: rfq, error: rfqError } = await supabase
      .from("erp_rfq")
      .insert({
        company_id: ctx.companyId,
        vendor_id: vendorId,
        requested_on: requestedOn,
        needed_by: neededBy || null,
        deliver_to_warehouse_id: deliverToWarehouseId || null,
        status: "draft",
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (rfqError) {
      setError(rfqError.message);
      return;
    }

    const { error: lineError } = await supabase.from("erp_rfq_lines").insert(
      normalizedLines.map((line) => ({
        company_id: ctx.companyId,
        rfq_id: rfq.id,
        variant_id: line.variant_id,
        qty: line.qty,
        notes: line.notes,
      }))
    );

    if (lineError) {
      setError(lineError.message);
      return;
    }

    resetForm();
    router.push(`/erp/inventory/rfqs/${rfq.id}`);
  }


  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={containerStyle}>Loading RFQ form…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={containerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>New RFQ</h1>
            <p style={subtitleStyle}>Capture vendor enquiry details before collecting a quote.</p>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section style={cardStyle}>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                Vendor
                <select style={inputStyle} value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
                  <option value="">Select vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Requested On
                <input
                  style={inputStyle}
                  type="date"
                  value={requestedOn}
                  onChange={(event) => setRequestedOn(event.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Needed By
                <input
                  style={inputStyle}
                  type="date"
                  value={neededBy}
                  onChange={(event) => setNeededBy(event.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                Deliver To
                <select
                  style={inputStyle}
                  value={deliverToWarehouseId}
                  onChange={(event) => setDeliverToWarehouseId(event.target.value)}
                >
                  <option value="">Select warehouse</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              Notes
              <textarea
                style={{ ...inputStyle, minHeight: 90, width: "100%" }}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>

            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>RFQ Lines</div>
              <table style={{ ...tableStyle, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 260 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: "auto" }} />
                  <col style={{ width: 160 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>SKU</th>
                    <th style={tableHeaderCellStyle}>Style</th>
                    <th style={tableHeaderCellStyle}>HSN</th>
                    <th style={tableHeaderCellStyle}>Item</th>
                    <th style={tableHeaderCellStyle}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.variant_id}-${index}`}>
                      <td style={tableCellStyle}>
                        <VariantTypeahead
                          valueVariantId={line.variant_id}
                          valueVariant={line.variant}
                          onSelect={(variant) =>
                            updateLine(index, {
                              variant_id: variant?.variant_id || "",
                              variant,
                            })
                          }
                          onError={setError}
                        />
                      </td>
                      <td style={tableCellStyle}>{line.variant?.style_code || "—"}</td>
                      <td style={tableCellStyle}>{line.variant?.hsn_code || "—"}</td>
                      <td style={tableCellStyle}>{line.variant?.title || "—"}</td>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            style={{ ...inputStyle, width: 120 }}
                            type="number"
                            min="0"
                            value={line.qty}
                            onChange={(event) => updateLine(index, { qty: event.target.value })}
                          />
                          {lines.length > 1 ? (
                            <button type="button" style={secondaryButtonStyle} onClick={() => removeLine(index)}>
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" style={{ ...secondaryButtonStyle, marginTop: 12 }} onClick={addLine}>
                Add Line
              </button>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canWrite}>
                Save Draft
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => router.push("/erp/inventory/rfqs")}
              >
                Back to RFQs
              </button>
            </div>
          </form>
        </section>
      </div>
    </ErpShell>
  );
}

const containerStyle: CSSProperties = {
  ...pageWrapperStyle,
  ...pageContainerStyle,
};
