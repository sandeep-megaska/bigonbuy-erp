import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { createCsvBlob, triggerDownload } from "../../../../components/inventory/csvUtils";
import {
  monthlyCategorySummarySchema,
  monthlyChannelSummarySchema,
  monthlyWarehouseSummarySchema,
} from "../../../../lib/erp/expenses";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

type TabKey = "category" | "channel" | "warehouse";

const today = () => new Date().toISOString().slice(0, 10);

const startOfMonth = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return first.toISOString().slice(0, 10);
};

export default function ExpenseReportsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("category");
  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());

  const [categoryRows, setCategoryRows] = useState<{ month: string; category_group: string; category_name: string; amount: number }[]>([]);
  const [channelRows, setChannelRows] = useState<{ month: string; channel_name: string; amount: number }[]>([]);
  const [warehouseRows, setWarehouseRows] = useState<{ month: string; warehouse_name: string; amount: number }[]>([]);

  const [isLoadingReports, setIsLoadingReports] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      await loadReports();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadReports = async () => {
    setIsLoadingReports(true);
    setError(null);

    const [categoryRes, channelRes, warehouseRes] = await Promise.all([
      supabase.rpc("erp_expense_monthly_summary", { p_from: fromDate, p_to: toDate }),
      supabase.rpc("erp_expense_monthly_by_channel", { p_from: fromDate, p_to: toDate }),
      supabase.rpc("erp_expense_monthly_by_warehouse", { p_from: fromDate, p_to: toDate }),
    ]);

    if (categoryRes.error || channelRes.error || warehouseRes.error) {
      setError(categoryRes.error?.message || channelRes.error?.message || warehouseRes.error?.message || "Failed to load reports.");
      setIsLoadingReports(false);
      return;
    }

    const parsedCategory = monthlyCategorySummarySchema.safeParse(categoryRes.data);
    const parsedChannel = monthlyChannelSummarySchema.safeParse(channelRes.data);
    const parsedWarehouse = monthlyWarehouseSummarySchema.safeParse(warehouseRes.data);

    if (!parsedCategory.success || !parsedChannel.success || !parsedWarehouse.success) {
      setError("Failed to parse report data.");
      setIsLoadingReports(false);
      return;
    }

    setCategoryRows(parsedCategory.data);
    setChannelRows(parsedChannel.data);
    setWarehouseRows(parsedWarehouse.data);
    setIsLoadingReports(false);
  };

  const totalForActive = useMemo(() => {
    if (activeTab === "category") return categoryRows.reduce((sum, row) => sum + row.amount, 0);
    if (activeTab === "channel") return channelRows.reduce((sum, row) => sum + row.amount, 0);
    return warehouseRows.reduce((sum, row) => sum + row.amount, 0);
  }, [activeTab, categoryRows, channelRows, warehouseRows]);

  const handleExport = () => {
    if (activeTab === "category") {
      const headers = ["month", "category_group", "category_name", "amount"];
      const lines = categoryRows.map((row) => [row.month, row.category_group, row.category_name, row.amount.toFixed(2)]);
      const csv = [headers.join(","), ...lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
      triggerDownload(`expense_summary_category_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
      return;
    }
    if (activeTab === "channel") {
      const headers = ["month", "channel_name", "amount"];
      const lines = channelRows.map((row) => [row.month, row.channel_name, row.amount.toFixed(2)]);
      const csv = [headers.join(","), ...lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
      triggerDownload(`expense_summary_channel_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
      return;
    }
    const headers = ["month", "warehouse_name", "amount"];
    const lines = warehouseRows.map((row) => [row.month, row.warehouse_name, row.amount.toFixed(2)]);
    const csv = [headers.join(","), ...lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
    triggerDownload(`expense_summary_warehouse_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading reports…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>{error || "No company membership found."}</div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Expense Reports"
          description="Monthly summaries by category, channel, and warehouse."
          rightActions={
            <Link href="/erp/finance/expenses" style={secondaryButtonStyle}>
              Back to Expenses
            </Link>
          }
        />

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2", color: "#b91c1c" }}>{error}</div>
        ) : null}

        <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={filterLabelStyle}>
              <span>Date from</span>
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} style={inputStyle} />
            </label>
            <label style={filterLabelStyle}>
              <span>Date to</span>
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} style={inputStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={loadReports} style={primaryButtonStyle}>
              Refresh Reports
            </button>
            <button type="button" onClick={handleExport} style={secondaryButtonStyle}>
              Export CSV
            </button>
            <span style={{ color: "#6b7280", alignSelf: "center" }}>
              Total ₹{totalForActive.toFixed(2)} {isLoadingReports ? "· Loading…" : ""}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabItems.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={tab.key === activeTab ? activeTabStyle : secondaryButtonStyle}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={cardStyle}>
          {activeTab === "category" ? (
            <SummaryTable
              headers={["Month", "Category Group", "Category", "Amount"]}
              rows={categoryRows.map((row) => [row.month, row.category_group, row.category_name, `₹${row.amount.toFixed(2)}`])}
            />
          ) : null}
          {activeTab === "channel" ? (
            <SummaryTable
              headers={["Month", "Channel", "Amount"]}
              rows={channelRows.map((row) => [row.month, row.channel_name, `₹${row.amount.toFixed(2)}`])}
            />
          ) : null}
          {activeTab === "warehouse" ? (
            <SummaryTable
              headers={["Month", "Warehouse", "Amount"]}
              rows={warehouseRows.map((row) => [row.month, row.warehouse_name, `₹${row.amount.toFixed(2)}`])}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

const tabItems: { key: TabKey; label: string }[] = [
  { key: "category", label: "By Category" },
  { key: "channel", label: "By Channel" },
  { key: "warehouse", label: "By Warehouse" },
];

const activeTabStyle = {
  ...secondaryButtonStyle,
  backgroundColor: "#111827",
  color: "#fff",
};

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#4b5563",
};

const SummaryTable = ({ headers, rows }: { headers: string[]; rows: string[][] }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={tableStyle}>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} style={tableHeaderCellStyle}>
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={headers.length} style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}>
              No data for this period.
            </td>
          </tr>
        ) : (
          rows.map((row, idx) => (
            <tr key={`${row[0]}-${idx}`}>
              {row.map((cell, cellIdx) => (
                <td key={`${idx}-${cellIdx}`} style={tableCellStyle}>
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);
