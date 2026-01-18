import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import InventoryCsvImport from "../../../components/inventory/InventoryCsvImport";
import type { ImportMode } from "../../../components/inventory/csvSchemas";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../lib/erpContext";

const modeButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "#cbd5f5",
};

const activeModeButtonStyle: CSSProperties = {
  ...modeButtonStyle,
  backgroundColor: "#1f2937",
  color: "#fff",
  borderColor: "#1f2937",
};

export default function InventoryImportPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ImportMode>("adjustment");

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

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading inventory import…</div>
      </ErpShell>
    );
  }

  if (error) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>{error}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · CSV Import</p>
            <h1 style={h1Style}>Stock Import</h1>
            <p style={subtitleStyle}>
              Upload adjustment or stocktake CSVs to update inventory across warehouses.
            </p>
          </div>
        </header>

        <section style={cardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Select import mode</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={mode === "adjustment" ? activeModeButtonStyle : modeButtonStyle}
              onClick={() => setMode("adjustment")}
            >
              Adjustment import
            </button>
            <button
              type="button"
              style={mode === "stocktake" ? activeModeButtonStyle : modeButtonStyle}
              onClick={() => setMode("stocktake")}
            >
              Stocktake import
            </button>
          </div>
        </section>

        {ctx?.companyId ? (
          <InventoryCsvImport mode={mode} companyId={ctx.companyId} canWrite={canWrite} />
        ) : null}
      </div>
    </ErpShell>
  );
}
