import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import VariantTypeahead, { type VariantSearchResult } from "../inventory/VariantTypeahead";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "../erp/uiStyles";
import { ensureNumber, type InvoiceFormPayload } from "../../lib/erp/invoices";

type InvoiceLineState = {
  id?: string;
  line_no?: number;
  item_type: "manual" | "variant";
  variant: VariantSearchResult | null;
  variant_id: string | null;
  sku: string;
  title: string;
  hsn: string;
  qty: number;
  unit_rate: number;
  tax_rate: number;
};

type InvoiceFormValues = Omit<InvoiceFormPayload, "lines"> & {
  lines: InvoiceLineState[];
};

type InvoiceFormProps = {
  initialValues: InvoiceFormValues;
  submitLabel: string;
  canWrite: boolean;
  readOnly?: boolean;
  error?: string | null;
  onSubmit: (payload: InvoiceFormPayload) => Promise<void>;
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

const sectionTitleStyle = {
  margin: "8px 0 0",
  fontSize: 16,
  color: "#111827",
};

const lineGridStyle = {
  display: "grid",
  gridTemplateColumns: "160px 180px 1fr 1fr 1fr 120px 120px 120px 80px",
  gap: 10,
  alignItems: "center",
};

const lineHeaderStyle = {
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const lineRowStyle = {
  padding: "10px 0",
  borderBottom: "1px solid #e5e7eb",
};

const totalsRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 32,
  fontSize: 14,
  color: "#111827",
};

const errorStyle = {
  ...cardStyle,
  borderColor: "#fecaca",
  backgroundColor: "#fff1f2",
  color: "#b91c1c",
};

const badgeMutedStyle = {
  ...badgeStyle,
  backgroundColor: "#f1f5f9",
  color: "#0f172a",
};

const emptyLine = (lineNo = 1): InvoiceLineState => ({
  item_type: "manual",
  variant: null,
  variant_id: null,
  sku: "",
  title: "",
  hsn: "",
  qty: 1,
  unit_rate: 0,
  tax_rate: 0,
  line_no: lineNo,
});

const formatMoney = (value: number, currency: string) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export default function InvoiceForm({
  initialValues,
  submitLabel,
  canWrite,
  readOnly,
  error,
  onSubmit,
}: InvoiceFormProps) {
  const [invoiceDate, setInvoiceDate] = useState(initialValues.invoice_date);
  const [customerName, setCustomerName] = useState(initialValues.customer_name ?? "");
  const [customerGstin, setCustomerGstin] = useState(initialValues.customer_gstin ?? "");
  const [placeOfSupply, setPlaceOfSupply] = useState(initialValues.place_of_supply ?? "");
  const [currency, setCurrency] = useState(initialValues.currency ?? "INR");

  const [billingAddressLine1, setBillingAddressLine1] = useState(initialValues.billing_address_line1 ?? "");
  const [billingAddressLine2, setBillingAddressLine2] = useState(initialValues.billing_address_line2 ?? "");
  const [billingCity, setBillingCity] = useState(initialValues.billing_city ?? "");
  const [billingState, setBillingState] = useState(initialValues.billing_state ?? "");
  const [billingPincode, setBillingPincode] = useState(initialValues.billing_pincode ?? "");
  const [billingCountry, setBillingCountry] = useState(initialValues.billing_country ?? "");

  const [shippingAddressLine1, setShippingAddressLine1] = useState(initialValues.shipping_address_line1 ?? "");
  const [shippingAddressLine2, setShippingAddressLine2] = useState(initialValues.shipping_address_line2 ?? "");
  const [shippingCity, setShippingCity] = useState(initialValues.shipping_city ?? "");
  const [shippingState, setShippingState] = useState(initialValues.shipping_state ?? "");
  const [shippingPincode, setShippingPincode] = useState(initialValues.shipping_pincode ?? "");
  const [shippingCountry, setShippingCountry] = useState(initialValues.shipping_country ?? "");

  const [lines, setLines] = useState<InvoiceLineState[]>(initialValues.lines ?? [emptyLine()]);
  const [localError, setLocalError] = useState<string | null>(null);

  const isReadOnly = readOnly || !canWrite;

  useEffect(() => {
    setInvoiceDate(initialValues.invoice_date);
    setCustomerName(initialValues.customer_name ?? "");
    setCustomerGstin(initialValues.customer_gstin ?? "");
    setPlaceOfSupply(initialValues.place_of_supply ?? "");
    setCurrency(initialValues.currency ?? "INR");
    setBillingAddressLine1(initialValues.billing_address_line1 ?? "");
    setBillingAddressLine2(initialValues.billing_address_line2 ?? "");
    setBillingCity(initialValues.billing_city ?? "");
    setBillingState(initialValues.billing_state ?? "");
    setBillingPincode(initialValues.billing_pincode ?? "");
    setBillingCountry(initialValues.billing_country ?? "");
    setShippingAddressLine1(initialValues.shipping_address_line1 ?? "");
    setShippingAddressLine2(initialValues.shipping_address_line2 ?? "");
    setShippingCity(initialValues.shipping_city ?? "");
    setShippingState(initialValues.shipping_state ?? "");
    setShippingPincode(initialValues.shipping_pincode ?? "");
    setShippingCountry(initialValues.shipping_country ?? "");
    setLines(initialValues.lines && initialValues.lines.length > 0 ? initialValues.lines : [emptyLine()]);
  }, [initialValues]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const qty = ensureNumber(line.qty);
        const unitRate = ensureNumber(line.unit_rate);
        const taxRate = ensureNumber(line.tax_rate);
        const subtotal = qty * unitRate;
        const tax = subtotal * (taxRate / 100);
        return {
          subtotal: acc.subtotal + subtotal,
          tax_total: acc.tax_total + tax,
          total: acc.total + subtotal + tax,
        };
      },
      { subtotal: 0, tax_total: 0, total: 0 }
    );
  }, [lines]);

  const handleLineChange = (index: number, updates: Partial<InvoiceLineState>) => {
    setLines((prev) => prev.map((line, idx) => (idx === index ? { ...line, ...updates } : line)));
  };

  const handleVariantSelect = (index: number, variant: VariantSearchResult | null) => {
    if (!variant) {
      handleLineChange(index, {
        variant: null,
        variant_id: null,
      });
      return;
    }

    handleLineChange(index, {
      item_type: "variant",
      variant,
      variant_id: variant.variant_id,
      sku: variant.sku || "",
      title: variant.title || "",
      hsn: variant.hsn_code || "",
    });
  };

  const handleAddLine = () => {
    setLines((prev) => [...prev, emptyLine(prev.length + 1)]);
  };

  const handleRemoveLine = (index: number) => {
    setLines((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    if (!customerName.trim()) {
      setLocalError("Please provide the customer name.");
      return;
    }

    if (!placeOfSupply.trim()) {
      setLocalError("Please provide the place of supply.");
      return;
    }

    const sanitizedLines = lines.map((line, index) => ({
      id: line.id ?? null,
      line_no: line.line_no ?? index + 1,
      item_type: line.item_type,
      variant_id: line.variant_id,
      sku: line.sku.trim(),
      title: line.title.trim(),
      hsn: line.hsn.trim(),
      qty: ensureNumber(line.qty),
      unit_rate: ensureNumber(line.unit_rate),
      tax_rate: ensureNumber(line.tax_rate),
    }));

    const hasMeaningfulLine = sanitizedLines.some((line) => line.qty > 0 || line.unit_rate > 0 || line.title);
    if (!hasMeaningfulLine) {
      setLocalError("Please add at least one line item.");
      return;
    }

    const payload: InvoiceFormPayload = {
      invoice_date: invoiceDate,
      customer_name: customerName.trim(),
      customer_gstin: customerGstin.trim() || null,
      place_of_supply: placeOfSupply.trim(),
      currency,
      billing_address_line1: billingAddressLine1.trim() || null,
      billing_address_line2: billingAddressLine2.trim() || null,
      billing_city: billingCity.trim() || null,
      billing_state: billingState.trim() || null,
      billing_pincode: billingPincode.trim() || null,
      billing_country: billingCountry.trim() || null,
      shipping_address_line1: shippingAddressLine1.trim() || null,
      shipping_address_line2: shippingAddressLine2.trim() || null,
      shipping_city: shippingCity.trim() || null,
      shipping_state: shippingState.trim() || null,
      shipping_pincode: shippingPincode.trim() || null,
      shipping_country: shippingCountry.trim() || null,
      lines: sanitizedLines,
    };

    await onSubmit(payload);
  };

  const displayError = localError || error;

  return (
    <div style={cardStyle}>
      {displayError ? <div style={errorStyle}>{displayError}</div> : null}
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Invoice Date</span>
            <input
              type="date"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
              disabled={isReadOnly}
              style={inputStyle}
              required
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Customer Name</span>
            <input
              type="text"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              disabled={isReadOnly}
              style={inputStyle}
              required
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Customer GSTIN</span>
            <input
              type="text"
              value={customerGstin}
              onChange={(event) => setCustomerGstin(event.target.value)}
              disabled={isReadOnly}
              style={inputStyle}
              placeholder="Optional"
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Place of Supply</span>
            <input
              type="text"
              value={placeOfSupply}
              onChange={(event) => setPlaceOfSupply(event.target.value)}
              disabled={isReadOnly}
              style={inputStyle}
              required
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Currency</span>
            <input
              type="text"
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              disabled={isReadOnly}
              style={inputStyle}
              required
            />
          </label>
        </div>

        <div>
          <h3 style={sectionTitleStyle}>Billing Address</h3>
          <div style={formGridStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Address Line 1</span>
              <input
                type="text"
                value={billingAddressLine1}
                onChange={(event) => setBillingAddressLine1(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Address Line 2</span>
              <input
                type="text"
                value={billingAddressLine2}
                onChange={(event) => setBillingAddressLine2(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>City</span>
              <input
                type="text"
                value={billingCity}
                onChange={(event) => setBillingCity(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>State</span>
              <input
                type="text"
                value={billingState}
                onChange={(event) => setBillingState(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Pincode</span>
              <input
                type="text"
                value={billingPincode}
                onChange={(event) => setBillingPincode(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Country</span>
              <input
                type="text"
                value={billingCountry}
                onChange={(event) => setBillingCountry(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div>
          <h3 style={sectionTitleStyle}>Shipping Address</h3>
          <div style={formGridStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Address Line 1</span>
              <input
                type="text"
                value={shippingAddressLine1}
                onChange={(event) => setShippingAddressLine1(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Address Line 2</span>
              <input
                type="text"
                value={shippingAddressLine2}
                onChange={(event) => setShippingAddressLine2(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>City</span>
              <input
                type="text"
                value={shippingCity}
                onChange={(event) => setShippingCity(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>State</span>
              <input
                type="text"
                value={shippingState}
                onChange={(event) => setShippingState(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Pincode</span>
              <input
                type="text"
                value={shippingPincode}
                onChange={(event) => setShippingPincode(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Country</span>
              <input
                type="text"
                value={shippingCountry}
                onChange={(event) => setShippingCountry(event.target.value)}
                disabled={isReadOnly}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div>
          <h3 style={sectionTitleStyle}>Line Items</h3>
          <div style={{ ...lineGridStyle, ...lineHeaderStyle }}>
            <div>Type</div>
            <div>SKU</div>
            <div>Description</div>
            <div>HSN</div>
            <div>Variant</div>
            <div>Qty</div>
            <div>Unit Rate</div>
            <div>Tax %</div>
            <div></div>
          </div>
          {lines.map((line, index) => (
            <div key={line.id ?? index} style={{ ...lineGridStyle, ...lineRowStyle }}>
              <select
                value={line.item_type}
                onChange={(event) => handleLineChange(index, { item_type: event.target.value as "manual" | "variant" })}
                disabled={isReadOnly}
                style={inputStyle}
              >
                <option value="manual">Manual</option>
                <option value="variant">Variant</option>
              </select>
              <input
                type="text"
                value={line.sku}
                onChange={(event) => handleLineChange(index, { sku: event.target.value })}
                disabled={isReadOnly}
                style={inputStyle}
                placeholder="SKU"
              />
              <input
                type="text"
                value={line.title}
                onChange={(event) => handleLineChange(index, { title: event.target.value })}
                disabled={isReadOnly}
                style={inputStyle}
                placeholder="Item description"
              />
              <input
                type="text"
                value={line.hsn}
                onChange={(event) => handleLineChange(index, { hsn: event.target.value })}
                disabled={isReadOnly}
                style={inputStyle}
                placeholder="HSN"
              />
              <div>
                <VariantTypeahead
                  value={line.variant}
                  onSelect={(variant) => handleVariantSelect(index, variant)}
                  disabled={isReadOnly}
                  placeholder="Search variants"
                />
              </div>
              <input
                type="number"
                value={line.qty}
                onChange={(event) => handleLineChange(index, { qty: Number(event.target.value) })}
                disabled={isReadOnly}
                style={inputStyle}
                min={0}
                step={1}
              />
              <input
                type="number"
                value={line.unit_rate}
                onChange={(event) => handleLineChange(index, { unit_rate: Number(event.target.value) })}
                disabled={isReadOnly}
                style={inputStyle}
                min={0}
                step={0.01}
              />
              <input
                type="number"
                value={line.tax_rate}
                onChange={(event) => handleLineChange(index, { tax_rate: Number(event.target.value) })}
                disabled={isReadOnly}
                style={inputStyle}
                min={0}
                step={0.01}
              />
              <div>
                {!isReadOnly && !line.id ? (
                  <button
                    type="button"
                    onClick={() => handleRemoveLine(index)}
                    style={{ ...secondaryButtonStyle, padding: "6px 10px" }}
                  >
                    Remove
                  </button>
                ) : (
                  <span style={badgeMutedStyle}>{line.id ? "Saved" : "Draft"}</span>
                )}
              </div>
            </div>
          ))}

          {!isReadOnly ? (
            <button type="button" onClick={handleAddLine} style={secondaryButtonStyle}>
              Add Line
            </button>
          ) : null}
        </div>

        <div style={totalsRowStyle}>
          <div>Subtotal: {formatMoney(totals.subtotal, currency)}</div>
          <div>Tax: {formatMoney(totals.tax_total, currency)}</div>
          <div>Total: {formatMoney(totals.total, currency)}</div>
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button type="submit" style={primaryButtonStyle} disabled={isReadOnly}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
