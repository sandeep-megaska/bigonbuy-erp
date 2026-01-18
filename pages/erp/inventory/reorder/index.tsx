import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { useReorderSuggestions } from "../../../../lib/erp/inventoryReorder";
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { useDebouncedValue } from "../../../../lib/erp/inventoryStock";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type WarehouseOption = {
  id: string;
  name: string;
  code: string | null;
};

type VendorOption = {
  id: string;
  legal_name: string;
};

type ReorderRowDraft = {
  warehouse_id: string;
  variant_id: string;
  min_qty: number;
  target_qty: number | null;
  preferred_vendor_id: string | null;
};

const PAGE_SIZE = 100;
const reorderSaveResponseSchema = z.object({ saved: z.number() });

export default function InventoryReorderPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyBelowMin, setOnlyBelowMin] = useState(true);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<ReorderRowDraft[]>([]);
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [modalVendorId, setModalVendorId] = useState<string>("");
  const [modalReference, setModalReference] = useState("");
  const [modalNotes, setModalNotes] = useState("");

  const debouncedQuery = useDebouncedValue(searchQuery, 300);

  const canWrite = useMemo(() => (ctx ? isInventoryWriter(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx({
        companyId: context.companyId,
        roleKey: context.roleKey,
        membershipError: context.membershipError,
      });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    (async () => {
      const [warehouseRes, vendorRes] = await Promise.all([
        supabase
          .from("erp_warehouses")
          .select("id, name, code")
          .eq("company_id", ctx.companyId)
          .order("name", { ascending: true }),
        supabase
          .from("erp_vendors")
          .select("id, legal_name")
          .eq("company_id", ctx.companyId)
          .order("legal_name", { ascending: true }),
      ]);

      if (!active) return;

      if (warehouseRes.error || vendorRes.error) {
        setError(warehouseRes.error?.message || vendorRes.error?.message || "Failed to load reorder context.");
        return;
      }

      const warehouseRows = (warehouseRes.data || []) as WarehouseOption[];
      setWarehouses(warehouseRows);
      setVendors((vendorRes.data || []) as VendorOption[]);

      if (!warehouseId) {
        const jaipur = warehouseRows.find((row) => row.name.toLowerCase() === "jaipur");
        setWarehouseId(jaipur?.id || warehouseRows[0]?.id || "");
      }
    })().catch((loadError: Error) => {
      if (active) setError(loadError.message || "Failed to load reorder context.");
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, warehouseId]);

  useEffect(() => {
    setOffset(0);
  }, [warehouseId, onlyBelowMin, debouncedQuery]);

  const { data: suggestionRows, loading: suggestionsLoading, error: suggestionsError } = useReorderSuggestions({
    companyId: ctx?.companyId ?? null,
    warehouseId: warehouseId || null,
    query: debouncedQuery,
    onlyBelowMin,
    limit: PAGE_SIZE,
    offset,
  });

  useEffect(() => {
    const draftRows = suggestionRows.map((row) => ({
      warehouse_id: row.warehouse_id,
      variant_id: row.variant_id,
      min_qty: Math.max(0, Math.trunc(row.min_qty ?? 0)),
      target_qty: row.target_qty !== null ? Math.trunc(row.target_qty) : null,
      preferred_vendor_id: row.preferred_vendor_id ?? null,
    }));
    setRows(draftRows);
    setDirtyMap({});
    setSelectedKeys({});
  }, [suggestionRows]);

  function rowKey(row: { warehouse_id: string; variant_id: string }) {
    return `${row.warehouse_id}:${row.variant_id}`;
  }

  function updateRow(
    row: ReorderRowDraft,
    update: Partial<Pick<ReorderRowDraft, "min_qty" | "target_qty" | "preferred_vendor_id">>
  ) {
    const key = rowKey(row);
    setRows((prev) =>
      prev.map((item) =>
        item.warehouse_id === row.warehouse_id && item.variant_id === row.variant_id
          ? { ...item, ...update }
          : item
      )
    );
    setDirtyMap((prev) => ({ ...prev, [key]: true }));
  }

  const rowsByKey = useMemo(() => {
    const map = new Map<string, ReorderRowDraft>();
    rows.forEach((row) => {
      map.set(rowKey(row), row);
    });
    return map;
  }, [rows]);

  const hasDirtyRows = Object.values(dirtyMap).some(Boolean);

  const selectedRows = useMemo(() => {
    return Object.entries(selectedKeys)
      .filter(([, value]) => value)
      .map(([key]) => rowsByKey.get(key))
      .filter((row): row is ReorderRowDraft => Boolean(row));
  }, [selectedKeys, rowsByKey]);

  async function handleSaveRules() {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin/inventory can update reorder rules.");
      return;
    }

    const payload = Object.entries(dirtyMap)
      .filter(([, value]) => value)
      .map(([key]) => rowsByKey.get(key))
      .filter((row): row is ReorderRowDraft => Boolean(row))
      .map((row) => ({
        warehouse_id: row.warehouse_id,
        variant_id: row.variant_id,
        min_qty: Math.max(0, Math.trunc(row.min_qty)),
        target_qty: row.target_qty !== null ? Math.trunc(row.target_qty) : null,
        reorder_qty: null,
        preferred_vendor_id: row.preferred_vendor_id,
        is_active: true,
      }));

    if (payload.length === 0) {
      setNotice("No rule changes to save.");
      return;
    }

    setError(null);
    setNotice(null);

    const { data, error: saveError } = await supabase.rpc("erp_reorder_rules_upsert", {
      p_rows: payload,
    });

    if (saveError) {
      setError(saveError.message);
      return;
    }

    const parsed = reorderSaveResponseSchema.safeParse(data ?? null);
    if (!parsed.success) {
      setError("Failed to parse reorder save response.");
      return;
    }

    setNotice(`Saved ${parsed.data.saved} reorder rule${parsed.data.saved === 1 ? "" : "s"}.`);
    setDirtyMap({});
  }

  function openCreateModal() {
    if (selectedRows.length === 0) {
      setError("Select at least one SKU to create a purchase order draft.");
      return;
    }

    const preferredIds = Array.from(
      new Set(selectedRows.map((row) => row.preferred_vendor_id).filter(Boolean))
    ) as string[];

    const defaultVendor = preferredIds.length === 1 ? preferredIds[0] : vendors[0]?.id || "";
    setModalVendorId(defaultVendor);
    setModalReference("");
    setModalNotes("");
    setModalOpen(true);
  }

  async function handleCreatePo() {
    if (!ctx?.companyId || !warehouseId) return;
    if (!canWrite) {
      setError("Only owner/admin/inventory can create purchase orders.");
      return;
    }
    if (!modalVendorId) {
      setError("Select a vendor to create a purchase order draft.");
      return;
    }

    const selectedSuggestionRows = suggestionRows.filter((row) => selectedKeys[rowKey(row)]);
    const items = selectedSuggestionRows
      .map((row) => ({
        variant_id: row.variant_id,
        qty: Math.max(0, Math.trunc(row.suggested_qty)),
      }))
      .filter((row) => row.qty > 0);

    if (items.length === 0) {
      setError("Selected rows have no suggested quantities.");
      return;
    }

    setError(null);
    setNotice(null);

    const { data, error: createError } = await supabase.rpc("erp_po_create_from_reorder", {
      p_vendor_id: modalVendorId,
      p_warehouse_id: warehouseId,
      p_items: items,
      p_reference: modalReference.trim() || null,
      p_notes: modalNotes.trim() || null,
    });

    if (createError) {
      setError(createError.message);
      return;
    }

    const parsed = z.string().uuid().safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse purchase order response.");
      return;
    }

    setModalOpen(false);
    setSelectedKeys({});
    router.push(`/erp/inventory/purchase-orders/${parsed.data}`);
  }

  const displayError = error || suggestionsError;
  const hasNextPage = suggestionRows.length === PAGE_SIZE;

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading reorder planner…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Reorder</p>
            <h1 style={h1Style}>Reorder Planner</h1>
            <p style={subtitleStyle}>Plan purchase order drafts from low stock rules.</p>
          </div>
          <div style={actionRowStyle}>
            <button type="button" style={secondaryButtonStyle} onClick={handleSaveRules} disabled={!hasDirtyRows}>
              Save Rules
            </button>
            <button type="button" style={primaryButtonStyle} onClick={openCreateModal}>
              Create PO Draft
            </button>
          </div>
        </header>

        {displayError ? <div style={errorStyle}>{displayError}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <div style={filterRowStyle}>
            <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} style={inputStyle}>
              <option value="">Select warehouse</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search SKU / style / title"
              style={inputStyle}
            />
            <label style={toggleStyle}>
              <input
                type="checkbox"
                checked={onlyBelowMin}
                onChange={(event) => setOnlyBelowMin(event.target.checked)}
              />
              Below min only
            </label>
          </div>
        </section>

        {suggestionsLoading ? <div style={mutedStyle}>Loading reorder suggestions…</div> : null}

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={tableHeaderCellStyle}>Select</th>
              <th style={tableHeaderCellStyle}>SKU</th>
              <th style={tableHeaderCellStyle}>Title</th>
              <th style={tableHeaderCellStyle}>Size</th>
              <th style={tableHeaderCellStyle}>Color</th>
              <th style={tableHeaderCellStyle}>HSN</th>
              <th style={tableHeaderCellStyle}>On Hand</th>
              <th style={tableHeaderCellStyle}>Min</th>
              <th style={tableHeaderCellStyle}>Target</th>
              <th style={tableHeaderCellStyle}>Suggested</th>
              <th style={tableHeaderCellStyle}>Preferred Vendor</th>
            </tr>
          </thead>
          <tbody>
            {suggestionRows.map((row) => {
              const draft = rowsByKey.get(rowKey(row));
              const selected = Boolean(selectedKeys[rowKey(row)]);
              return (
                <tr key={rowKey(row)}>
                  <td style={tableCellStyle}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) =>
                        setSelectedKeys((prev) => ({ ...prev, [rowKey(row)]: event.target.checked }))
                      }
                    />
                  </td>
                  <td style={tableCellStyle}>
                    <div style={skuStyle}>{row.sku}</div>
                    <div style={mutedSmallStyle}>{row.style_code || "—"}</div>
                  </td>
                  <td style={tableCellStyle}>{row.product_title}</td>
                  <td style={tableCellStyle}>{row.size || "—"}</td>
                  <td style={tableCellStyle}>{row.color || "—"}</td>
                  <td style={tableCellStyle}>{row.hsn || "—"}</td>
                  <td style={tableCellStyle}>{row.on_hand}</td>
                  <td style={tableCellStyle}>
                    <input
                      type="number"
                      min={0}
                      value={draft?.min_qty ?? 0}
                      onChange={(event) =>
                        updateRow(row, {
                          min_qty: Math.max(0, Number(event.target.value || 0)),
                        })
                      }
                      style={compactInputStyle}
                    />
                  </td>
                  <td style={tableCellStyle}>
                    <input
                      type="number"
                      min={0}
                      value={draft?.target_qty ?? ""}
                      onChange={(event) =>
                        updateRow(row, {
                          target_qty: event.target.value === "" ? null : Math.max(0, Number(event.target.value || 0)),
                        })
                      }
                      style={compactInputStyle}
                    />
                  </td>
                  <td style={tableCellStyle}>{row.suggested_qty}</td>
                  <td style={tableCellStyle}>
                    <select
                      value={draft?.preferred_vendor_id ?? ""}
                      onChange={(event) =>
                        updateRow(row, {
                          preferred_vendor_id: event.target.value || null,
                        })
                      }
                      style={compactSelectStyle}
                    >
                      <option value="">No preference</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.legal_name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
            {suggestionRows.length === 0 ? (
              <tr>
                <td style={tableCellStyle} colSpan={11}>
                  No reorder suggestions found for this warehouse.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div style={paginationRowStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset === 0}
          >
            Previous
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={!hasNextPage}
          >
            Next
          </button>
        </div>
      </div>

      {modalOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={modalHeaderStyle}>
              <h2 style={modalTitleStyle}>Create Purchase Order Draft</h2>
              <p style={modalSubtitleStyle}>Choose the vendor and optional reference details.</p>
            </div>
            <div style={modalBodyStyle}>
              <label style={modalLabelStyle}>
                Vendor
                <select
                  value={modalVendorId}
                  onChange={(event) => setModalVendorId(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={modalLabelStyle}>
                Reference
                <input
                  value={modalReference}
                  onChange={(event) => setModalReference(event.target.value)}
                  placeholder="Optional reference"
                  style={inputStyle}
                />
              </label>
              <label style={modalLabelStyle}>
                Notes
                <textarea
                  value={modalNotes}
                  onChange={(event) => setModalNotes(event.target.value)}
                  placeholder="Optional notes for the PO"
                  style={textareaStyle}
                  rows={3}
                />
              </label>
            </div>
            <div style={modalFooterStyle}>
              <button type="button" style={secondaryButtonStyle} onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={primaryButtonStyle} onClick={handleCreatePo}>
                Create Draft
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ErpShell>
  );
}

const filterRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
};

const toggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#111827",
  fontSize: 14,
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const errorStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  fontSize: 14,
};

const noticeStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#dcfce7",
  color: "#166534",
  fontSize: 14,
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 14,
};

const mutedSmallStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 12,
  marginTop: 4,
};

const skuStyle: CSSProperties = {
  fontWeight: 600,
};

const compactInputStyle: CSSProperties = {
  ...inputStyle,
  padding: "6px 8px",
  width: 90,
};

const compactSelectStyle: CSSProperties = {
  ...inputStyle,
  padding: "6px 8px",
  minWidth: 160,
};

const paginationRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 50,
};

const modalStyle: CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  width: "100%",
  maxWidth: 520,
  boxShadow: "0 20px 40px rgba(15, 23, 42, 0.2)",
  display: "flex",
  flexDirection: "column",
};

const modalHeaderStyle: CSSProperties = {
  padding: "20px 24px 0",
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 20,
  color: "#111827",
};

const modalSubtitleStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "#6b7280",
  fontSize: 14,
};

const modalBodyStyle: CSSProperties = {
  padding: "16px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const modalLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 14,
  color: "#111827",
};

const modalFooterStyle: CSSProperties = {
  padding: "0 24px 20px",
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
};
