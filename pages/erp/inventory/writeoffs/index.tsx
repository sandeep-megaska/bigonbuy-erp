import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type WarehouseOption = {
  id: string;
  name: string;
};

type WriteoffRow = {
  id: string;
  writeoff_date: string;
  reason: string | null;
  ref: string | null;
  warehouse_id: string;
  status: string;
};

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

export default function InventoryWriteoffsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [writeoffs, setWriteoffs] = useState<WriteoffRow[]>([]);

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

      await loadWriteoffs(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadWriteoffs(companyId: string, isActive = true) {
    setError(null);
    const [writeoffRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_inventory_writeoffs")
        .select("id, writeoff_date, reason, ref, warehouse_id, status")
        .eq("company_id", companyId)
        .order("writeoff_date", { ascending: false }),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (writeoffRes.error || warehouseRes.error) {
      if (isActive) {
        setError(writeoffRes.error?.message || warehouseRes.error?.message || "Failed to load write-offs.");
      }
      return;
    }

    if (isActive) {
      setWriteoffs((writeoffRes.data || []) as WriteoffRow[]);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
    }
  }

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading write-offs…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Damage / Write-offs</p>
            <h1 style={h1Style}>Damage / Write-offs</h1>
            <p style={subtitleStyle}>Reduce stock for damaged or unresellable inventory.</p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Link
              href="/erp/inventory/writeoffs/new"
              style={{
                ...primaryButtonStyle,
                opacity: canWrite ? 1 : 0.5,
                pointerEvents: canWrite ? "auto" : "none",
              }}
            >
              New Write-off
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Reason</th>
                <th style={tableHeaderCellStyle}>Reference</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {writeoffs.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No write-offs yet.
                  </td>
                </tr>
              ) : (
                writeoffs.map((writeoff) => (
                  <tr key={writeoff.id}>
                    <td style={tableCellStyle}>{writeoff.writeoff_date}</td>
                    <td style={tableCellStyle}>{writeoff.reason || "Write-off"}</td>
                    <td style={tableCellStyle}>{writeoff.ref || "—"}</td>
                    <td style={tableCellStyle}>{warehouseMap.get(writeoff.warehouse_id) || "—"}</td>
                    <td style={tableCellStyle}>{writeoff.status}</td>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/inventory/writeoffs/${writeoff.id}`} style={primaryButtonStyle}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

const errorStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  fontSize: 14,
};
