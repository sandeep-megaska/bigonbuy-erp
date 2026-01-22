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
  discount_percent: number;
  tax_percent: number;
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

const lineWrapStyle = {
  overflowX: "auto" as const,
};

const lineInnerStyle = {
  minWidth: 1180,
};

const lineGridStyle = {
  display: "grid",
  gridTemplateColumns: "140px 160px 1fr 1fr 1fr 90px 110px 110px 110px 90px",
  gap: 8,
  alignItems: "end",
  width: "100%",
  minWidth: 0,
};

const lineCellStyle = {
  minWidth: 0,
};

const lineInputStyle = {
  ...inputStyle,
  width: "100%",
  boxSizing: "border-box" as const,
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
  flexDirection: "column" as const,
  alignItems: "flex-end",
  gap: 8,
  fontSize: 14,
  color: "#111827",
};

const totalsGridStyle = {
  display: "grid",
  gridTemplateColumns: "auto auto",
  gap: "6px 24px",
  alignItems: "center",
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
  discount_percent: 0,
  tax_percent: 0,
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

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState(
    initialValues.place_of_supply_state_code ?? ""
  );
  const [placeOfSupplyStateName, setPlaceOfSupplyStateName] = useState(
    initialValues.place_of_supply_state_name ?? ""
  );
  const [currency, setCurrency] = useState(initialValues.currency ?? "INR");

  const [billingAddressLine1, setBillingAddressLine1] = useState(initialValues.billing_address_line1 ?? "");
  const [billingAddressLine2, setBillingAddressLine2] = useState(initialValues.billing_address_line2 ?? "");
  const [billingCity, setBillingCity] = useState(initialValues.billing_city ?? "");
  const [billingState, setBillingState] = useState(initialValues.billing_state ?? "");
  const [billingStateCode, setBillingStateCode] = useState(initialValues.billing_state_code ?? "");
  const [billingStateName, setBillingStateName] = useState(initialValues.billing_state_name ?? "");
  const [billingPincode, setBillingPincode] = useState(initialValues.billing_pincode ?? "");
  const [billingCountry, setBillingCountry] = useState(initialValues.billing_country ?? "");

  const [shippingAddressLine1, setShippingAddressLine1] = useState(initialValues.shipping_address_line1 ?? "");
  const [shippingAddressLine2, setShippingAddressLine2] = useState(initialValues.shipping_address_line2 ?? "");
  const [shippingCity, setShippingCity] = useState(initialValues.shipping_city ?? "");
  const [shippingState, setShippingState] = useState(initialValues.shipping_state ?? "");
  const [shippingStateCode, setShippingStateCode] = useState(initialValues.shipping_state_code ?? "");
  const [shippingStateName, setShippingStateName] = useState(initialValues.shipping_state_name ?? "");
  const [shippingPincode, setShippingPincode] = useState(initialValues.shipping_pincode ?? "");
  const [shippingCountry, setShippingCountry] = useState(initialValues.shipping_country ?? "");

  const [lines, setLines] = useState<InvoiceLineState[]>(initialValues.lines ?? [emptyLine()]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [stateOptions, setStateOptions] = useState<{ code: string; name: string }[]>([]);
  const [companyGstStateCode, setCompanyGstStateCode] = useState("");

  const isReadOnly = readOnly || !canWrite;

  useEffect(() => {
    setInvoiceDate(initialValues.invoice_date);
    setCustomerName(initialValues.customer_name ?? "");
    setCustomerGstin(initialValues.customer_gstin ?? "");
    setPlaceOfSupply(initialValues.place_of_supply ?? "");
    setPlaceOfSupplyStateCode(initialValues.place_of_supply_state_code ?? "");
    setPlaceOfSupplyStateName(initialValues.place_of_supply_state_name ?? "");
    setCurrency(initialValues.currency ?? "INR");
    setBillingAddressLine1(initialValues.billing_address_line1 ?? "");
    setBillingAddressLine2(initialValues.billing_address_line2 ?? "");
    setBillingCity(initialValues.billing_city ?? "");
    setBillingState(initialValues.billing_state ?? "");
    setBillingStateCode(initialValues.billing_state_code ?? "");
    setBillingStateName(initialValues.billing_state_name ?? "");
    setBillingPincode(initialValues.billing_pincode ?? "");
    setBillingCountry(initialValues.billing_country ?? "");
    setShippingAddressLine1(initialValues.shipping_address_line1 ?? "");
    setShippingAddressLine2(initialValues.shipping_address_line2 ?? "");
    setShippingCity(initialValues.shipping_city ?? "");
    setShippingState(initialValues.shipping_state ?? "");
    setShippingStateCode(initialValues.shipping_state_code ?? "");
    setShippingStateName(initialValues.shipping_state_name ?? "");
    setShippingPincode(initialValues.shipping_pincode ?? "");
    setShippingCountry(initialValues.shipping_country ?? "");
    setLines(initialValues.lines && initialValues.lines.length > 0 ? initialValues.lines : [emptyLine()]);
  }, [initialValues]);

  useEffect(() => {
    let active = true;

    (async () => {
      const { supabase } = await import("../../lib/supabaseClient");
      const [{ data: stateData, error: stateError }, { data: gstData }] = await Promise.all([
        supabase.rpc("erp_ref_india_states_list"),
        supabase.rpc("erp_company_gst_profile"),
      ]);

      if (!active || stateError) return;
      setStateOptions((stateData ?? []) as { code: string; name: string }[]);
      const gstStateCode = (gstData as { gst_state_code?: string } | null)?.gst_state_code ?? "";
      setCompanyGstStateCode(gstStateCode);
    })();

    return () => {
      active = false;
    };
  }, []);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const qty = ensureNumber(line.qty);
        const unitRate = ensureNumber(line.unit_rate);
        const discountPercent = ensureNumber(line.discount_percent);
        const taxPercent = ensureNumber(line.tax_percent);
        const subtotal = qty * unitRate;
        const discount = subtotal * (discountPercent / 100);
        const taxable = subtotal - discount;
        const tax = taxable * (taxPercent / 100);
        const hasGstState = Boolean(placeOfSupplyStateCode && companyGstStateCode);
        const isInterState = hasGstState && placeOfSupplyStateCode !== companyGstStateCode;
        const igst = hasGstState && isInterState ? tax : 0;
        const cgst = hasGstState && !isInterState ? round2(tax / 2) : 0;
        const sgst = hasGstState && !isInterState ? round2(tax - cgst) : 0;
        return {
          subtotal: acc.subtotal + taxable,
          tax_total: acc.tax_total + tax,
          cgst_total: acc.cgst_total + cgst,
          sgst_total: acc.sgst_total + sgst,
          igst_total: acc.igst_total + igst,
          total: acc.total + taxable + tax,
        };
      },
      { subtotal: 0, tax_total: 0, cgst_total: 0, sgst_total: 0, igst_total: 0, total: 0 }
    );
  }, [lines, placeOfSupplyStateCode, companyGstStateCode]);

  const roundedTotals = {
    subtotal: round2(totals.subtotal),
    tax_total: round2(totals.tax_total),
    cgst_total: round2(totals.cgst_total),
    sgst_total: round2(totals.sgst_total),
    igst_total: round2(totals.igst_total),
    total: round2(totals.total),
  };

  const supplyTypeLabel = !placeOfSupplyStateCode
    ? "—"
    : companyGstStateCode
      ? placeOfSupplyStateCode !== companyGstStateCode
        ? "Inter-state (IGST)"
        : "Intra-state (CGST + SGST)"
      : "—";

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

    if (!placeOfSupplyStateCode.trim()) {
      setLocalError("Please select the place of supply.");
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
      discount_percent: ensureNumber(line.discount_percent),
      tax_percent: ensureNumber(line.tax_percent),
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
      place_of_supply:
        placeOfSupply.trim() ||
        (placeOfSupplyStateName ? `${placeOfSupplyStateName} (${placeOfSupplyStateCode})` : placeOfSupplyStateCode),
      place_of_supply_state_code: placeOfSupplyStateCode || null,
      place_of_supply_state_name: placeOfSupplyStateName || null,
      currency,
      billing_address_line1: billingAddressLine1.trim() || null,
      billing_address_line2: billingAddressLine2.trim() || null,
      billing_city: billingCity.trim() || null,
      billing_state: billingState.trim() || null,
      billing_state_code: billingStateCode || null,
      billing_state_name: billingStateName || null,
      billing_pincode: billingPincode.trim() || null,
      billing_country: billingCountry.trim() || null,
      shipping_address_line1: shippingAddressLine1.trim() || null,
      shipping_address_line2: shippingAddressLine2.trim() || null,
      shipping_city: shippingCity.trim() || null,
      shipping_state: shippingState.trim() || null,
      shipping_state_code: shippingStateCode || null,
      shipping_state_name: shippingStateName || null,
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
            <select
              value={placeOfSupplyStateCode}
              onChange={(event) => {
                const selected = stateOptions.find((option) => option.code === event.target.value);
                setPlaceOfSupplyStateCode(event.target.value);
                setPlaceOfSupplyStateName(selected?.name ?? "");
                setPlaceOfSupply(selected?.name ?? "");
              }}
              disabled={isReadOnly}
              style={inputStyle}
              required
            >
              <option value="">Select state</option>
              {stateOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.code})
                </option>
              ))}
            </select>
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
              <select
                value={billingStateCode}
                onChange={(event) => {
                  const selected = stateOptions.find((option) => option.code === event.target.value);
                  setBillingStateCode(event.target.value);
                  setBillingStateName(selected?.name ?? "");
                  setBillingState(selected?.name ?? "");
                }}
                disabled={isReadOnly}
                style={inputStyle}
              >
                <option value="">Select state</option>
                {stateOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name} ({option.code})
                  </option>
                ))}
              </select>
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
              <select
                value={shippingStateCode}
                onChange={(event) => {
                  const selected = stateOptions.find((option) => option.code === event.target.value);
                  setShippingStateCode(event.target.value);
                  setShippingStateName(selected?.name ?? "");
                  setShippingState(selected?.name ?? "");
                }}
                disabled={isReadOnly}
                style={inputStyle}
              >
                <option value="">Select state</option>
                {stateOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name} ({option.code})
                  </option>
                ))}
              </select>
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
          <div style={lineWrapStyle}>
            <div style={lineInnerStyle}>
              <div style={{ ...lineGridStyle, ...lineHeaderStyle }}>
                <div style={lineCellStyle}>Type</div>
                <div style={lineCellStyle}>SKU</div>
                <div style={lineCellStyle}>Description</div>
                <div style={lineCellStyle}>HSN</div>
                <div style={lineCellStyle}>Variant</div>
                <div style={lineCellStyle}>Qty</div>
                <div style={lineCellStyle}>Unit Rate</div>
                <div style={lineCellStyle}>Discount %</div>
                <div style={lineCellStyle}>Tax %</div>
                <div style={lineCellStyle}></div>
              </div>
              {lines.map((line, index) => (
                <div key={line.id ?? index} style={{ ...lineGridStyle, ...lineRowStyle }}>
                  <div style={lineCellStyle}>
                    <select
                      value={line.item_type}
                      onChange={(event) =>
                        handleLineChange(index, { item_type: event.target.value as "manual" | "variant" })
                      }
                      disabled={isReadOnly}
                      style={lineInputStyle}
                    >
                      <option value="manual">Manual</option>
                      <option value="variant">Variant</option>
                    </select>
                  </div>
                  <div style={lineCellStyle}>
                    <input
                      type="text"
                      value={line.sku}
                      onChange={(event) => handleLineChange(index, { sku: event.target.value })}
                      disabled={isReadOnly}
                      style={lineInputStyle}
                      placeholder="SKU"
                    />
                  </div>
                  <div style={lineCellStyle}>
                    <input
                      type="text"
                      value={line.title}
                      onChange={(event) => handleLineChange(index, { title: event.target.value })}
                      disabled={isReadOnly}
                      style={lineInputStyle}
                      placeholder="Item description"
                    />
                  </div>
                  <div style={lineCellStyle}>
                    <input
                      type="text"
                      value={line.hsn}
                      onChange={(event) => handleLineChange(index, { hsn: event.target.value })}
                      disabled={isReadOnly}
                      style={lineInputStyle}
                      placeholder="HSN"
                    />
                  </div>
                  <div style={lineCellStyle}>
                    <VariantTypeahead
                      value={line.variant}
                      onSelect={(variant) => handleVariantSelect(index, variant)}
                      disabled={isReadOnly}
                      placeholder="Search variants"
                    />
                  </div>
                  <div style={lineCellStyle}>
                    <input
                      type="number"
                      value={line.qty}
                      onChange={(event) => handleLineChange(index, { qty: Number(event.target.value) })}
                      disabled={isReadOnly}
                      style={lineInputStyle}
                      min={0}
                      step={0.001}
                    />
                  </div>
                  <div style={lineCellStyle}>
                    <input
                      type="number"
                      value={line.unit_rate}
                      onChange={(event) => handleLineChange(index, { unit_rate: Number(event.target.value) })}
                      disabled={isReadOnly}
                      style={lineInputStyle}
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div style={lineCellStyle}>
                    <input
                      type="number"
                      value={line.discount_percent}
                      onChange={(event) => handleLineChange(index, { discount_percent: Number(event.target.value) })}
                      disabled={isReadOnly}
                      style={lineInputStyle}
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div style={lineCellStyle}>
                    <input
                      type="number"
                      value={line.tax_percent}
                      onChange={(event) => handleLineChange(index, { tax_percent: Number(event.target.value) })}
                      disabled={isReadOnly}
                      style={lineInputStyle}
                      min={0}
                      step={0.01}
                    />
                  </div>
                  <div style={lineCellStyle}>
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
            </div>
          </div>

          {!isReadOnly ? (
            <button type="button" onClick={handleAddLine} style={secondaryButtonStyle}>
              Add Line
            </button>
          ) : null}
        </div>

        <div style={totalsRowStyle}>
          <div style={{ fontSize: 12, color: "#64748b" }}>GST Summary</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Supply Type: {supplyTypeLabel}</div>
          <div style={totalsGridStyle}>
            <span>Taxable</span>
            <span>{formatMoney(roundedTotals.subtotal, currency)}</span>
            <span>CGST</span>
            <span>{formatMoney(roundedTotals.cgst_total, currency)}</span>
            <span>SGST</span>
            <span>{formatMoney(roundedTotals.sgst_total, currency)}</span>
            <span>IGST</span>
            <span>{formatMoney(roundedTotals.igst_total, currency)}</span>
            <span>Total GST</span>
            <span>{formatMoney(roundedTotals.tax_total, currency)}</span>
            <span style={{ fontWeight: 600 }}>Grand Total</span>
            <span style={{ fontWeight: 600 }}>{formatMoney(roundedTotals.total, currency)}</span>
          </div>
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
