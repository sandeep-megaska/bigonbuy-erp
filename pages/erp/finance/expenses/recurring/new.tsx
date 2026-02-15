import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { pageContainerStyle, secondaryButtonStyle } from "../../../../../components/erp/uiStyles";
import RecurringTemplateForm from "../../../../../components/finance/RecurringTemplateForm";
import { expenseCategorySchema, type ExpenseCategory } from "../../../../../lib/erp/expenses";
import { recurringExpenseTemplateFormSchema, type RecurringExpenseTemplateFormPayload } from "../../../../../lib/erp/recurringExpenses";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

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

const currentMonthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

export default function RecurringTemplateCreatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);

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

      await loadLookups(context.companyId);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

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

    const categoryParse = expenseCategorySchema.array().safeParse(categoryData);
    const parsedChannels = optionSchema.array().safeParse(channelData);
    const parsedWarehouses = optionSchema.array().safeParse(warehouseData);
    const parsedVendors = z
      .object({
        id: z.string().uuid(),
        legal_name: z.string(),
      })
      .array()
      .safeParse(vendorData);

    if (!categoryParse.success || !parsedChannels.success || !parsedWarehouses.success || !parsedVendors.success) {
      setError("Failed to parse lookup data.");
      return;
    }

    setCategories(categoryParse.data);
    setChannels(parsedChannels.data);
    setWarehouses(parsedWarehouses.data);
    setVendors(parsedVendors.data.map((vendor) => ({ id: vendor.id, name: vendor.legal_name })));
  };

  const handleSubmit = async (payload: RecurringExpenseTemplateFormPayload) => {
    setError(null);
    const validated = recurringExpenseTemplateFormSchema.safeParse(payload);
    if (!validated.success) {
      setError("Template payload failed validation.");
      return;
    }

    const { data, error: insertError } = await supabase.rpc("erp_recurring_expense_template_upsert", {
      p_id: null,
      p_name: payload.name,
      p_category_id: payload.category_id,
      p_amount: payload.amount,
      p_currency: payload.currency,
      p_channel_id: payload.channel_id,
      p_warehouse_id: payload.warehouse_id,
      p_vendor_id: payload.vendor_id,
      p_payee_name: payload.payee_name,
      p_reference: payload.reference,
      p_description: payload.description,
      p_day_of_month: payload.day_of_month,
      p_recurrence: payload.recurrence,
      p_start_month: payload.start_month,
      p_end_month: payload.end_month,
      p_is_active: payload.is_active,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const parsed = z.string().uuid().safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse created template id.");
      return;
    }

    await router.push("/erp/finance/expenses/recurring");
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading recurring template form…</div>
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
          title="New Recurring Template"
          description="Set up a recurring expense template."
          rightActions={
            <Link href="/erp/finance/expenses/recurring" style={secondaryButtonStyle}>
              Back to Templates
            </Link>
          }
        />
        <RecurringTemplateForm
          categories={categories}
          channels={channels}
          warehouses={warehouses}
          vendors={vendors}
          canWrite={canWrite}
          submitLabel="Save Template"
          onSubmit={handleSubmit}
          error={error}
          initialValues={{
            name: "",
            currency: "INR",
            amount: 0,
            day_of_month: 1,
            recurrence: "monthly",
            start_month: currentMonthStart(),
            is_active: true,
          }}
        />
      </div>
    </>
  );
}
