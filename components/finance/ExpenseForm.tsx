import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  cardStyle,
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "../erp/uiStyles";
import { expenseFormSchema, parseAmountInput, type ExpenseCategory, type ExpenseFormPayload } from "../../lib/erp/expenses";

type Option = {
  id: string;
  name: string;
};

type ExpenseFormProps = {
  categories: ExpenseCategory[];
  channels: Option[];
  warehouses: Option[];
  vendors: Option[];
  initialValues?: Partial<ExpenseFormPayload>;
  submitLabel: string;
  canWrite: boolean;
  onSubmit: (payload: ExpenseFormPayload) => Promise<void>;
  onCancel?: () => void;
  error?: string | null;
};

const fieldStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
};

const labelStyle = { fontSize: 13, color: "#4b5563" };

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

const textareaStyle = {
  ...inputStyle,
  minHeight: 90,
  resize: "vertical" as const,
};

const errorStyle = {
  ...cardStyle,
  borderColor: "#fecaca",
  backgroundColor: "#fff1f2",
  color: "#b91c1c",
};

const groupedCategories = (categories: ExpenseCategory[]) => {
  const groups = new Map<string, ExpenseCategory[]>();
  categories.forEach((cat) => {
    const key = cat.group_key || "Other";
    const current = groups.get(key) ?? [];
    current.push(cat);
    groups.set(key, current);
  });
  return Array.from(groups.entries()).map(([group, cats]) => ({
    group,
    categories: cats.sort((a, b) => a.name.localeCompare(b.name)),
  }));
};

export default function ExpenseForm({
  categories,
  channels,
  warehouses,
  vendors,
  initialValues,
  submitLabel,
  canWrite,
  onSubmit,
  onCancel,
  error,
}: ExpenseFormProps) {
  const [expenseDate, setExpenseDate] = useState(initialValues?.expense_date ?? "");
  const [amount, setAmount] = useState(initialValues?.amount?.toString() ?? "");
  const [currency, setCurrency] = useState(initialValues?.currency ?? "INR");
  const [categoryId, setCategoryId] = useState(initialValues?.category_id ?? "");
  const [channelId, setChannelId] = useState(initialValues?.channel_id ?? "");
  const [warehouseId, setWarehouseId] = useState(initialValues?.warehouse_id ?? "");
  const [vendorId, setVendorId] = useState(initialValues?.vendor_id ?? "");
  const [payeeName, setPayeeName] = useState(initialValues?.payee_name ?? "");
  const [reference, setReference] = useState(initialValues?.reference ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [isRecurring, setIsRecurring] = useState(initialValues?.is_recurring ?? false);
  const [recurringRule, setRecurringRule] = useState(initialValues?.recurring_rule ?? "");
  const [attachmentUrl, setAttachmentUrl] = useState(initialValues?.attachment_url ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (initialValues?.expense_date) setExpenseDate(initialValues.expense_date);
    if (initialValues?.amount != null) setAmount(initialValues.amount.toString());
    if (initialValues?.currency) setCurrency(initialValues.currency);
    if (initialValues?.category_id) setCategoryId(initialValues.category_id);
    if (initialValues?.channel_id) setChannelId(initialValues.channel_id);
    if (initialValues?.warehouse_id) setWarehouseId(initialValues.warehouse_id);
    if (initialValues?.vendor_id) setVendorId(initialValues.vendor_id);
    if (initialValues?.payee_name) setPayeeName(initialValues.payee_name);
    if (initialValues?.reference) setReference(initialValues.reference);
    if (initialValues?.description) setDescription(initialValues.description);
    if (initialValues?.is_recurring != null) setIsRecurring(initialValues.is_recurring);
    if (initialValues?.recurring_rule) setRecurringRule(initialValues.recurring_rule);
    if (initialValues?.attachment_url) setAttachmentUrl(initialValues.attachment_url);
  }, [initialValues]);

  useEffect(() => {
    if (categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const grouped = useMemo(() => groupedCategories(categories), [categories]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    const payload: ExpenseFormPayload = {
      expense_date: expenseDate,
      amount: parseAmountInput(amount),
      currency,
      category_id: categoryId,
      channel_id: channelId || null,
      warehouse_id: warehouseId || null,
      vendor_id: vendorId || null,
      payee_name: vendorId ? null : (payeeName || null),
      reference: reference || null,
      description: description || null,
      is_recurring: Boolean(isRecurring),
      recurring_rule: isRecurring ? recurringRule || null : null,
      attachment_url: attachmentUrl || null,
    };

    const parsed = expenseFormSchema.safeParse(payload);
    if (!parsed.success) {
      setLocalError("Please fill all required fields with valid values.");
      return;
    }

    await onSubmit(parsed.data);
  };

  const displayError = localError || error;

  return (
    <div style={cardStyle}>
      {displayError ? <div style={errorStyle}>{displayError}</div> : null}
      <form onSubmit={handleSubmit} style={formGridStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Date</span>
          <input
            type="date"
            value={expenseDate}
            onChange={(event) => setExpenseDate(event.target.value)}
            disabled={!canWrite}
            style={inputStyle}
            required
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Amount</span>
          <input
            type="text"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={!canWrite}
            style={inputStyle}
            placeholder="0.00"
            required
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Currency</span>
          <input
            type="text"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            disabled={!canWrite}
            style={inputStyle}
            required
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Category</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            disabled={!canWrite || categories.length === 0}
            style={inputStyle}
            required
          >
            {grouped.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Channel (optional)</span>
          <select
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            disabled={!canWrite}
            style={inputStyle}
          >
            <option value="">Unassigned</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Warehouse (optional)</span>
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            disabled={!canWrite}
            style={inputStyle}
          >
            <option value="">Unassigned</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Vendor (optional)</span>
          <select
            value={vendorId}
            onChange={(event) => setVendorId(event.target.value)}
            disabled={!canWrite}
            style={inputStyle}
          >
            <option value="">No vendor selected</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Payee name</span>
          <input
            type="text"
            value={payeeName}
            onChange={(event) => setPayeeName(event.target.value)}
            disabled={!canWrite || Boolean(vendorId)}
            style={inputStyle}
            placeholder="Payee if no vendor selected"
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Reference</span>
          <input
            type="text"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            disabled={!canWrite}
            style={inputStyle}
          />
        </label>
        <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={!canWrite}
            style={textareaStyle}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Recurring</span>
          <select
            value={isRecurring ? "yes" : "no"}
            onChange={(event) => setIsRecurring(event.target.value === "yes")}
            disabled={!canWrite}
            style={inputStyle}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>Recurring Rule</span>
          <select
            value={recurringRule}
            onChange={(event) => setRecurringRule(event.target.value)}
            disabled={!canWrite || !isRecurring}
            style={inputStyle}
          >
            <option value="">Select</option>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Attachment URL</span>
          <input
            type="url"
            value={attachmentUrl}
            onChange={(event) => setAttachmentUrl(event.target.value)}
            disabled={!canWrite}
            style={inputStyle}
            placeholder="https://..."
          />
        </label>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", gridColumn: "1 / -1" }}>
          {onCancel ? (
            <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
              Cancel
            </button>
          ) : null}
          <button type="submit" disabled={!canWrite} style={primaryButtonStyle}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
