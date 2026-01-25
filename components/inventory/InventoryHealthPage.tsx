import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../erp/uiStyles";
import InventoryHealthTable, { type InventoryHealthDisplayRow } from "./InventoryHealthTable";
import { getCompanyContext, requireAuthRedirectHome } from "../../lib/erpContext";
import type { InventoryHealthParams } from "../../lib/erp/inventoryHealth";
import { supabase } from "../../lib/supabaseClient";

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
  hsn?: string | null;
};

type WarehouseInfo = {
  warehouse_name: string | null;
  warehouse_code: string | null;
};

type WarehouseOption = {
  id: string;
  name: string | null;
  code: string | null;
};

type MinLevelRecord = {
  variant_id: string;
  warehouse_id: string | null;
  min_level: number;
};

type RawInventoryRow = {
  warehouse_id: string;
  variant_id: string;
  internal_sku?: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  min_level?: number | null;
  shortage?: number | null;
};

type InventoryHealthHook = (params: InventoryHealthParams) => {
  data: RawInventoryRow[];
  loading: boolean;
  error: string | null;
};

const PAGE_SIZE = 100;

const modeCopy = {
  available: {
    title: "Available stock",
    subtitle: "On hand, reserved, and available inventory by warehouse.",
  },
  negative: {
    title: "Negative stock",
    subtitle: "Availability below zero from ledger-driven availability.",
  },
  low: {
    title: "Low stock",
    subtitle: "Availability at or below minimum stock level thresholds.",
  },
};

