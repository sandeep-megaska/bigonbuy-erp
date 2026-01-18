import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { pageContainerStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import ExpenseForm from "../../../../components/finance/ExpenseForm";
import { expenseCategorySchema, expenseFormSchema, type ExpenseCategory, type ExpenseFormPayload } from "../../../../lib/erp/expenses";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  email: string | null;
};

type Option = {
  id: string;
  name: string;
};

const optionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const expenseRecordSchema = z.object({
  id: z.string().uuid(),
  expense_date: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  category_id: z.string().uuid(),
  channel_id: z.string().uuid().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  vendor_id: z.string().uuid().nullable(),
  payee_name: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  is_recurring: z.boolean(),
  recurring_rule: z.string().nullable(),
  attachment_url: z.string().nullable(),
});

export default function ExpenseEditPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [initialValues, setInitialValues] = useState<ExpenseFormPayload | null>(null);

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

      if (typeof id !== "string") {
        setError("Expense id not found.");
        setLoading(false);
        return;
      }

      await loadLookups(context.companyId);
      await loadExpense(id);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

  const loadLookups = async (companyId: string) => {
    setError(null);
    const [{ data: categoryData, error: categoryError }, { data: channelData, error: channelError }, { data: warehouseData, error: warehouseError }, { data: vendorData, error: vendorError }] =
      await Promise.all([
        supabase.rpc("erp_expense_categories_list"),
        supabase.from("erp_sales_channels").select("id, name").eq("company_id", companyId).order("name"),
        supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
        supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
      ]);

    if (categoryError || channelError || warehouseError || vendorError) {
      setError(categoryError?.message || channelError?.message || warehouseError?.message || vendorError?.message || "Failed to load lookup data.");
      return;
    }

    const parsedCategories = expenseCategorySchema.array().safeParse(categoryData);
    const parsedChannels = optionSchema.array().safeParse(channelData);
    const parsedWarehouses = optionSchema.array().safeParse(warehouseData);
    const parsedVendors = z
      .object({
        id: z.string().uuid(),
        legal_name: z.string(),
      })
      .array()
      .safeParse(vendorData);

    if (!parsedCategories.success || !parsedChannels.success || !parsedWarehouses.success || !parsedVendors.success) {
      setError("Failed to parse lookup data.");
      return;
    }

    setCategories(parsedCategories.data);
    setChannels(parsedChannels.data);
    setWarehouses(parsedWarehouses.data);
    setVendors(parsedVendors.data.map((vendor) => ({ id: vendor.id, name: vendor.legal_name })));
  };

  const loadExpense = async (expenseId: string) => {
    setError(null);
    const { data, error: expenseError } = await supabase
      .from("erp_expenses")
      .select(
        "id, expense_date, amount, currency, category_id, channel_id, warehouse_id, vendor_id, payee_name, reference, description, is_recurring, recurring_rule, attachment_url"
      )
      .eq("id", expenseId)
      .single();

    if (expenseError) {
      setError(expenseError.message);
      return;
    }

    const parsed = expenseRecordSchema.safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse expense data.");
      return;
    }

    const normalized = expenseFormSchema.safeParse({
      expense_date: parsed.data.expense_date,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      category_id: parsed.data.category_id,
      channel_id: parsed.data.channel_id,
      warehouse_id: parsed.data.warehouse_id,
      vendor_id: parsed.data.vendor_id,
      payee_name: parsed.data.payee_name,
      reference: parsed.data.reference,
      description: parsed.data.description,
      is_recurring: parsed.data.is_recurring,
      recurring_rule: parsed.data.recurring_rule,
      attachment_url: parsed.data.attachment_url,
    });

    if (!normalized.success) {
      setError("Expense data failed validation.");
      return;
    }

    setInitialValues(normalized.data);
  };

  const handleSubmit = async (payload: ExpenseFormPayload) => {
    if (typeof id !== "string") {
      setError("Expense id not found.");
      return;
    }
    setError(null);
    const { data, error: updateError } = await supabase.rpc("erp_expense_upsert", {
      p_id: id,
      p_expense_date: payload.expense_date,
      p_amount: payload.amount,
      p_currency: payload.currency,
      p_category_id: payload.category_id,
      p_channel_id: payload.channel_id,
      p_warehouse_id: payload.warehouse_id,
      p_vendor_id: payload.vendor_id,
      p_payee_name: payload.payee_name,
      p_reference: payload.reference,
      p_description: payload.description,
      p_is_recurring: payload.is_recurring,
      p_recurring_rule: payload.recurring_rule,
      p_attachment_url: payload.attachment_url,
    });

    if (updateError) {
      setError(updateError.message);
      return;
    }

    const parsed = z.string().uuid().safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse updated expense id.");
      return;
    }

    await router.push("/erp/finance/expenses");
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading expense…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>{error || "No company membership found."}</div>
      </ErpShell>
    );
  }

  if (!initialValues) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>{error || "Unable to load expense."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Edit Expense"
          description="Update expense details."
          rightActions={
            <Link href="/erp/finance/expenses" style={secondaryButtonStyle}>
              Back to Expenses
            </Link>
          }
        />
        <ExpenseForm
          categories={categories}
          channels={channels}
          warehouses={warehouses}
          vendors={vendors}
          canWrite={canWrite}
          submitLabel="Save Changes"
          onSubmit={handleSubmit}
          error={error}
          initialValues={initialValues}
        />
      </div>
    </ErpShell>
  );
}
