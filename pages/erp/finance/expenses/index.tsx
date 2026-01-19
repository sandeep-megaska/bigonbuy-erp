import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
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
import { expenseCategorySchema, expenseListResponseSchema, type ExpenseCategory, type ExpenseListRow } from "../../../../lib/erp/expenses";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

type SimpleOption = {
  id: string;
  name: string;
};

const optionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const channelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const today = () => new Date().toISOString().slice(0, 10);

const startOfMonth = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return first.toISOString().slice(0, 10);
};

const parseDateQuery = (value: string | string[] | undefined) => {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
};

export default function ExpensesListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [channels, setChannels] = useState<SimpleOption[]>([]);
  const [warehouses, setWarehouses] = useState<SimpleOption[]>([]);

  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());
  const [categoryId, setCategoryId] = useState("");
  const [groupKey, setGroupKey] = useState("");
  const [channelId, setChannelId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");

  const [expenses, setExpenses] = useState<ExpenseListRow[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      if (!router.isReady) return;
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

      const lookupOk = await loadLookups(context.companyId);
      if (!lookupOk) {
        setLoading(false);
        return;
      }

      const initialFrom = parseDateQuery(router.query.from) ?? startOfMonth();
      const initialTo = parseDateQuery(router.query.to) ?? today();
      setFromDate(initialFrom);
      setToDate(initialTo);
      await loadExpenses({ fromDate: initialFrom, toDate: initialTo });
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const groupedKeys = useMemo(() => {
    const keys = new Set<string>();
    categories.forEach((cat) => keys.add(cat.group_key));
    return Array.from(keys).sort();
  }, [categories]);

  const filteredExpenses = useMemo(() => {
    if (!groupKey) return expenses;
    return expenses.filter((row) => row.category_group === groupKey);
  }, [expenses, groupKey]);

  const totalAmount = useMemo(
    () => filteredExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [filteredExpenses]
  );

  const loadLookups = async (companyId: string) => {
    setError(null);
    const [{ data: categoryData, error: categoryError }, { data: channelData, error: channelError }, { data: warehouseData, error: warehouseError }] =
      await Promise.all([
        supabase.rpc("erp_expense_categories_list"),
        supabase.from("erp_sales_channels").select("id, name").eq("company_id", companyId).order("name"),
        supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
      ]);

    if (categoryError || channelError || warehouseError) {
      setError(categoryError?.message || channelError?.message || warehouseError?.message || "Failed to load lookups.");
      return false;
    }

    const parsedCategories = expenseCategorySchema.array().safeParse(categoryData);
    const parsedChannels = channelSchema.array().safeParse(channelData);
    const parsedWarehouses = optionSchema.array().safeParse(warehouseData);

    if (!parsedCategories.success || !parsedChannels.success || !parsedWarehouses.success) {
      setError("Failed to parse lookup data.");
      return false;
    }

    setCategories(parsedCategories.data);
    setChannels(parsedChannels.data);
    setWarehouses(parsedWarehouses.data);
    return true;
  };

  const loadExpenses = async (overrides?: {
    fromDate?: string;
    toDate?: string;
    categoryId?: string;
    channelId?: string;
    warehouseId?: string;
    search?: string;
  }) => {
    setIsLoadingList(true);
    setError(null);
    const effectiveFrom = overrides?.fromDate ?? fromDate;
    const effectiveTo = overrides?.toDate ?? toDate;
    const effectiveCategory = overrides?.categoryId ?? categoryId;
    const effectiveChannel = overrides?.channelId ?? channelId;
    const effectiveWarehouse = overrides?.warehouseId ?? warehouseId;
    const effectiveSearch = overrides?.search ?? search;
    const { data, error: listError } = await supabase.rpc("erp_expenses_list", {
      p_from: effectiveFrom,
      p_to: effectiveTo,
      p_category_id: effectiveCategory || null,
      p_channel_id: effectiveChannel || null,
      p_warehouse_id: effectiveWarehouse || null,
      p_search: effectiveSearch || null,
      p_limit: 500,
      p_offset: 0,
    });

    if (listError) {
      setError(listError.message);
      setIsLoadingList(false);
      return;
    }

    const parsed = expenseListResponseSchema.safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse expenses list.");
      setIsLoadingList(false);
      return;
    }

    setExpenses(parsed.data);
    setIsLoadingList(false);
  };

  const handleExport = () => {
    const headers = [
      "expense_date",
      "category_group",
      "category_name",
      "amount",
      "currency",
      "channel",
      "warehouse",
      "vendor",
      "payee_name",
      "reference",
      "description",
    ];
    const rows = filteredExpenses.map((row) => [
      row.expense_date,
      row.category_group,
      row.category_name,
      row.amount.toFixed(2),
      row.currency,
      row.channel_name || "",
      row.warehouse_name || "",
      row.vendor_name || "",
      row.payee_name || "",
      row.reference || "",
      row.description || "",
    ]);
    const csv = [headers.join(","), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
    triggerDownload(`expenses_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
  };

  const handleDelete = async (expenseId: string) => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can delete expenses.");
      return;
    }
    if (!window.confirm("Delete this expense? This cannot be undone.")) return;
    setError(null);
    const { error: deleteError } = await supabase.rpc("erp_expenses_delete", { p_id: expenseId });
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await loadExpenses();
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading expenses…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader eyebrow="Finance" title="Expenses" description="Track company expenses." />
          <p style={{ color: "#b91c1c" }}>{error || "No company membership found."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Expenses"
          description="Track expenses, filter spend, and export for reporting."
          rightActions={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/erp/finance/expenses/new" style={primaryButtonStyle}>
                New Expense
              </Link>
              <Link href="/erp/finance/expenses/recurring" style={secondaryButtonStyle}>
                Recurring Templates
              </Link>
              <Link href="/erp/finance/expenses/import" style={secondaryButtonStyle}>
                Import CSV
              </Link>
              <Link href="/erp/finance/expenses/reports" style={secondaryButtonStyle}>
                Reports
              </Link>
            </div>
          }
        />

        <div style={{ color: "#6b7280" }}>
          Signed in as <strong>{ctx.email}</strong> · Role: <strong>{ctx.roleKey || "member"}</strong>
        </div>

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
            <label style={filterLabelStyle}>
              <span>Category</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} style={inputStyle}>
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              <span>Category group</span>
              <select value={groupKey} onChange={(event) => setGroupKey(event.target.value)} style={inputStyle}>
                <option value="">All groups</option>
                {groupedKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              <span>Channel</span>
              <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle}>
                <option value="">All channels</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              <span>Warehouse</span>
              <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} style={inputStyle}>
                <option value="">All warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              <span>Search</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} style={inputStyle} placeholder="Reference or payee" />
            </label>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={loadExpenses} style={primaryButtonStyle}>
              Apply Filters
            </button>
            <button type="button" onClick={handleExport} style={secondaryButtonStyle}>
              Export CSV
            </button>
            <span style={{ color: "#6b7280" }}>
              {filteredExpenses.length} records · Total ₹{totalAmount.toFixed(2)}
            </span>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ marginBottom: 12, color: "#6b7280" }}>
            {isLoadingList ? "Loading expenses…" : "Latest expenses"}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Category</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Channel</th>
                  <th style={tableHeaderCellStyle}>Warehouse</th>
                  <th style={tableHeaderCellStyle}>Vendor/Payee</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}>
                      No expenses found for this filter.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((row) => (
                    <tr key={row.id}>
                      <td style={tableCellStyle}>{row.expense_date}</td>
                      <td style={tableCellStyle}>
                        {row.category_name}
                        <div style={{ color: "#6b7280", fontSize: 12 }}>{row.category_group}</div>
                      </td>
                      <td style={{ ...tableCellStyle, fontWeight: 600 }}>₹{row.amount.toFixed(2)}</td>
                      <td style={tableCellStyle}>{row.channel_name || "—"}</td>
                      <td style={tableCellStyle}>{row.warehouse_name || "—"}</td>
                      <td style={tableCellStyle}>{row.vendor_name || row.payee_name || "—"}</td>
                      <td style={tableCellStyle}>{row.reference || "—"}</td>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Link href={`/erp/finance/expenses/${row.id}`} style={secondaryButtonStyle}>
                            View
                          </Link>
                          <button type="button" onClick={() => handleDelete(row.id)} style={secondaryButtonStyle}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ErpShell>
  );
}

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#4b5563",
};