export default function InventoryHealthPage({
  mode,
  useInventoryHook,
  showProblematicToggle = false,
  showShortage = false,
}: {
  mode: "available" | "negative" | "low";
  useInventoryHook: InventoryHealthHook;
  showProblematicToggle?: boolean;
  showShortage?: boolean;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [variantMap, setVariantMap] = useState<Record<string, VariantInfo>>({});
  const [warehouseMap, setWarehouseMap] = useState<Record<string, WarehouseInfo>>({});
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"sku" | "qty">(mode === "available" ? "sku" : "qty");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(mode === "available" ? "asc" : "asc");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [onlyProblematic, setOnlyProblematic] = useState(false);
  const [minLevelMap, setMinLevelMap] = useState<Record<string, number>>({});
  const [minLevelLoading, setMinLevelLoading] = useState(false);
  const [minLevelError, setMinLevelError] = useState<string | null>(null);

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

  const { data: rawRows, loading: dataLoading, error: dataError } = useInventoryHook({
    companyId: ctx?.companyId ?? null,
    warehouseId: warehouseFilter || null,
    query: searchQuery,
    limit: PAGE_SIZE,
    offset,
    sortBy,
    sortDirection,
    reloadKey,
  });

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    const variantIds = Array.from(new Set(rawRows.map((row) => row.variant_id).filter(Boolean)));
    const warehouseIds = Array.from(new Set(rawRows.map((row) => row.warehouse_id).filter(Boolean)));

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
  }, [ctx?.companyId, rawRows]);

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    const variantIds = Array.from(new Set(rawRows.map((row) => row.variant_id).filter(Boolean)));
    const warehouseIds = Array.from(new Set(rawRows.map((row) => row.warehouse_id).filter(Boolean)));

    if (variantIds.length === 0) {
      setMinLevelMap({});
      return;
    }

    (async () => {
      setMinLevelLoading(true);
      setMinLevelError(null);

      let query = supabase
        .from("erp_inventory_min_levels")
        .select("variant_id, warehouse_id, min_level")
        .eq("company_id", ctx.companyId)
        .eq("is_void", false)
        .in("variant_id", variantIds);

      if (warehouseIds.length > 0) {
        query = query.or(`warehouse_id.is.null,warehouse_id.in.(${warehouseIds.join(",")})`);
      } else {
        query = query.is("warehouse_id", null);
      }

      const { data, error: minLevelFetchError } = await query;

      if (!active) return;

      if (minLevelFetchError) {
        setMinLevelError(minLevelFetchError.message || "Failed to load minimum levels.");
        setMinLevelMap({});
      } else {
        const nextMap: Record<string, number> = {};
        (data as MinLevelRecord[] | null)?.forEach((row) => {
          nextMap[getMinLevelKey(row.variant_id, row.warehouse_id)] = Number(row.min_level ?? 0);
        });
        setMinLevelMap(nextMap);
      }

      setMinLevelLoading(false);
    })().catch((loadError: Error) => {
      if (active) {
        setMinLevelError(loadError.message || "Failed to load minimum levels.");
        setMinLevelMap({});
        setMinLevelLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, rawRows]);

  const displayRows = useMemo(() => {
    return rawRows.map((row) => {
      const minLevel =
        row.min_level ??
        minLevelMap[getMinLevelKey(row.variant_id, row.warehouse_id)] ??
        minLevelMap[getMinLevelKey(row.variant_id, null)] ??
        null;
      const status = getRowStatus(mode, row, minLevel);
      return {
        ...row,
        ...variantMap[row.variant_id],
        ...warehouseMap[row.warehouse_id],
        min_level: minLevel ?? null,
        status,
      } satisfies InventoryHealthDisplayRow;
    });
  }, [rawRows, variantMap, warehouseMap, minLevelMap, mode]);

  const filteredRows = useMemo(() => {
    if (!showProblematicToggle || !onlyProblematic) return displayRows;
    return displayRows.filter((row) => row.status !== "ok");
  }, [displayRows, onlyProblematic, showProblematicToggle]);

  const displayError = error || dataError || minLevelError;

  async function handleMinLevelCommit(row: InventoryHealthDisplayRow, nextValue: number) {
    const sku = row.sku || row.internal_sku;
    if (!sku) {
      setError("Cannot update minimum level without a SKU.");
      return;
    }

    setError(null);

    const { data, error: saveError } = await supabase.rpc("erp_inventory_min_level_upsert", {
      p_sku: sku,
      p_warehouse_id: row.warehouse_id || null,
      p_min_qty: Number(nextValue || 0),
    });

    if (saveError) {
      setError(saveError.message || "Failed to update minimum level.");
      return;
    }

    const updatedRow = Array.isArray(data) ? data[0] : null;
    if (updatedRow?.variant_id) {
      setMinLevelMap((prev) => ({
        ...prev,
        [getMinLevelKey(updatedRow.variant_id, updatedRow.warehouse_id ?? null)]: Number(updatedRow.min_level ?? 0),
      }));
    } else {
      setMinLevelMap((prev) => ({
        ...prev,
        [getMinLevelKey(row.variant_id, row.warehouse_id ?? null)]: Number(nextValue || 0),
      }));
    }

    setReloadKey((prev) => prev + 1);
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
            <h1 style={h1Style}>{modeCopy[mode].title}</h1>
            <p style={subtitleStyle}>{modeCopy[mode].subtitle}</p>
          </div>
        </header>

        {displayError ? <div style={errorStyle}>{displayError}</div> : null}
        {detailsLoading ? <div style={mutedStyle}>Loading inventory details…</div> : null}
        {minLevelLoading ? <div style={mutedStyle}>Loading minimum levels…</div> : null}

        <section style={cardStyle}>
          <div style={filtersRowStyle}>
            <label style={filterFieldStyle}>
              <span style={filterLabelStyle}>Warehouse</span>
              <select
                value={warehouseFilter}
                onChange={(event) => {
                  setWarehouseFilter(event.target.value);
                  setOffset(0);
                }}
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
                  setOffset(0);
                }}
                placeholder="Filter by SKU"
                style={inputStyle}
              />
            </label>
            <label style={filterFieldStyle}>
              <span style={filterLabelStyle}>Sort</span>
              <select
                value={`${sortBy}-${sortDirection}`}
                onChange={(event) => {
                  const [nextSortBy, nextSortDirection] = event.target.value.split("-");
                  setSortBy(nextSortBy as "sku" | "qty");
                  setSortDirection(nextSortDirection as "asc" | "desc");
                  setOffset(0);
                }}
                style={inputStyle}
              >
                <option value="sku-asc">SKU (A → Z)</option>
                <option value="sku-desc">SKU (Z → A)</option>
                <option value="qty-asc">Qty (Low → High)</option>
                <option value="qty-desc">Qty (High → Low)</option>
              </select>
            </label>
            {showProblematicToggle ? (
              <label style={checkboxFieldStyle}>
                <input
                  type="checkbox"
                  checked={onlyProblematic}
                  onChange={(event) => {
                    setOnlyProblematic(event.target.checked);
                    setOffset(0);
                  }}
                />
                Only problematic
              </label>
            ) : null}
          </div>

          {dataLoading ? <div style={mutedStyle}>Loading inventory health…</div> : null}

          <InventoryHealthTable
            rows={filteredRows}
            showMinLevel
            showShortage={showShortage}
            showStatus
            minLevelEditable
            onMinLevelCommit={handleMinLevelCommit}
            emptyMessage="No inventory health rows for the current filters."
          />

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
              disabled={rawRows.length < PAGE_SIZE}
            >
              Next
            </button>
          </div>
        </section>
      </div>
    </ErpShell>
  );
}

function getRowStatus(mode: "available" | "negative" | "low", row: RawInventoryRow, minLevel: number | null) {
  if (mode === "negative") return "negative";
  if (mode === "low") return "low";
  const qty = Number.isFinite(row.available) ? row.available : row.on_hand;
  if (qty < 0) return "negative";
  if (minLevel !== null && qty < minLevel) return "low";
  return "ok";
}

function getMinLevelKey(variantId: string, warehouseId: string | null) {
  return `${variantId}-${warehouseId || "all"}`;
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

const checkboxFieldStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 22,
  fontSize: 14,
  color: "#111827",
};

const paginationRowStyle = {
  display: "flex",
  gap: 8,
  marginTop: 16,
};
