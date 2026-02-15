import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { pageContainerStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import ExpenseForm from "../../../../components/finance/ExpenseForm";
import { expenseCategorySchema, type ExpenseCategory, type ExpenseFormPayload } from "../../../../lib/erp/expenses";
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

type LinkOption = {
  id: string;
  label: string;
};

const optionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const grnOptionSchema = z.object({
  id: z.string().uuid(),
  grn_no: z.string().nullable(),
  received_at: z.string().nullable(),
  status: z.string(),
});

const transferOptionSchema = z.object({
  id: z.string().uuid(),
  reference: z.string().nullable(),
  transfer_date: z.string(),
  status: z.string(),
});

const today = () => new Date().toISOString().slice(0, 10);

export default function ExpenseCreatePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [grns, setGrns] = useState<LinkOption[]>([]);
  const [transfers, setTransfers] = useState<LinkOption[]>([]);

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
    const [
      { data: categoryData, error: categoryError },
      { data: channelData, error: channelError },
      { data: warehouseData, error: warehouseError },
      { data: vendorData, error: vendorError },
      { data: grnData, error: grnError },
      { data: transferData, error: transferError },
    ] = await Promise.all([
      supabase.rpc("erp_expense_categories_list"),
      supabase.from("erp_sales_channels").select("id, name").eq("company_id", companyId).order("name"),
      supabase.from("erp_warehouses").select("id, name").eq("company_id", companyId).order("name"),
      supabase.from("erp_vendors").select("id, legal_name").eq("company_id", companyId).order("legal_name"),
      supabase
        .from("erp_grns")
        .select("id, grn_no, received_at, status")
        .eq("company_id", companyId)
        .order("received_at", { ascending: false }),
      supabase
        .from("erp_stock_transfers")
        .select("id, reference, transfer_date, status")
        .eq("company_id", companyId)
        .order("transfer_date", { ascending: false }),
    ]);

    if (categoryError || channelError || warehouseError || vendorError || grnError || transferError) {
      setError(
        categoryError?.message ||
          channelError?.message ||
          warehouseError?.message ||
          vendorError?.message ||
          grnError?.message ||
          transferError?.message ||
          "Failed to load lookup data."
      );
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

    const parsedGrns = grnOptionSchema.array().safeParse(grnData);
    const parsedTransfers = transferOptionSchema.array().safeParse(transferData);

    if (
      !categoryParse.success ||
      !parsedChannels.success ||
      !parsedWarehouses.success ||
      !parsedVendors.success ||
      !parsedGrns.success ||
      !parsedTransfers.success
    ) {
      setError("Failed to parse lookup data.");
      return;
    }

    setCategories(categoryParse.data);
    setChannels(parsedChannels.data);
    setWarehouses(parsedWarehouses.data);
    setVendors(parsedVendors.data.map((vendor) => ({ id: vendor.id, name: vendor.legal_name })));
    setGrns(
      parsedGrns.data.map((grn) => ({
        id: grn.id,
        label: `${grn.grn_no || grn.id} • ${grn.received_at ? new Date(grn.received_at).toLocaleDateString() : "—"} • ${
          grn.status
        }`,
      }))
    );
    setTransfers(
      parsedTransfers.data.map((transfer) => ({
        id: transfer.id,
        label: `${transfer.reference || transfer.id} • ${transfer.transfer_date} • ${transfer.status}`,
      }))
    );
  };

  const handleSubmit = async (payload: ExpenseFormPayload) => {
    setError(null);
    const { data, error: insertError } = await supabase.rpc("erp_expense_upsert", {
      p_id: null,
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

    if (insertError) {
      setError(insertError.message);
      return;
    }

    const parsed = z.string().uuid().safeParse(data);
    if (!parsed.success) {
      setError("Failed to parse created expense id.");
      return;
    }

    const { error: linkError } = await supabase.rpc("erp_expense_link_update", {
      p_expense_id: parsed.data,
      p_applies_to_type: payload.applies_to_type,
      p_applies_to_id: payload.applies_to_id,
      p_is_capitalizable: payload.is_capitalizable,
      p_allocation_method: payload.allocation_method,
      p_allocation_fixed_total: payload.allocation_fixed_total,
    });

    if (linkError) {
      setError(linkError.message);
      return;
    }

    await router.push("/erp/finance/expenses");
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading expense form…</div>
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
          title="New Expense"
          description="Record a new expense entry."
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
          grnOptions={grns}
          transferOptions={transfers}
          canWrite={canWrite}
          submitLabel="Save Expense"
          onSubmit={handleSubmit}
          error={error}
          initialValues={{
            expense_date: today(),
            currency: "INR",
            amount: 0,
            is_recurring: false,
            applies_to_type: "period",
            is_capitalizable: false,
            allocation_method: "by_qty",
          }}
        />
      </div>
    </>
  );
}
