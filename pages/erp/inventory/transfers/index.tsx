import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
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

type TransferRow = {
  id: string;
  transfer_date: string;
  reference: string | null;
  status: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  created_at: string;
};

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

export default function InventoryTransfersPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);

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

      await loadTransfers(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadTransfers(companyId: string, isActive = true) {
    setError(null);
    const [transferRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_stock_transfers")
        .select("id, transfer_date, reference, status, from_warehouse_id, to_warehouse_id, created_at")
        .eq("company_id", companyId)
        .order("transfer_date", { ascending: false }),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (transferRes.error || warehouseRes.error) {
      if (isActive) {
        setError(transferRes.error?.message || warehouseRes.error?.message || "Failed to load transfers.");
      }
      return;
    }

    if (isActive) {
      setTransfers((transferRes.data || []) as TransferRow[]);
      setWarehouses((warehouseRes.data || []) as WarehouseOption[]);
    }
  }

  const warehouseMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading transfers…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Transfers</p>
            <h1 style={h1Style}>Stock Transfers</h1>
            <p style={subtitleStyle}>Move stock between warehouses with draft and posted tracking.</p>
          </div>
          <div>
            <Link
              href="/erp/inventory/transfers/new"
              style={{
                ...primaryButtonStyle,
                opacity: canWrite ? 1 : 0.5,
                pointerEvents: canWrite ? "auto" : "none",
              }}
            >
              New Transfer
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Reference</th>
                <th style={tableHeaderCellStyle}>From</th>
                <th style={tableHeaderCellStyle}>To</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {transfers.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={7}>
                    No transfers yet.
                  </td>
                </tr>
              ) : (
                transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td style={tableCellStyle}>{transfer.transfer_date}</td>
                    <td style={tableCellStyle}>{transfer.reference || "—"}</td>
                    <td style={tableCellStyle}>{warehouseMap.get(transfer.from_warehouse_id) || "—"}</td>
                    <td style={tableCellStyle}>{warehouseMap.get(transfer.to_warehouse_id) || "—"}</td>
                    <td style={tableCellStyle}>{transfer.status}</td>
                    <td style={tableCellStyle}>{new Date(transfer.created_at).toLocaleString()}</td>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/inventory/transfers/${transfer.id}`} style={primaryButtonStyle}>
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
    </ErpShell>
  );
}

const errorStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  fontSize: 14,
};
