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
import { ensureNumber, type NoteFormPayload } from "../../lib/erp/notes";

type Option = {
  id: string;
  name: string;
};

type NoteLineState = {
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

type NoteFormValues = Omit<NoteFormPayload, "lines"> & {
  lines: NoteLineState[];
};

type NoteFormProps = {
  vendors: Option[];
  initialValues: NoteFormValues;
  submitLabel: string;
  canWrite: boolean;
  readOnly?: boolean;
  error?: string | null;
  onSubmit: (payload: NoteFormPayload) => Promise<void>;
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

const emptyLine = (): NoteLineState => ({
  item_type: "manual",
  variant: null,
  variant_id: null,
  sku: "",
  title: "",
  hsn: "",
  qty: 1,
  unit_rate: 0,
  tax_rate: 0,
});

export default function NoteForm({
  vendors,
  initialValues,
  submitLabel,
  canWrite,
  readOnly,
  error,
  onSubmit,
}: NoteFormProps) {
  const [partyType, setPartyType] = useState(initialValues.party_type);
  const [noteKind, setNoteKind] = useState(initialValues.note_kind);
  const [noteDate, setNoteDate] = useState(initialValues.note_date);
  const [partyId, setPartyId] = useState(initialValues.party_id ?? "");
  const [partyName, setPartyName] = useState(initialValues.party_name ?? "");
  const [currency, setCurrency] = useState(initialValues.currency ?? "INR");
  const [sourceType, setSourceType] = useState(initialValues.source_type ?? "");
  const [sourceId, setSourceId] = useState(initialValues.source_id ?? "");
  const [lines, setLines] = useState<NoteLineState[]>(initialValues.lines ?? [emptyLine()]);
  const [localError, setLocalError] = useState<string | null>(null);

  const isReadOnly = readOnly || !canWrite;

  useEffect(() => {
    setPartyType(initialValues.party_type);
    setNoteKind(initialValues.note_kind);
    setNoteDate(initialValues.note_date);
    setPartyId(initialValues.party_id ?? "");
    setPartyName(initialValues.party_name ?? "");
    setCurrency(initialValues.currency ?? "INR");
    setSourceType(initialValues.source_type ?? "");
    setSourceId(initialValues.source_id ?? "");
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

  const handlePartyTypeChange = (value: string) => {
    setPartyType(value);
    setPartyId("");
    setPartyName("");
  };

  const handleVendorSelect = (value: string) => {
    setPartyId(value);
    const vendor = vendors.find((item) => item.id === value);
    setPartyName(vendor?.name ?? "");
  };

  const handleLineChange = (index: number, updates: Partial<NoteLineState>) => {
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
    setLines((prev) => [...prev, emptyLine()]);
  };

  const handleRemoveLine = (index: number) => {
    setLines((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    if (!partyType || !noteKind) {
      setLocalError("Please select the party type and note kind.");
      return;
    }

    if (!partyName.trim()) {
      setLocalError("Please provide the party name.");
      return;
    }

    if (partyType === "vendor" && !partyId) {
      setLocalError("Please select a vendor.");
      return;
    }

    const sanitizedLines = lines.map((line) => ({
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

    const payload: NoteFormPayload = {
      party_type: partyType,
      note_kind: noteKind,
      note_date: noteDate,
      party_id: partyId || null,
      party_name: partyName.trim(),
      currency,
      source_type: sourceType || null,
      source_id: sourceId || null,
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
            <span style={labelStyle}>Party Type</span>
            <select
              value={partyType}
              onChange={(event) => handlePartyTypeChange(event.target.value)}
              disabled={isReadOnly}
              style={inputStyle}
              required
            >
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Note Kind</span>
            <select value={noteKind} onChange={(event) => setNoteKind(event.target.value)} disabled={isReadOnly} style={inputStyle} required>
              <option value="credit">Credit Note</option>
              <option value="debit">Debit Note</option>
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Note Date</span>
            <input type="date" value={noteDate} onChange={(event) => setNoteDate(event.target.value)} disabled={isReadOnly} style={inputStyle} required />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Currency</span>
            <input type="text" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} disabled={isReadOnly} style={inputStyle} required />
          </label>
          {partyType === "vendor" ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>Vendor</span>
              <select value={partyId} onChange={(event) => handleVendorSelect(event.target.value)} disabled={isReadOnly} style={inputStyle} required>
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label style={fieldStyle}>
              <span style={labelStyle}>Customer Name</span>
              <input type="text" value={partyName} onChange={(event) => setPartyName(event.target.value)} disabled={isReadOnly} style={inputStyle} required />
            </label>
          )}
        </div>

        <div style={formGridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Source Type</span>
            <input type="text" value={sourceType} disabled style={inputStyle} placeholder="Linked source (read-only)" />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Source ID</span>
            <input type="text" value={sourceId} disabled style={inputStyle} placeholder="Linked source (read-only)" />
          </label>
          <div style={fieldStyle}>
            <span style={labelStyle}>Totals (preview)</span>
            <div style={badgeMutedStyle}>
              ₹{totals.total.toFixed(2)} total · ₹{totals.tax_total.toFixed(2)} tax
            </div>
          </div>
        </div>

        <div>
          <h3 style={sectionTitleStyle}>Line Items</h3>
          <div style={{ ...lineGridStyle, ...lineHeaderStyle, padding: "8px 0" }}>
            <span>Item Type</span>
            <span>Variant</span>
            <span>SKU</span>
            <span>Title</span>
            <span>HSN</span>
            <span>Qty</span>
            <span>Unit Rate</span>
            <span>Tax %</span>
            <span>Action</span>
          </div>
          {lines.map((line, index) => (
            <div key={`line-${index}`} style={{ ...lineGridStyle, ...lineRowStyle }}>
              <select
                value={line.item_type}
                onChange={(event) =>
                  handleLineChange(index, {
                    item_type: event.target.value as "manual" | "variant",
                    variant: event.target.value === "manual" ? null : line.variant,
                    variant_id: event.target.value === "manual" ? null : line.variant_id,
                  })
                }
                disabled={isReadOnly}
                style={inputStyle}
              >
                <option value="manual">Manual</option>
                <option value="variant">Variant</option>
              </select>
              <div style={{ minWidth: 180 }}>
                <VariantTypeahead
                  value={line.variant}
                  onSelect={(variant) => handleVariantSelect(index, variant)}
                  disabled={isReadOnly}
                  placeholder="Search variant"
                />
              </div>
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
                placeholder="Title"
              />
              <input
                type="text"
                value={line.hsn}
                onChange={(event) => handleLineChange(index, { hsn: event.target.value })}
                disabled={isReadOnly}
                style={inputStyle}
                placeholder="HSN"
              />
              <input
                type="number"
                min={0}
                step="0.001"
                value={line.qty}
                onChange={(event) => handleLineChange(index, { qty: ensureNumber(event.target.value) })}
                disabled={isReadOnly}
                style={inputStyle}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={line.unit_rate}
                onChange={(event) => handleLineChange(index, { unit_rate: ensureNumber(event.target.value) })}
                disabled={isReadOnly}
                style={inputStyle}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={line.tax_rate}
                onChange={(event) => handleLineChange(index, { tax_rate: ensureNumber(event.target.value) })}
                disabled={isReadOnly}
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={secondaryButtonStyle} disabled={isReadOnly || lines.length === 1} onClick={() => handleRemoveLine(index)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={handleAddLine} style={secondaryButtonStyle} disabled={isReadOnly}>
              Add Line
            </button>
          </div>
        </div>

        <div style={totalsRowStyle}>
          <div>Subtotal: ₹{totals.subtotal.toFixed(2)}</div>
          <div>Tax: ₹{totals.tax_total.toFixed(2)}</div>
          <div style={{ fontWeight: 700 }}>Total: ₹{totals.total.toFixed(2)}</div>
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
