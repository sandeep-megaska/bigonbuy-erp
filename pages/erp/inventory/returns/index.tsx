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
  secondaryButtonStyle,
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

type ReturnRow = {
  id: string;
  receipt_date: string;
  receipt_type: string;
  reference: string | null;
  warehouse_id: string;
  status: string;
};

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

export default function InventoryReturnsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [receipts, setReceipts] = useState<ReturnRow[]>([]);

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

      await loadReceipts(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadReceipts(companyId: string, isActive = true) {
    setError(null);
    const [receiptRes, warehouseRes] = await Promise.all([
      supabase
        .from("erp_return_receipts")
        .select("id, receipt_date, receipt_type, reference, warehouse_id, status")
        .eq("company_id", companyId)
        .order("receipt_date", { ascending: false }),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
    ]);

    if (receiptRes.error || warehouseRes.error) {
      if (isActive) {
        setError(receiptRes.error?.message || warehouseRes.error?.message || "Failed to load return receipts.");
      }
      return;
    }

    if (isActive) {
      setReceipts((receiptRes.data || []) as ReturnRow[]);
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
        <div style={pageContainerStyle}>Loading returns…</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Returns/RTO</p>
            <h1 style={h1Style}>Return Receipts</h1>
            <p style={subtitleStyle}>Post customer returns and RTO receipts into Jaipur stock.</p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Link
              href="/erp/inventory/returns/new?type=return"
              style={{
                ...primaryButtonStyle,
                opacity: canWrite ? 1 : 0.5,
                pointerEvents: canWrite ? "auto" : "none",
              }}
            >
              New Return Receipt
            </Link>
            <Link
              href="/erp/inventory/returns/new?type=rto"
              style={{
                ...secondaryButtonStyle,
                opacity: canWrite ? 1 : 0.5,
                pointerEvents: canWrite ? "auto" : "none",
              }}
            >
              New RTO Receipt
            </Link>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Date</th>
                <th style={tableHeaderCellStyle}>Type</th>
                <th style={tableHeaderCellStyle}>Reference</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No returns yet.
                  </td>
                </tr>
              ) : (
                receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td style={tableCellStyle}>{receipt.receipt_date}</td>
                    <td style={tableCellStyle}>{receipt.receipt_type.toUpperCase()}</td>
                    <td style={tableCellStyle}>{receipt.reference || "—"}</td>
                    <td style={tableCellStyle}>{warehouseMap.get(receipt.warehouse_id) || "—"}</td>
                    <td style={tableCellStyle}>{receipt.status}</td>
                    <td style={tableCellStyle}>
                      <Link href={`/erp/inventory/returns/${receipt.id}`} style={primaryButtonStyle}>
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
