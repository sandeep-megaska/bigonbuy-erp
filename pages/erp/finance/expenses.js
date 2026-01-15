import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../components/erp/ErpShell";
import ErpPageHeader from "../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../components/erp/uiStyles";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../lib/erpContext";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function currentMonthValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  return `${y}-${m}`;
}

export default function FinanceExpensesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState("");

  const [expenseDate, setExpenseDate] = useState(formatDate(new Date()));
  const [categoryId, setCategoryId] = useState("");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const [selectedMonth, setSelectedMonth] = useState(currentMonthValue());
  const [expenses, setExpenses] = useState([]);
  const [monthTotal, setMonthTotal] = useState(0);

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
        setErr(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadAll(context.companyId, selectedMonth, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (ctx?.companyId) {
      loadAll(ctx.companyId, selectedMonth, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  async function loadAll(companyId, monthValue, isActive = true) {
    setErr("");
    const catList = await loadCategories(companyId, isActive);
    await loadExpenses(companyId, monthValue, catList, isActive);
  }

  async function loadCategories(companyId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_expense_categories")
      .select("id, name, created_at")
      .eq("company_id", companyId)
      .order("name", { ascending: true });

    if (error && isActive) setErr(error.message);
    if (isActive) {
      setCategories(data || []);
      if (data && data.length > 0 && !categoryId) {
        setCategoryId(data[0].id);
      }
    }
    return data || [];
  }

  function monthRange(value) {
    const safeValue = value || currentMonthValue();
    const [y, m] = safeValue.split("-").map((v) => Number(v));
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    const startStr = formatDate(start);
    const endStr = formatDate(end);
    return { startStr, endStr };
  }

  async function loadExpenses(companyId, monthValue, catList, isActive = true) {
    const { startStr, endStr } = monthRange(monthValue);
    const { data, error } = await supabase
      .from("erp_expenses")
      .select(
        "id, expense_date, category_id, vendor, amount, payment_mode, reference, notes, created_at"
      )
      .eq("company_id", companyId)
      .gte("expense_date", startStr)
      .lt("expense_date", endStr)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error && isActive) {
      setErr(error.message);
      return;
    }

    const catMap = new Map((catList || categories).map((c) => [c.id, c.name]));
    const decorated = (data || []).map((row) => ({
      ...row,
      category_name: catMap.get(row.category_id) || "Uncategorized",
    }));

    const total = decorated.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    if (isActive) {
      setExpenses(decorated);
      setMonthTotal(total);
    }
  }

  async function addCategory(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only owner/admin can manage categories.");
      return;
    }

    const name = newCategory.trim();
    if (!name) {
      setErr("Enter a category name.");
      return;
    }

    setErr("");
    const { error } = await supabase.from("erp_expense_categories").insert({
      company_id: ctx.companyId,
      name,
      created_by: ctx.userId,
    });

    if (error) {
      setErr(error.message);
      return;
    }

    setNewCategory("");
    await loadCategories(ctx.companyId);
  }

  async function createExpense(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only owner/admin can create expenses.");
      return;
    }

    const amt = Number(amount);
    if (!expenseDate || !categoryId || !Number.isFinite(amt) || amt <= 0) {
      setErr("Please enter date, category, and a positive amount.");
      return;
    }

    setErr("");
    const payload = {
      company_id: ctx.companyId,
      expense_date: expenseDate,
      category_id: categoryId,
      vendor: vendor || null,
      amount: amt,
      payment_mode: paymentMode || null,
      reference: reference || null,
      notes: notes || null,
      created_by: ctx.userId,
    };

    const { error } = await supabase.from("erp_expenses").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }

    setVendor("");
    setAmount("");
    setReference("");
    setNotes("");
    await loadAll(ctx.companyId, selectedMonth);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Finance / Expenses"
            description="Record expenses and manage categories."
            rightActions={
              <button type="button" onClick={handleSignOut} style={dangerButtonStyle}>
                Sign Out
              </button>
            }
          />
          <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Finance · Expenses"
          description="Record expenses, manage categories, and view monthly totals."
          rightActions={
            <>
              <Link href="/erp/finance" style={linkButtonStyle}>
                Finance Home
              </Link>
              <Link href="/erp" style={linkButtonStyle}>
                ERP Home
              </Link>
            </>
          }
        />

        <p style={{ margin: 0, color: "#6b7280" }}>
          Signed in as <strong>{ctx?.email}</strong> · Role: <strong>{ctx?.roleKey || "member"}</strong>
          · {canWrite ? "Write access" : "Read-only"}
        </p>

        {err ? <div style={errorCardStyle}>{err}</div> : null}

        <div style={twoColumnGridStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitleStyle}>Add Expense</h3>
            {!canWrite ? (
              <p style={helperTextStyle}>Read-only mode — only owner/admin can add expenses.</p>
            ) : null}
            <form onSubmit={createExpense} style={expenseFormStyle}>
              <label style={labelStyle}>
                <span style={labelText}>Date</span>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  disabled={!canWrite}
                  style={fullWidthInputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span style={labelText}>Category</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={!canWrite || categories.length === 0}
                  style={fullWidthInputStyle}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                <span style={labelText}>Vendor</span>
                <input
                  type="text"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Vendor or payee"
                  disabled={!canWrite}
                  style={fullWidthInputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span style={labelText}>Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={!canWrite}
                  style={fullWidthInputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span style={labelText}>Payment Mode</span>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  disabled={!canWrite}
                  style={fullWidthInputStyle}
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span style={labelText}>Reference</span>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Receipt # or transaction ref"
                  disabled={!canWrite}
                  style={fullWidthInputStyle}
                />
              </label>
              <label style={{ ...labelStyle, gridColumn: "1 / span 2" }}>
                <span style={labelText}>Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes"
                  disabled={!canWrite}
                  style={{ ...fullWidthInputStyle, minHeight: 80, resize: "vertical" }}
                />
              </label>
              <div style={formActionsStyle}>
                <button type="submit" disabled={!canWrite} style={actionButtonStyle(canWrite)}>
                  Save Expense
                </button>
              </div>
            </form>
          </div>

          <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
            <div>
              <h3 style={sectionTitleStyle}>Categories</h3>
              {!canWrite ? (
                <p style={helperTextStyle}>Read-only — categories can be added by owner/admin.</p>
              ) : null}
              <form onSubmit={addCategory} style={categoryFormStyle}>
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="New category name"
                  disabled={!canWrite}
                  style={{ ...fullWidthInputStyle, flex: 1 }}
                />
                <button type="submit" disabled={!canWrite} style={actionButtonStyle(canWrite)}>
                  Add
                </button>
              </form>
              <ul style={categoryListStyle}>
                {categories.length === 0 ? <li style={helperTextStyle}>No categories yet.</li> : null}
                {categories.map((c) => (
                  <li key={c.id} style={categoryItemStyle}>
                    {c.name}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 style={sectionTitleStyle}>Month Filter</h3>
              <div style={monthFilterStyle}>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value || currentMonthValue())}
                  style={{ ...fullWidthInputStyle, width: 180 }}
                />
                <div style={monthTotalStyle}>
                  Total: <strong>${monthTotal.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={sectionHeaderRowStyle}>
            <h3 style={{ margin: 0 }}>Expenses for {selectedMonth}</h3>
            <span style={helperTextStyle}>{expenses.length} record(s)</span>
          </div>
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Category</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Payment</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}>
                      No expenses for this month.
                    </td>
                  </tr>
                ) : (
                  expenses.map((ex) => (
                    <tr key={ex.id}>
                      <td style={tableCellStyle}>{ex.expense_date}</td>
                      <td style={tableCellStyle}>{ex.category_name}</td>
                      <td style={tableCellStyle}>{ex.vendor || "—"}</td>
                      <td style={tableCellStyle}>{ex.payment_mode || "—"}</td>
                      <td style={{ ...tableCellStyle, fontWeight: 600 }}>
                        ${Number(ex.amount || 0).toFixed(2)}
                      </td>
                      <td style={tableCellStyle}>{ex.reference || "—"}</td>
                      <td style={tableCellStyle}>{ex.notes || "—"}</td>
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

const labelStyle = { display: "flex", flexDirection: "column", gap: 6 };
const labelText = { fontSize: 13, color: "#4b5563" };
const fullWidthInputStyle = { ...inputStyle, width: "100%" };

const expenseFormStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

const formActionsStyle = {
  gridColumn: "1 / span 2",
  display: "flex",
  justifyContent: "flex-end",
};

const categoryFormStyle = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  marginTop: 8,
};

const categoryListStyle = {
  listStyle: "none",
  padding: 0,
  margin: "12px 0 0",
  maxHeight: 180,
  overflowY: "auto",
};

const categoryItemStyle = {
  padding: "8px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  marginBottom: 6,
  background: "#f9fafb",
};

const twoColumnGridStyle = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "1.1fr 1fr",
  gap: 16,
  alignItems: "flex-start",
};

const sectionTitleStyle = {
  marginTop: 0,
  marginBottom: 8,
};

const helperTextStyle = {
  color: "#6b7280",
  marginTop: 6,
  marginBottom: 12,
  fontSize: 13,
};

const sectionHeaderRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const monthFilterStyle = {
  display: "flex",
  gap: 10,
  alignItems: "center",
};

const monthTotalStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  color: "#111",
};

const errorCardStyle = {
  ...cardStyle,
  borderColor: "#fecaca",
  backgroundColor: "#fff1f2",
  color: "#b91c1c",
};

const dangerButtonStyle = {
  ...secondaryButtonStyle,
  borderColor: "#dc2626",
  color: "#dc2626",
};

const linkButtonStyle = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const actionButtonStyle = (enabled) => ({
  ...primaryButtonStyle,
  backgroundColor: enabled ? "#2563eb" : "#9ca3af",
  borderColor: enabled ? "#2563eb" : "#9ca3af",
  cursor: enabled ? "pointer" : "not-allowed",
});
