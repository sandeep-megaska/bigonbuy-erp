import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { pageContainerStyle, secondaryButtonStyle } from "../../../../../components/erp/uiStyles";
import RecurringTemplateForm from "../../../../../components/finance/RecurringTemplateForm";
import { expenseCategorySchema, type ExpenseCategory } from "../../../../../lib/erp/expenses";
import {
  recurringExpenseTemplateFormSchema,
  recurringExpenseTemplateRecordSchema,
  type RecurringExpenseTemplateFormPayload,
} from "../../../../../lib/erp/recurringExpenses";
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

export default function RecurringTemplateEditPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [initialValues, setInitialValues] = useState<RecurringExpenseTemplateFormPayload | null>(null);

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

      const templateId = typeof router.query.id === "string" ? router.query.id : null;
      if (!templateId) {
        setError("Template id not found.");
        setLoading(false);
        return;
      }

      await loadLookups(context.companyId);
      await loadTemplate(templateId);
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

  const loadTemplate = async (templateId: string) => {
    setError(null);
    const { data, error: templateError } = await supabase
      .from("erp_recurring_expense_templates")
      .select(
        "id, name, category_id, amount, currency, channel_id, warehouse_id, vendor_id, payee_name, reference, description, day_of_month, recurrence, start_month, end_month, is_active"
      )
      .eq("id", templateId)
      .single();

    if (templateError) {
      setError(templateError.message);
      return;
    }

    const parsed = recurringExpenseTemplateRecordSchema.safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse template data.");
      return;
    }

    const normalized = recurringExpenseTemplateFormSchema.safeParse({
      ...parsed.data,
      channel_id: parsed.data.channel_id ?? null,
      warehouse_id: parsed.data.warehouse_id ?? null,
      vendor_id: parsed.data.vendor_id ?? null,
      payee_name: parsed.data.payee_name ?? null,
      reference: parsed.data.reference ?? null,
      description: parsed.data.description ?? null,
      end_month: parsed.data.end_month ?? null,
    });

    if (!normalized.success) {
      setError("Template data failed validation.");
      return;
    }

    setInitialValues(normalized.data);
  };

  const handleSubmit = async (payload: RecurringExpenseTemplateFormPayload) => {
    const templateId = typeof router.query.id === "string" ? router.query.id : null;
    if (!templateId) {
      setError("Template id not found.");
      return;
    }

    setError(null);
    const { data, error: updateError } = await supabase.rpc("erp_recurring_expense_template_upsert", {
      p_id: templateId,
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

    if (updateError) {
      setError(updateError.message);
      return;
    }

    const parsed = z.string().uuid().safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse updated template id.");
      return;
    }

    await router.push("/erp/finance/expenses/recurring");
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading recurring template…</div>
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
        <div style={pageContainerStyle}>{error || "Unable to load recurring template."}</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Edit Recurring Template"
          description="Update recurring expense template settings."
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
          submitLabel="Update Template"
          onSubmit={handleSubmit}
          error={error}
          initialValues={initialValues}
        />
      </div>
    </ErpShell>
  );
}
