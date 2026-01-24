import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import InventoryHealthTable, {
  type InventoryHealthDisplayRow,
} from "../../../../components/inventory/InventoryHealthTable";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { useInventoryLowStock, useInventoryNegativeStock } from "../../../../lib/erp/inventoryHealth";
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

export default function InventoryHealthPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [variantMap, setVariantMap] = useState<Record<string, VariantInfo>>({});
  const [warehouseMap, setWarehouseMap] = useState<Record<string, WarehouseInfo>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);

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

  const {
    data: negativeRows,
    loading: negativeLoading,
    error: negativeError,
  } = useInventoryNegativeStock({
    companyId: ctx?.companyId ?? null,
    limit: PAGE_SIZE,
    offset: 0,
  });

  const { data: lowRows, loading: lowLoading, error: lowError } = useInventoryLowStock({
    companyId: ctx?.companyId ?? null,
    limit: PAGE_SIZE,
    offset: 0,
  });

  useEffect(() => {
    if (!ctx?.companyId) return;
    let active = true;

    const variantIds = Array.from(
      new Set([...negativeRows, ...lowRows].map((row) => row.variant_id).filter(Boolean))
    );
    const warehouseIds = Array.from(
      new Set([...negativeRows, ...lowRows].map((row) => row.warehouse_id).filter(Boolean))
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
  }, [ctx?.companyId, negativeRows, lowRows]);

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

  const displayError = error || negativeError || lowError;

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
          <h2 style={sectionTitleStyle}>Negative stock</h2>
          <p style={sectionSubtitleStyle}>Available inventory below zero from ledger-driven availability.</p>
          {negativeLoading ? <div style={mutedStyle}>Loading negative stock…</div> : null}
          <InventoryHealthTable
            rows={negativeDisplayRows}
            emptyMessage="No negative stock detected for the current company."
          />
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>Low stock</h2>
          <p style={sectionSubtitleStyle}>
            Availability that is at or below the minimum stock level threshold.
          </p>
          {lowLoading ? <div style={mutedStyle}>Loading low stock…</div> : null}
          <InventoryHealthTable
            rows={lowDisplayRows}
            showMinLevel
            emptyMessage="No low stock alerts for the current company."
          />
        </section>
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
