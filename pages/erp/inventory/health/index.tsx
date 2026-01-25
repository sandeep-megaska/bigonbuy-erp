import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
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
import InventoryHealthTable, {
  type InventoryHealthDisplayRow,
} from "../../../../components/inventory/InventoryHealthTable";
import VariantTypeahead, { type VariantSearchResult } from "../../../../components/inventory/VariantTypeahead";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import {
  useInventoryAvailable,
  useInventoryLowStock,
  useInventoryNegativeStock,
} from "../../../../lib/erp/inventoryHealth";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type VariantInfo = {
  sku: string | null;
  style_code: string | null;
  product_title: string | null;
  color: string | null;
  size: string | null;
  hsn: string | null;
};

type WarehouseInfo = {
  warehouse_name: string | null;
  warehouse_code: string | null;
};

const PAGE_SIZE = 100;

type WarehouseOption = {
  id: string;
  name: string | null;
  code: string | null;
};

type MinLevelRow = {
  id: string;
  company_id: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_code: string | null;
  variant_id: string;
  internal_sku: string | null;
  min_level: number;
  note: string | null;
  is_active: boolean;
  updated_at: string | null;
};

export default function InventoryHealthPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [variantMap, setVariantMap] = useState<Record<string, VariantInfo>>({});
  const [warehouseMap, setWarehouseMap] = useState<Record<string, WarehouseInfo>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [activeTab, setActiveTab] = useState<"available" | "negative" | "low" | "min-levels">("available");
  const [searchQuery, setSearchQuery] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("");
  const [minLevels, setMinLevels] = useState<MinLevelRow[]>([]);
  const [minLevelsLoading, setMinLevelsLoading] = useState(false);
  const [minLevelsError, setMinLevelsError] = useState<string | null>(null);
  const [minLevelsOffset, setMinLevelsOffset] = useState(0);
  const [minLevelsReloadKey, setMinLevelsReloadKey] = useState(0);
  const [minLevelModalOpen, setMinLevelModalOpen] = useState(false);
  const [editingMinLevel, setEditingMinLevel] = useState<MinLevelRow | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<VariantSearchResult | null>(null);
  const [minLevelValue, setMinLevelValue] = useState(0);
  const [minLevelNote, setMinLevelNote] = useState("");
  const [minLevelWarehouseId, setMinLevelWarehouseId] = useState<string>("");
  const [minLevelIsActive, setMinLevelIsActive] = useState(true);
  const [savingMinLevel, setSavingMinLevel] = useState(false);

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
      const { data, error: warehouseError } = await supabase
        .from("erp_warehouses")
        .select("id, name, code")
        .eq("company_id", ctx.companyId)
        .order("name", { ascending: true });

      if (!active) return;

      if (warehouseError) {
        setError(warehouseError.message);
        return;
      }

      setWarehouses((data || []) as WarehouseOption[]);
    })().catch((loadError: Error) => {
      if (active) {
        setError(loadError.message || "Failed to load warehouses.");
      }
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const {
    data: availableRows,
    loading: availableLoading,
    error: availableError,
  } = useInventoryAvailable({
    companyId: ctx?.companyId ?? null,
    warehouseId: warehouseFilter || null,
    query: searchQuery,
    limit: PAGE_SIZE,
    offset: 0,
  });

  const {
    data: negativeRows,
    loading: negativeLoading,
    error: negativeError,
  } = useInventoryNegativeStock({
    companyId: ctx?.companyId ?? null,
    warehouseId: warehouseFilter || null,
    query: searchQuery,
    limit: PAGE_SIZE,
    offset: 0,
  });

  const { data: lowRows, loading: lowLoading, error: lowError } = useInventoryLowStock({
    companyId: ctx?.companyId ?? null,
    warehouseId: warehouseFilter || null,
    query: searchQuery,
    limit: PAGE_SIZE,
    offset: 0,
  });

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    const variantIds = Array.from(
      new Set([...availableRows, ...negativeRows, ...lowRows].map((row) => row.variant_id).filter(Boolean))
    );
    const warehouseIds = Array.from(
      new Set([...availableRows, ...negativeRows, ...lowRows].map((row) => row.warehouse_id).filter(Boolean))
    );

    if (variantIds.length === 0 && warehouseIds.length === 0) {
      setVariantMap({});
      setWarehouseMap({});
      return;
    }

    (async () => {
      setDetailsLoading(true);

      const [variantRes, warehouseRes] = await Promise.all([
        variantIds.length
          ? supabase
              .from("erp_variants")
              .select("id, sku, color, size, erp_products(title, style_code, hsn_code)")
              .eq("company_id", ctx.companyId)
              .in("id", variantIds)
          : Promise.resolve({ data: [], error: null }),
        warehouseIds.length
          ? supabase
              .from("erp_warehouses")
              .select("id, name, code")
              .eq("company_id", ctx.companyId)
              .in("id", warehouseIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!active) return;

      if (variantRes.error || warehouseRes.error) {
        setError(variantRes.error?.message || warehouseRes.error?.message || "Failed to load inventory details.");
        setDetailsLoading(false);
        return;
      }

      const nextVariantMap: Record<string, VariantInfo> = {};
      (variantRes.data || []).forEach((row) => {
        const product = row.erp_products?.[0];
        nextVariantMap[row.id] = {
          sku: row.sku ?? null,
          style_code: product?.style_code ?? null,
          product_title: product?.title ?? null,
          color: row.color ?? null,
          size: row.size ?? null,
          hsn: product?.hsn_code ?? null,
        };
      });

      const nextWarehouseMap: Record<string, WarehouseInfo> = {};
      (warehouseRes.data || []).forEach((row) => {
        nextWarehouseMap[row.id] = {
          warehouse_name: row.name ?? null,
          warehouse_code: row.code ?? null,
        };
      });

      setVariantMap(nextVariantMap);
      setWarehouseMap(nextWarehouseMap);
      setDetailsLoading(false);
    })().catch((loadError: Error) => {
      if (active) {
        setError(loadError.message || "Failed to load inventory details.");
        setDetailsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, availableRows, negativeRows, lowRows]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    (async () => {
      setMinLevelsLoading(true);
      setMinLevelsError(null);

      const { data, error: listError } = await supabase.rpc("erp_inventory_min_levels_list", {
        p_q: searchQuery.trim() || null,
        p_limit: PAGE_SIZE,
        p_offset: minLevelsOffset,
      });

      if (!active) return;

      if (listError) {
        setMinLevelsError(listError.message || "Failed to load minimum levels.");
        setMinLevels([]);
      } else {
        setMinLevels((data || []) as MinLevelRow[]);
      }

      setMinLevelsLoading(false);
    })().catch((loadError: Error) => {
      if (active) {
        setMinLevelsError(loadError.message || "Failed to load minimum levels.");
        setMinLevels([]);
        setMinLevelsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, searchQuery, minLevelsOffset, minLevelsReloadKey]);

  const negativeDisplayRows = useMemo(
    () =>
      negativeRows.map((row) => ({
        ...row,
        ...variantMap[row.variant_id],
        ...warehouseMap[row.warehouse_id],
      })) as InventoryHealthDisplayRow[],
    [negativeRows, variantMap, warehouseMap]
  );

  const lowDisplayRows = useMemo(
    () =>
      lowRows.map((row) => ({
        ...row,
        ...variantMap[row.variant_id],
        ...warehouseMap[row.warehouse_id],
      })) as InventoryHealthDisplayRow[],
    [lowRows, variantMap, warehouseMap]
  );

  const availableDisplayRows = useMemo(
    () =>
      availableRows.map((row) => ({
        ...row,
        ...variantMap[row.variant_id],
        ...warehouseMap[row.warehouse_id],
      })) as InventoryHealthDisplayRow[],
    [availableRows, variantMap, warehouseMap]
  );

  const filteredMinLevels = useMemo(() => {
    if (!warehouseFilter) return minLevels;
    return minLevels.filter((row) => row.warehouse_id === warehouseFilter);
  }, [minLevels, warehouseFilter]);

  const displayError = error || availableError || negativeError || lowError || minLevelsError;

  function openNewMinLevelModal() {
    setEditingMinLevel(null);
    setSelectedVariant(null);
    setMinLevelValue(0);
    setMinLevelNote("");
    setMinLevelWarehouseId("");
    setMinLevelIsActive(true);
    setMinLevelModalOpen(true);
  }

  function openEditMinLevelModal(row: MinLevelRow) {
    setEditingMinLevel(row);
    setSelectedVariant({
      variant_id: row.variant_id,
      sku: row.internal_sku || row.variant_id,
      size: null,
      color: null,
      product_id: "",
      style_code: null,
      title: null,
      hsn_code: null,
    });
    setMinLevelValue(row.min_level);
    setMinLevelNote(row.note || "");
    setMinLevelWarehouseId(row.warehouse_id || "");
    setMinLevelIsActive(row.is_active);
    setMinLevelModalOpen(true);
  }

  async function handleSaveMinLevel() {
    if (!selectedVariant?.variant_id) {
      setError("Please select a variant.");
      return;
    }

    setSavingMinLevel(true);
    setError(null);

    const { error: saveError } = await supabase.rpc("erp_inventory_min_level_upsert", {
      p_id: editingMinLevel?.id ?? null,
      p_variant_id: selectedVariant.variant_id,
      p_warehouse_id: minLevelWarehouseId || null,
      p_min_level: Number(minLevelValue || 0),
      p_note: minLevelNote.trim() || null,
      p_is_active: minLevelIsActive,
    });

    if (saveError) {
      setError(saveError.message || "Failed to save minimum level.");
      setSavingMinLevel(false);
      return;
    }

    setSavingMinLevel(false);
    setMinLevelModalOpen(false);
    setMinLevelsOffset(0);
    setMinLevelsReloadKey((prev) => prev + 1);
  }

  async function handleToggleMinLevel(row: MinLevelRow) {
    const { error: toggleError } = await supabase.rpc("erp_inventory_min_level_upsert", {
      p_id: row.id,
      p_variant_id: row.variant_id,
      p_warehouse_id: row.warehouse_id,
      p_min_level: row.min_level,
      p_note: row.note,
      p_is_active: !row.is_active,
    });

    if (toggleError) {
      setError(toggleError.message || "Failed to update minimum level.");
      return;
    }

    setMinLevelsOffset(0);
    setMinLevelsReloadKey((prev) => prev + 1);
  }

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading inventory health…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Health</p>
            <h1 style={h1Style}>Inventory Health</h1>
            <p style={subtitleStyle}>Monitor negative stock and low stock risk by warehouse and SKU.</p>
          </div>
        </header>

        {displayError ? <div style={errorStyle}>{displayError}</div> : null}
        {detailsLoading ? <div style={mutedStyle}>Loading inventory details…</div> : null}

        <section style={cardStyle}>
          <div style={filtersRowStyle}>
            <label style={filterFieldStyle}>
              <span style={filterLabelStyle}>Warehouse</span>
              <select
                value={warehouseFilter}
                onChange={(event) => setWarehouseFilter(event.target.value)}
                style={inputStyle}
              >
                <option value="">All warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name || warehouse.code || warehouse.id}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterFieldStyle}>
              <span style={filterLabelStyle}>Search SKU</span>
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setMinLevelsOffset(0);
                }}
                placeholder="Filter by SKU"
                style={inputStyle}
              />
            </label>
          </div>

          <div style={tabsRowStyle}>
            {[
              { key: "available", label: `Available (${availableRows.length})` },
              { key: "negative", label: `Negative Stock (${negativeRows.length})` },
              { key: "low", label: `Low Stock (${lowRows.length})` },
              { key: "min-levels", label: `Min Levels (${filteredMinLevels.length})` },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                style={{
                  ...secondaryButtonStyle,
                  borderColor: activeTab === tab.key ? "#1d4ed8" : "#d1d5db",
                  color: activeTab === tab.key ? "#1d4ed8" : "#374151",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "available" ? (
            <div>
              <h2 style={sectionTitleStyle}>Available stock</h2>
              <p style={sectionSubtitleStyle}>On hand, reserved, and available inventory by warehouse.</p>
              {availableLoading ? <div style={mutedStyle}>Loading available stock…</div> : null}
              <InventoryHealthTable
                rows={availableDisplayRows}
                emptyMessage="No available inventory rows for the current filters."
              />
            </div>
          ) : null}

          {activeTab === "negative" ? (
            <div>
              <h2 style={sectionTitleStyle}>Negative stock</h2>
              <p style={sectionSubtitleStyle}>Available inventory below zero from ledger-driven availability.</p>
              {negativeLoading ? <div style={mutedStyle}>Loading negative stock…</div> : null}
              <InventoryHealthTable
                rows={negativeDisplayRows}
                emptyMessage="No negative stock detected for the current company."
              />
            </div>
          ) : null}

          {activeTab === "low" ? (
            <div>
              <h2 style={sectionTitleStyle}>Low stock</h2>
              <p style={sectionSubtitleStyle}>
                Availability that is at or below the minimum stock level threshold.
              </p>
              {lowLoading ? <div style={mutedStyle}>Loading low stock…</div> : null}
              <InventoryHealthTable
                rows={lowDisplayRows}
                showMinLevel
                showShortage
                emptyMessage="No low stock alerts for the current company."
              />
            </div>
          ) : null}

          {activeTab === "min-levels" ? (
            <div>
              <div style={minLevelsHeaderStyle}>
                <div>
                  <h2 style={sectionTitleStyle}>Min levels</h2>
                  <p style={sectionSubtitleStyle}>Manage low stock thresholds by SKU and warehouse.</p>
                </div>
                <button type="button" style={primaryButtonStyle} onClick={openNewMinLevelModal}>
                  Add min level
                </button>
              </div>

              {minLevelsLoading ? <div style={mutedStyle}>Loading minimum levels…</div> : null}

              <section style={tableStyle}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>SKU</th>
                      <th style={tableHeaderCellStyle}>Warehouse</th>
                      <th style={tableHeaderCellStyle}>Min level</th>
                      <th style={tableHeaderCellStyle}>Active</th>
                      <th style={tableHeaderCellStyle}>Note</th>
                      <th style={tableHeaderCellStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMinLevels.map((row) => (
                      <tr key={row.id}>
                        <td style={tableCellStyle}>{row.internal_sku || "—"}</td>
                        <td style={tableCellStyle}>
                          {row.warehouse_name || row.warehouse_code || "All warehouses"}
                        </td>
                        <td style={tableCellStyle}>{row.min_level}</td>
                        <td style={tableCellStyle}>
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => handleToggleMinLevel(row)}
                          >
                            {row.is_active ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td style={tableCellStyle}>{row.note || "—"}</td>
                        <td style={tableCellStyle}>
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => openEditMinLevelModal(row)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredMinLevels.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={6}>
                          No minimum levels configured for the current filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>

              <div style={paginationRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setMinLevelsOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                  disabled={minLevelsOffset === 0}
                >
                  Previous
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setMinLevelsOffset((prev) => prev + PAGE_SIZE)}
                  disabled={minLevels.length < PAGE_SIZE}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {minLevelModalOpen ? (
          <div style={modalOverlayStyle}>
            <div style={modalStyle}>
              <div style={modalHeaderStyle}>
                <h2 style={modalTitleStyle}>{editingMinLevel ? "Edit min level" : "Add min level"}</h2>
                <p style={modalSubtitleStyle}>Configure low stock thresholds for a SKU.</p>
              </div>
              <div style={modalBodyStyle}>
                <label style={modalLabelStyle}>
                  Variant
                  <VariantTypeahead
                    value={selectedVariant}
                    onSelect={setSelectedVariant}
                    onError={(message) => setError(message)}
                  />
                </label>
                <label style={modalLabelStyle}>
                  Warehouse
                  <select
                    value={minLevelWarehouseId}
                    onChange={(event) => setMinLevelWarehouseId(event.target.value)}
                    style={inputStyle}
                  >
                    <option value="">All warehouses</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name || warehouse.code || warehouse.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={modalLabelStyle}>
                  Min level
                  <input
                    type="number"
                    min={0}
                    value={minLevelValue}
                    onChange={(event) => setMinLevelValue(Math.max(0, Number(event.target.value || 0)))}
                    style={inputStyle}
                  />
                </label>
                <label style={modalLabelStyle}>
                  Note
                  <input
                    value={minLevelNote}
                    onChange={(event) => setMinLevelNote(event.target.value)}
                    placeholder="Optional note"
                    style={inputStyle}
                  />
                </label>
                <label style={modalCheckboxStyle}>
                  <input
                    type="checkbox"
                    checked={minLevelIsActive}
                    onChange={(event) => setMinLevelIsActive(event.target.checked)}
                  />
                  Active
                </label>
              </div>
              <div style={modalFooterStyle}>
                <button type="button" style={secondaryButtonStyle} onClick={() => setMinLevelModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" style={primaryButtonStyle} onClick={handleSaveMinLevel} disabled={savingMinLevel}>
                  {savingMinLevel ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ErpShell>
  );
}

const errorStyle = {
  marginBottom: 16,
  color: "#b91c1c",
  fontWeight: 600,
};

const mutedStyle = {
  marginBottom: 16,
  color: "#6b7280",
};

const sectionTitleStyle = {
  marginBottom: 4,
  fontSize: 18,
  fontWeight: 600,
};

const sectionSubtitleStyle = {
  marginBottom: 16,
  color: "#6b7280",
};

const filtersRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
  marginBottom: 16,
};

const filterFieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
};

const filterLabelStyle = {
  fontSize: 12,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};

const tabsRowStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 8,
  marginBottom: 20,
};

const minLevelsHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 16,
};

const paginationRowStyle = {
  display: "flex",
  gap: 8,
  marginTop: 16,
};

const modalOverlayStyle = {
  position: "fixed" as const,
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 50,
};

const modalStyle = {
  width: "min(560px, 100%)",
  backgroundColor: "#fff",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.3)",
};

const modalHeaderStyle = {
  marginBottom: 16,
};

const modalTitleStyle = {
  margin: 0,
  fontSize: 20,
};

const modalSubtitleStyle = {
  margin: "6px 0 0",
  color: "#6b7280",
};

const modalBodyStyle = {
  display: "grid",
  gap: 12,
};

const modalLabelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#374151",
};

const modalCheckboxStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#374151",
};

const modalFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
  marginTop: 20,
};
