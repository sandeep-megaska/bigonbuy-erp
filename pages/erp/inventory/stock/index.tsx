import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
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
} from "../../../../components/erp/uiStyles";
import StockOnHandTable from "../../../../components/inventory/StockOnHandTable";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { useDebouncedValue, useStockOnHandList } from "../../../../lib/erp/inventoryStock";
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

const PAGE_SIZE = 50;

export default function InventoryStockPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseFilter, setWarehouseFilter] = useState<string>("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const debouncedQuery = useDebouncedValue(searchQuery, 300);

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
      const { data, error: loadError } = await supabase
        .from("erp_warehouses")
        .select("id, name, code")
        .eq("company_id", ctx.companyId)
        .order("name", { ascending: true });

      if (!active) return;

      if (loadError) {
        setError(loadError.message);
        return;
      }

      setWarehouses((data || []) as WarehouseOption[]);
    })().catch((loadError: Error) => {
      if (active) setError(loadError.message || "Failed to load warehouses.");
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  useEffect(() => {
    setOffset(0);
  }, [warehouseFilter, inStockOnly, debouncedQuery]);

  const { data: rows, loading: stockLoading, error: stockError } = useStockOnHandList({
    companyId: ctx?.companyId ?? null,
    warehouseId: warehouseFilter || null,
    query: debouncedQuery,
    inStockOnly,
    limit: PAGE_SIZE,
    offset,
  });

  const showWarehouseColumn = warehouseFilter === "";

  const hasNextPage = rows.length === PAGE_SIZE;

  const headerSubtitle = useMemo(() => {
    if (showWarehouseColumn) return "Current inventory balances by SKU and warehouse.";
    const selected = warehouses.find((warehouse) => warehouse.id === warehouseFilter);
    return selected
      ? `Current inventory balances for ${selected.name}.`
      : "Current inventory balances by SKU and warehouse.";
  }, [showWarehouseColumn, warehouses, warehouseFilter]);

  function handleMovements(row: { warehouse_id: string; variant_id: string }) {
    router.push(`/erp/inventory/stock/${row.warehouse_id}/${row.variant_id}`);
  }

  const displayError = error || stockError;

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading stock on hand…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Stock On Hand</p>
            <h1 style={h1Style}>Stock On Hand</h1>
            <p style={subtitleStyle}>{headerSubtitle}</p>
          </div>
        </header>

        {displayError ? <div style={errorStyle}>{displayError}</div> : null}

        <section style={cardStyle}>
          <div style={filterRowStyle}>
            <select
              value={warehouseFilter}
              onChange={(event) => setWarehouseFilter(event.target.value)}
              style={inputStyle}
            >
              <option value="">All warehouses</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            <label style={toggleStyle}>
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(event) => setInStockOnly(event.target.checked)}
              />
              In stock only
            </label>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search SKU / style / title"
              style={inputStyle}
            />
          </div>
        </section>

        {stockLoading ? <div style={mutedStyle}>Loading stock on hand…</div> : null}

        <StockOnHandTable rows={rows} showWarehouse={showWarehouseColumn} onMovements={handleMovements} />

        <div style={paginationRowStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset === 0}
          >
            Previous
          </button>
          <span style={mutedStyle}>Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={!hasNextPage}
          >
            Next
          </button>
        </div>
      </div>
    </ErpShell>
  );
}

const filterRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
};

const toggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#111827",
  fontSize: 14,
};

const errorStyle: CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 12,
};

const paginationRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  justifyContent: "flex-end",
};
