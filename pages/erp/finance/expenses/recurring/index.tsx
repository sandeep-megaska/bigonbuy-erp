import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import {
  recurringExpenseGeneratorResponseSchema,
  recurringExpenseTemplateSchema,
  type RecurringExpenseGeneratorResponse,
  type RecurringExpenseTemplate,
} from "../../../../../lib/erp/recurringExpenses";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

const nextMonthValue = () => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toISOString().slice(0, 7);
};

const toMonthStart = (monthValue: string) => `${monthValue}-01`;

const monthRange = (monthValue: string) => {
  const [year, month] = monthValue.split("-").map((part) => Number(part));
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
};

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

export default function RecurringExpensesPage() {
  const router = useRouter();
  const generatorRef = useRef<HTMLDivElement | null>(null);
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<RecurringExpenseTemplate[]>([]);
  const [generatorMonth, setGeneratorMonth] = useState(nextMonthValue());
  const [validateOnly, setValidateOnly] = useState(true);
  const [generatorResult, setGeneratorResult] = useState<RecurringExpenseGeneratorResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

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

      await loadTemplates();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadTemplates = async () => {
    setError(null);
    const { data, error: listError } = await supabase.rpc("erp_recurring_expense_templates_list");

    if (listError) {
      setError(listError.message);
      return;
    }

    const parsed = recurringExpenseTemplateSchema.array().safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse recurring templates.");
      return;
    }

    setTemplates(parsed.data);
  };

  const handleToggleActive = async (templateId: string, nextActive: boolean) => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can update templates.");
      return;
    }

    setError(null);
    const { error: updateError } = await supabase.rpc("erp_recurring_expense_template_set_active", {
      p_template_id: templateId,
      p_is_active: nextActive,
    });

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadTemplates();
  };

  const runGenerator = async (validate: boolean) => {
    if (!canWrite) {
      setError("Only finance, admin, or owner can generate recurring expenses.");
      return;
    }

    if (!generatorMonth) {
      setError("Select a month to generate.");
      return;
    }

    setIsGenerating(true);
    setError(null);

    const { data, error: generateError } = await supabase.rpc("erp_generate_recurring_expenses", {
      p_month: toMonthStart(generatorMonth),
      p_validate_only: validate,
    });

    if (generateError) {
      setError(generateError.message);
      setIsGenerating(false);
      return;
    }

    const parsed = recurringExpenseGeneratorResponseSchema.safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse generator response.");
      setIsGenerating(false);
      return;
    }

    setGeneratorResult(parsed.data);
    setIsGenerating(false);

    if (!validate) {
      await loadTemplates();
    }
  };

  const handleGenerateClick = async () => {
    if (validateOnly) {
      await runGenerator(true);
      return;
    }

    if (!generatorResult || generatorResult.month !== generatorMonth) {
      setError("Run preview for the selected month before generating.");
      return;
    }

    const confirmMessage = `Generate ${generatorResult.would_create} expenses for ${generatorResult.month}?`;
    if (!window.confirm(confirmMessage)) return;

    await runGenerator(false);
  };

  const handleGenerateNextMonth = () => {
    setGeneratorMonth(nextMonthValue());
    setValidateOnly(true);
    setGeneratorResult(null);
    generatorRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const expenseMonthLink = useMemo(() => {
    if (!generatorResult) return null;
    const { from, to } = monthRange(generatorResult.month);
    return `/erp/finance/expenses?from=${from}&to=${to}`;
  }, [generatorResult]);

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading recurring templates…</div>
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
          title="Recurring Expense Templates"
          description="Manage recurring expenses and generate upcoming month entries."
          rightActions={
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={handleGenerateNextMonth} style={secondaryButtonStyle}>
                Generate Next Month
              </button>
              <Link href="/erp/finance/expenses/recurring/new" style={primaryButtonStyle}>
                New Template
              </Link>
              <Link href="/erp/finance/expenses" style={secondaryButtonStyle}>
                Back to Expenses
              </Link>
            </div>
          }
        />

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2", color: "#b91c1c" }}>{error}</div>
        ) : null}

        <div style={cardStyle} ref={generatorRef}>
          <h3 style={{ marginTop: 0 }}>Generate recurring expenses</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: "#4b5563" }}>Month</span>
              <input
                type="month"
                value={generatorMonth}
                onChange={(event) => setGeneratorMonth(event.target.value)}
                disabled={!canWrite}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={validateOnly}
                onChange={(event) => setValidateOnly(event.target.checked)}
                disabled={!canWrite}
              />
              Validate only
            </label>
            <button
              type="button"
              onClick={handleGenerateClick}
              style={primaryButtonStyle}
              disabled={!canWrite || isGenerating}
            >
              {validateOnly ? "Preview" : "Generate"}
            </button>
          </div>
          {generatorResult ? (
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span style={badgeStyle}>Would create: {generatorResult.would_create}</span>
                <span style={badgeStyle}>Created: {generatorResult.created}</span>
                <span style={badgeStyle}>Skipped: {generatorResult.skipped}</span>
                <span style={{ ...badgeStyle, backgroundColor: "#ede9fe", color: "#5b21b6" }}>
                  Month: {generatorResult.month}
                </span>
                {expenseMonthLink ? (
                  <Link href={expenseMonthLink} style={{ ...badgeStyle, textDecoration: "none" }}>
                    View expenses for month
                  </Link>
                ) : null}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Template</th>
                      <th style={tableHeaderCellStyle}>Expense date</th>
                      <th style={tableHeaderCellStyle}>Amount</th>
                      <th style={tableHeaderCellStyle}>Status</th>
                      <th style={tableHeaderCellStyle}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generatorResult.rows.map((row) => (
                      <tr key={`${row.template_id}-${row.expense_date}`}>
                        <td style={tableCellStyle}>{row.template_name}</td>
                        <td style={tableCellStyle}>{row.expense_date}</td>
                        <td style={tableCellStyle}>{row.amount.toFixed(2)}</td>
                        <td style={tableCellStyle}>{row.status}</td>
                        <td style={tableCellStyle}>{row.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Name</th>
                <th style={tableHeaderCellStyle}>Category</th>
                <th style={tableHeaderCellStyle}>Amount</th>
                <th style={tableHeaderCellStyle}>Day</th>
                <th style={tableHeaderCellStyle}>Channel</th>
                <th style={tableHeaderCellStyle}>Warehouse</th>
                <th style={tableHeaderCellStyle}>Vendor</th>
                <th style={tableHeaderCellStyle}>Active</th>
                <th style={tableHeaderCellStyle}>Last generated</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={10}>
                    No recurring templates found.
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr key={template.id}>
                    <td style={tableCellStyle}>{template.name}</td>
                    <td style={tableCellStyle}>{template.category_name}</td>
                    <td style={tableCellStyle}>
                      {template.currency} {template.amount.toFixed(2)}
                    </td>
                    <td style={tableCellStyle}>{template.day_of_month}</td>
                    <td style={tableCellStyle}>{template.channel_name || "—"}</td>
                    <td style={tableCellStyle}>{template.warehouse_name || "—"}</td>
                    <td style={tableCellStyle}>{template.vendor_name || template.payee_name || "—"}</td>
                    <td style={tableCellStyle}>{template.is_active ? "Yes" : "No"}</td>
                    <td style={tableCellStyle}>{template.last_generated_month || "—"}</td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Link href={`/erp/finance/expenses/recurring/${template.id}`} style={secondaryButtonStyle}>
                          Edit
                        </Link>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => handleToggleActive(template.id, !template.is_active)}
                        >
                          {template.is_active ? "Disable" : "Enable"}
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
    </>
  );
}
