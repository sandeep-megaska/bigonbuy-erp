import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import TabbedCsvImport from "../../../components/inventory/import/TabbedCsvImport";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function InventoryImportPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      <>
        <div style={pageContainerStyle}>Loading inventory import…</div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div style={pageContainerStyle}>{error}</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · CSV Import</p>
            <h1 style={h1Style}>Inventory Import</h1>
            <p style={subtitleStyle}>
              Upload sales consumption or stocktake CSVs to validate and post inventory updates.
            </p>
          </div>
        </header>

        <section style={cardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Choose an import tab</h2>
          <p style={{ color: "#475569", margin: 0 }}>
            Validate-only mode lets you preview document counts and row-level issues without posting ledger entries.
          </p>
        </section>

        {ctx?.companyId ? <TabbedCsvImport companyId={ctx.companyId} canWrite={canWrite} /> : null}
      </div>
    </>
  );
}
