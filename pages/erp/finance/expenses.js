import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
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
      .select("id, expense_date, category_id, vendor, amount, payment_mode, reference, notes, created_at")
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

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Finance / Expenses</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Finance · Expenses</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Record expenses, manage categories, and view monthly totals.</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey || "member"}</b> · {canWrite ? "Write access" : "Read-only"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/erp/finance">← Finance Home</a>
          <a href="/erp">ERP Home</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, alignItems: "flex-start" }}>
        <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Add Expense</h3>
          {!canWrite ? (
            <p style={{ color: "#777", marginTop: 6, marginBottom: 12 }}>Read-only mode — only owner/admin can add expenses.</p>
          ) : null}
          <form onSubmit={createExpense} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={labelStyle}>
              <span style={labelText}>Date</span>
              <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} disabled={!canWrite} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Category</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!canWrite || categories.length === 0} style={inputStyle}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Vendor</span>
              <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor or payee" disabled={!canWrite} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Amount</span>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={!canWrite} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Payment Mode</span>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} disabled={!canWrite} style={inputStyle}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label style={labelStyle}>
              <span style={labelText}>Reference</span>
              <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt # or transaction ref" disabled={!canWrite} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, gridColumn: "1 / span 2" }}>
              <span style={labelText}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" disabled={!canWrite} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} />
            </label>
            <div style={{ gridColumn: "1 / span 2", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={!canWrite} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: canWrite ? "#2563eb" : "#9ca3af", color: "#fff", cursor: canWrite ? "pointer" : "not-allowed" }}>
                Save Expense
              </button>
            </div>
          </form>
        </div>

        <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff", display: "grid", gap: 14 }}>
          <div>
            <h3 style={{ margin: "0 0 8px" }}>Categories</h3>
            {!canWrite ? <p style={{ color: "#777", marginTop: 0 }}>Read-only — categories can be added by owner/admin.</p> : null}
            <form onSubmit={addCategory} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <input type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category name" disabled={!canWrite} style={{ flex: 1, ...inputStyle }} />
              <button type="submit" disabled={!canWrite} style={{ padding: "10px 12px", borderRadius: 8, border: "none", background: canWrite ? "#059669" : "#9ca3af", color: "#fff", cursor: canWrite ? "pointer" : "not-allowed" }}>
                Add
              </button>
            </form>
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", maxHeight: 180, overflowY: "auto" }}>
              {categories.length === 0 ? <li style={{ color: "#777" }}>No categories yet.</li> : null}
              {categories.map((c) => (
                <li key={c.id} style={{ padding: "8px 10px", border: "1px solid #eee", borderRadius: 8, marginBottom: 6, background: "#f9fafb" }}>
                  {c.name}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={{ margin: "0 0 8px" }}>Month Filter</h3>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value || currentMonthValue())}
                style={{ ...inputStyle, width: "180px" }}
              />
              <div style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#111" }}>
                Total: <strong>${monthTotal.toFixed(2)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Expenses for {selectedMonth}</h3>
          <span style={{ color: "#555" }}>{expenses.length} record(s)</span>
        </div>
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>Payment</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Reference</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, textAlign: "center", color: "#777" }}>No expenses for this month.</td>
                </tr>
              ) : (
                expenses.map((ex) => (
                  <tr key={ex.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={tdStyle}>{ex.expense_date}</td>
                    <td style={tdStyle}>{ex.category_name}</td>
                    <td style={tdStyle}>{ex.vendor || "—"}</td>
                    <td style={tdStyle}>{ex.payment_mode || "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>${Number(ex.amount || 0).toFixed(2)}</td>
                    <td style={tdStyle}>{ex.reference || "—"}</td>
                    <td style={tdStyle}>{ex.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: "flex", flexDirection: "column", gap: 6 };
const labelText = { fontSize: 13, color: "#555" };
const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const thStyle = { textAlign: "left", padding: "10px 8px", fontSize: 13, color: "#555", borderBottom: "1px solid #e5e7eb" };
const tdStyle = { padding: "10px 8px", fontSize: 14, color: "#111" };
