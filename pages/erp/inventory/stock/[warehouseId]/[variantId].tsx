import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../../components/erp/uiStyles";
import StockMovementsTable from "../../../../../components/inventory/StockMovementsTable";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { useStockMovements } from "../../../../../lib/erp/inventoryStock";
import { supabase } from "../../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type VariantInfo = {
  sku: string;
  productTitle: string | null;
};

type WarehouseInfo = {
  name: string;
  code: string | null;
};

const PAGE_SIZE = 100;

export default function StockMovementsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [variantInfo, setVariantInfo] = useState<VariantInfo | null>(null);
  const [warehouseInfo, setWarehouseInfo] = useState<WarehouseInfo | null>(null);
  const [offset, setOffset] = useState(0);

  const warehouseId = typeof router.query.warehouseId === "string" ? router.query.warehouseId : null;
  const variantId = typeof router.query.variantId === "string" ? router.query.variantId : null;

  useEffect(() => {
    setOffset(0);
  }, [warehouseId, variantId]);

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
    if (!ctx?.companyId || !warehouseId || !variantId) return;
    let active = true;

    (async () => {
      const [warehouseRes, variantRes] = await Promise.all([
        supabase
          .from("erp_warehouses")
          .select("id, name, code")
          .eq("company_id", ctx.companyId)
          .eq("id", warehouseId)
          .maybeSingle(),
        supabase
          .from("erp_variants")
          .select("id, sku, erp_products(title)")
          .eq("company_id", ctx.companyId)
          .eq("id", variantId)
          .maybeSingle(),
      ]);

      if (!active) return;

      if (warehouseRes.error || variantRes.error) {
        setError(warehouseRes.error?.message || variantRes.error?.message || "Failed to load stock details.");
        return;
      }

      if (warehouseRes.data) {
        setWarehouseInfo({
          name: warehouseRes.data.name,
          code: warehouseRes.data.code,
        });
      }

      if (variantRes.data) {
        const productTitle = variantRes.data.erp_products?.[0]?.title ?? null;
        setVariantInfo({
          sku: variantRes.data.sku,
          productTitle,
        });
      }
    })().catch((loadError: Error) => {
      if (active) setError(loadError.message || "Failed to load stock details.");
    });

    return () => {
      active = false;
    };
  }, [ctx?.companyId, warehouseId, variantId]);

  const { data: movements, loading: movementsLoading, error: movementsError } = useStockMovements({
    companyId: ctx?.companyId ?? null,
    warehouseId,
    variantId,
    limit: PAGE_SIZE,
    offset,
  });

  const hasNextPage = movements.length === PAGE_SIZE;

  const headerTitle = useMemo(() => {
    if (!variantInfo) return "Stock Movements";
    return variantInfo.productTitle
      ? `${variantInfo.sku} · ${variantInfo.productTitle}`
      : variantInfo.sku;
  }, [variantInfo]);

  const headerSubtitle = useMemo(() => {
    if (!warehouseInfo) return "Warehouse stock movements.";
    return warehouseInfo.code ? `${warehouseInfo.name} (${warehouseInfo.code})` : warehouseInfo.name;
  }, [warehouseInfo]);

  const displayError = error || movementsError;

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading stock movements…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Stock Movements</p>
            <h1 style={h1Style}>{headerTitle}</h1>
            <p style={subtitleStyle}>{headerSubtitle}</p>
          </div>
          <Link href="/erp/inventory/stock" style={linkStyle}>
            ← Back to Stock on Hand
          </Link>
        </header>

        {displayError ? <div style={errorStyle}>{displayError}</div> : null}

        <section style={cardStyle}>
          <p style={mutedStyle}>Latest inventory ledger movements for this SKU and warehouse.</p>
        </section>

        {movementsLoading ? <div style={mutedStyle}>Loading movements…</div> : null}

        <StockMovementsTable rows={movements} />

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
    </>
  );
}

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

const linkStyle: CSSProperties = {
  color: "#2563eb",
  fontWeight: 600,
  textDecoration: "none",
};
