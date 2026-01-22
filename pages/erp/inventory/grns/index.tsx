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
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Grn = {
  id: string;
  grn_no: string | null;
  purchase_order_id: string;
  status: string;
  received_at: string;
};

type PurchaseOrder = {
  id: string;
  doc_no: string | null;
  po_no: string | null;
  vendor_id: string;
};

type Vendor = {
  id: string;
  legal_name: string;
};

export default function GrnListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [grns, setGrns] = useState<Grn[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

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

      await loadData(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadData(companyId: string, isActiveFetch = true) {
    setError("");
    const [grnRes, poRes, vendorRes] = await Promise.all([
      supabase
        .from("erp_grns")
        .select("id, grn_no, purchase_order_id, status, received_at")
        .eq("company_id", companyId)
        .order("received_at", { ascending: false }),
      supabase.from("erp_purchase_orders").select("id, doc_no, po_no, vendor_id").eq("company_id", companyId),
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId),
    ]);

    if (grnRes.error || poRes.error || vendorRes.error) {
      if (isActiveFetch) {
        setError(grnRes.error?.message || poRes.error?.message || vendorRes.error?.message || "Failed to load GRNs.");
      }
      return;
    }

    if (isActiveFetch) {
      setGrns((grnRes.data || []) as Grn[]);
      setPurchaseOrders((poRes.data || []) as PurchaseOrder[]);
      setVendors((vendorRes.data || []) as Vendor[]);
    }
  }

  const poMap = useMemo(() => new Map(purchaseOrders.map((po) => [po.id, po])), [purchaseOrders]);
  const vendorMap = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.legal_name])), [vendors]);

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory</p>
            <h1 style={h1Style}>GRNs</h1>
            <p style={subtitleStyle}>Track goods receipts and posted inventory updates.</p>
          </div>
        </header>

        {error ? <div style={{ ...cardStyle, borderColor: "#fca5a5", color: "#b91c1c" }}>{error}</div> : null}

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>GRN</th>
                <th style={tableHeaderCellStyle}>PO</th>
                <th style={tableHeaderCellStyle}>Vendor</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Received At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    Loading GRNs...
                  </td>
                </tr>
              ) : grns.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No GRNs posted yet.
                  </td>
                </tr>
              ) : (
                grns.map((grn) => {
                  const po = poMap.get(grn.purchase_order_id);
                  const grnLabel = grn.grn_no || "—";
                  return (
                    <tr key={grn.id}>
                      <td style={tableCellStyle}>{grnLabel}</td>
                      <td style={tableCellStyle}>{po?.doc_no || "—"}</td>
                      <td style={tableCellStyle}>{vendorMap.get(po?.vendor_id || "") || "—"}</td>
                      <td style={tableCellStyle}>{grn.status}</td>
                      <td style={tableCellStyle}>{new Date(grn.received_at).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
