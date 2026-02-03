import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle, primaryButtonStyle, secondaryButtonStyle } from "../../../../components/erp/uiStyles";
import ExpenseForm from "../../../../components/finance/ExpenseForm";
import { expenseCategorySchema, expenseFormSchema, type ExpenseCategory, type ExpenseFormPayload } from "../../../../lib/erp/expenses";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = Awaited<ReturnType<typeof getCompanyContext>>;

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
  applies_to_type: z.string().nullable(),
  applies_to_id: z.string().uuid().nullable(),
  is_capitalizable: z.boolean(),
  allocation_method: z.string().nullable(),
  allocation_fixed_total: z.number().nullable(),
  applied_to_inventory_at: z.string().nullable(),
  applied_inventory_ref: z.string().nullable(),
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
  const [grns, setGrns] = useState<LinkOption[]>([]);
  const [transfers, setTransfers] = useState<LinkOption[]>([]);
  const [initialValues, setInitialValues] = useState<ExpenseFormPayload | null>(null);
  const [appliedAt, setAppliedAt] = useState<string | null>(null);
  const [appliedRef, setAppliedRef] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [financePost, setFinancePost] = useState<{ journalId: string | null; docNo: string | null } | null>(null);
  const [financeLink, setFinanceLink] = useState<string | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financePosting, setFinancePosting] = useState(false);
  const [financeNotice, setFinanceNotice] = useState<string | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
  );

  const isCapitalized = useMemo(() => {
    const appliesTo = initialValues?.applies_to_type ?? "";
    return Boolean(initialValues?.is_capitalizable) || ["grn", "stock_transfer"].includes(appliesTo) || Boolean(appliedAt);
  }, [initialValues?.applies_to_type, initialValues?.is_capitalizable, appliedAt]);

  const normalizeFinanceError = (message: string) => {
    const lower = message.toLowerCase();
    if (lower.includes("period") && lower.includes("lock")) return "Posting period is locked.";
    if (lower.includes("account") && lower.includes("mapping")) return "Missing expense account mapping.";
    if (lower.includes("capital") || lower.includes("inventory") || lower.includes("landed")) {
      return "This expense is capitalized / inventory-linked and must be posted via landed-cost (GRN) workflow.";
    }
    return message;
  };

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
      await loadFinancePost(id, session.access_token);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, id]);

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
    const parsedGrns = grnOptionSchema.array().safeParse(grnData);
    const parsedTransfers = transferOptionSchema.array().safeParse(transferData);

    if (
      !parsedCategories.success ||
      !parsedChannels.success ||
      !parsedWarehouses.success ||
      !parsedVendors.success ||
      !parsedGrns.success ||
      !parsedTransfers.success
    ) {
      setError("Failed to parse lookup data.");
      return;
    }

    setCategories(parsedCategories.data);
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

  const loadExpense = async (expenseId: string) => {
    setError(null);
    const { data, error: expenseError } = await supabase
      .from("erp_expenses")
      .select(
        "id, expense_date, amount, currency, category_id, channel_id, warehouse_id, vendor_id, payee_name, reference, description, is_recurring, recurring_rule, attachment_url, applies_to_type, applies_to_id, is_capitalizable, allocation_method, allocation_fixed_total, applied_to_inventory_at, applied_inventory_ref"
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
      applies_to_type: parsed.data.applies_to_type,
      applies_to_id: parsed.data.applies_to_id,
      is_capitalizable: parsed.data.is_capitalizable,
      allocation_method: parsed.data.allocation_method,
      allocation_fixed_total: parsed.data.allocation_fixed_total,
    });

    if (!normalized.success) {
      setError("Expense data failed validation.");
      return;
    }

    setInitialValues(normalized.data);
    setAppliedAt(parsed.data.applied_to_inventory_at);
    setAppliedRef(parsed.data.applied_inventory_ref);
  };

  const getAuthHeaders = (tokenOverride?: string | null) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = tokenOverride ?? ctx?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const loadFinancePost = async (expenseId: string, accessToken?: string | null) => {
    if (!accessToken && !ctx?.session?.access_token) return;
    setFinanceLoading(true);
    setFinanceError(null);
    try {
      const response = await fetch(`/api/erp/finance/expenses/${expenseId}/post`, {
        method: "GET",
        headers: getAuthHeaders(accessToken),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load finance posting.");
      }
      if (payload?.posted && payload?.journal_id) {
        setFinancePost({ journalId: payload.journal_id, docNo: payload.journal_no ?? null });
        setFinanceLink(payload.link ?? (payload.journal_id ? `/erp/finance/journals/${payload.journal_id}` : null));
      } else {
        setFinancePost(null);
        setFinanceLink(null);
      }
    } catch (postError) {
      const message = postError instanceof Error ? postError.message : "Failed to load finance posting.";
      setFinanceError(normalizeFinanceError(message));
      setFinancePost(null);
      setFinanceLink(null);
    } finally {
      setFinanceLoading(false);
    }
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

  const handleApplyToInventory = async () => {
    if (typeof id !== "string") {
      setError("Expense id not found.");
      return;
    }
    if (!window.confirm("Apply this expense to inventory? This cannot be undone.")) return;

    setError(null);
    setNotice(null);
    const { data, error: applyError } = await supabase.rpc("erp_expense_apply_to_inventory", {
      p_expense_id: id,
    });

    if (applyError) {
      setError(applyError.message);
      return;
    }

    const result = z
      .object({
        ok: z.boolean(),
        posted_lines: z.number(),
        total_allocated: z.number(),
        warnings: z.array(z.string()).optional(),
      })
      .safeParse(data);

    if (result.success) {
      const warningText = result.data.warnings?.length ? ` Warnings: ${result.data.warnings.join("; ")}` : "";
      setNotice(`Applied to inventory (${result.data.posted_lines} lines, ${result.data.total_allocated}).${warningText}`);
    } else {
      setNotice("Applied to inventory.");
    }

    await loadExpense(id);
  };

  const handleFinancePost = async () => {
    if (typeof id !== "string") {
      setFinanceError("Expense id not found.");
      return;
    }
    if (!ctx?.session?.access_token) return;
    setFinancePosting(true);
    setFinanceError(null);
    setFinanceNotice(null);
    try {
      const response = await fetch(`/api/erp/finance/expenses/${id}/post`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ expenseId: id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to post expense journal.");
      }
      if (payload?.posted && payload?.journal_id) {
        setFinancePost({ journalId: payload.journal_id, docNo: payload.journal_no ?? null });
        setFinanceNotice(`Posted finance journal ${payload.journal_no || ""}`.trim());
        setFinanceLink(payload.link ?? (payload.journal_id ? `/erp/finance/journals/${payload.journal_id}` : null));
      } else {
        const warningMessage = isCapitalized
          ? "This expense is capitalized / inventory-linked and must be posted via landed-cost (GRN) workflow."
          : "No finance journal was created.";
        setFinanceError(warningMessage);
      }
    } catch (postError) {
      const message = postError instanceof Error ? postError.message : "Failed to post expense journal.";
      setFinanceError(normalizeFinanceError(message));
    } finally {
      setFinancePosting(false);
    }
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
        {notice ? <div style={{ color: "#047857", marginBottom: 12 }}>{notice}</div> : null}
        {financeNotice ? <div style={{ color: "#047857", marginBottom: 12 }}>{financeNotice}</div> : null}
        {financeError ? <div style={{ color: "#b91c1c", marginBottom: 12 }}>{financeError}</div> : null}
        {appliedAt ? (
          <div style={{ color: "#4b5563", marginBottom: 12 }}>
            Applied to inventory at {new Date(appliedAt).toLocaleString()} ({appliedRef || "no ref"}).
          </div>
        ) : null}
        <ExpenseForm
          categories={categories}
          channels={channels}
          warehouses={warehouses}
          vendors={vendors}
          grnOptions={grns}
          transferOptions={transfers}
          canWrite={canWrite}
          submitLabel="Save Changes"
          onSubmit={handleSubmit}
          error={error}
          initialValues={initialValues}
        />
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Finance posting</div>
              {financeLoading ? (
                <div style={{ color: "#6b7280" }}>Loading posting status…</div>
              ) : financePost ? (
                <div style={{ fontWeight: 600 }}>
                  Posted to journal {financePost.docNo || financePost.journalId}
                  {financeLink ? (
                    <Link href={financeLink} style={{ marginLeft: 8, fontSize: 13, color: "#2563eb" }}>
                      View journal
                    </Link>
                  ) : null}
                </div>
              ) : (
                <div style={{ color: "#6b7280" }}>
                  Not posted yet.
                  {isCapitalized ? (
                    <div style={{ marginTop: 6, color: "#b45309" }}>
                      This expense is capitalized / inventory-linked and must be posted via landed-cost (GRN) workflow.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleFinancePost}
              disabled={!canWrite || financePosting || Boolean(financePost)}
              style={{
                ...primaryButtonStyle,
                opacity: !canWrite || financePosting || Boolean(financePost) ? 0.6 : 1,
                cursor: !canWrite || financePosting || Boolean(financePost) ? "not-allowed" : "pointer",
              }}
            >
              {financePosting ? "Posting…" : financePost ? "Posted" : "Post to Finance"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            onClick={handleApplyToInventory}
            disabled={
              !canWrite ||
              Boolean(appliedAt) ||
              !initialValues?.is_capitalizable ||
              !["grn", "stock_transfer"].includes(initialValues?.applies_to_type ?? "")
            }
            style={{
              ...secondaryButtonStyle,
              opacity:
                !canWrite ||
                Boolean(appliedAt) ||
                !initialValues?.is_capitalizable ||
                !["grn", "stock_transfer"].includes(initialValues?.applies_to_type ?? "")
                  ? 0.6
                  : 1,
              cursor:
                !canWrite ||
                Boolean(appliedAt) ||
                !initialValues?.is_capitalizable ||
                !["grn", "stock_transfer"].includes(initialValues?.applies_to_type ?? "")
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            Apply to Inventory
          </button>
        </div>
      </div>
    </ErpShell>
  );
}
