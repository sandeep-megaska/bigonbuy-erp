import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

const defaultRate = "5";

type MissingMappingRow = {
  style_code: string;
  example_sku: string | null;
  last_seen: string | null;
  title: string | null;
};

type BulkPreviewRow = {
  line: number;
  raw: string;
  style_code: string;
  hsn: string;
  gst_rate: number | null;
  status: "ok" | "error";
  reason?: string;
};

type BulkUpsertResult = {
  total_lines: number;
  valid: number;
  inserted: number;
  updated: number;
  upserted: number;
  skipped: number;
  errors: number;
  error_rows?: Array<{
    line: number;
    style_code: string | null;
    hsn: string | null;
    gst_rate: string | null;
    reason: string;
  }>;
};

export default function GstSkuMasterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missingSkus, setMissingSkus] = useState<MissingMappingRow[]>([]);
  const [styleCode, setStyleCode] = useState("");
  const [sku, setSku] = useState("");
  const [hsn, setHsn] = useState("");
  const [rate, setRate] = useState(defaultRate);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkResult, setBulkResult] = useState<BulkUpsertResult | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

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

      await loadMissingSkus();
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadMissingSkus = async () => {
    const { data, error: missingError } = await supabase.rpc("erp_gst_missing_mappings_shopify", {
      p_from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      p_to: new Date().toISOString().slice(0, 10),
    });
    if (missingError) {
      setError(missingError.message);
      return;
    }
    setMissingSkus((data || []) as MissingMappingRow[]);
  };

  const parseBulkRows = (raw: string): BulkPreviewRow[] => {
    const rows: BulkPreviewRow[] = [];
    const lines = raw.split(/\r?\n/);

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const withoutComments = line.split("#")[0]?.trim() ?? "";
      if (!withoutComments) {
        return;
      }

      const commaParts = withoutComments.split(/[,\t]+/).map((part) => part.trim());
      const parts =
        commaParts.length >= 2 ? commaParts : withoutComments.split(/\s+/).map((part) => part.trim());

      const style = (parts[0] || "").toUpperCase();
      const rawHsn = parts[1] || "";
      const normalizedHsn = rawHsn.replace(/\D/g, "");
      const rawRate = parts[2];
      const rateValue = rawRate === undefined || rawRate === "" ? 5 : Number(rawRate);

      let reason = "";
      if (!style) {
        reason = "Style code is required.";
      } else if (!normalizedHsn) {
        reason = "HSN is required.";
      } else if (!/^\d{4,10}$/.test(normalizedHsn)) {
        reason = "HSN must be 4-10 digits.";
      } else if (!Number.isFinite(rateValue)) {
        reason = "GST rate must be numeric.";
      } else if (rateValue !== 5) {
        reason = "GST rate must be 5.";
      }

      rows.push({
        line: lineNumber,
        raw: withoutComments,
        style_code: style,
        hsn: normalizedHsn,
        gst_rate: Number.isFinite(rateValue) ? rateValue : null,
        status: reason ? "error" : "ok",
        reason: reason || undefined,
      });
    });

    return rows;
  };

  const handleBulkValidate = () => {
    setBulkError(null);
    setBulkResult(null);
    setBulkPreview(parseBulkRows(bulkText));
  };

  const handleBulkSave = async () => {
    setBulkError(null);
    setBulkResult(null);

    if (!canWrite) {
      setBulkError("You need finance/admin/owner access to update SKU mappings.");
      return;
    }

    const parsed = parseBulkRows(bulkText);
    setBulkPreview(parsed);
    const validRows = parsed.filter((row) => row.status === "ok");

    if (!validRows.length) {
      setBulkError("No valid rows to save. Please fix errors and try again.");
      return;
    }

    setBulkSaving(true);
    const { data, error: bulkSaveError } = await supabase.rpc("erp_gst_sku_bulk_upsert", {
      p_rows: validRows.map((row) => ({
        style_code: row.style_code,
        hsn: row.hsn,
        gst_rate: row.gst_rate ?? 5,
      })),
    });

    if (bulkSaveError) {
      setBulkError(bulkSaveError.message);
      setBulkSaving(false);
      return;
    }

    setBulkResult((data || null) as BulkUpsertResult | null);
    setBulkSaving(false);
    await loadMissingSkus();
  };

  const handleDownloadTemplate = () => {
    const csv = ["style_code,hsn,gst_rate", "MGSW29,61124990,5"].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gst_sku_bulk_template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!styleCode.trim() || !hsn.trim()) {
      setError("Style code and HSN are required.");
      return;
    }

    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate)) {
      setError("GST rate must be a valid number.");
      return;
    }

    setSaving(true);
    const { error: upsertError } = await supabase.rpc("erp_gst_sku_upsert", {
      p_style_code: styleCode.trim(),
      p_sku: sku.trim() || null,
      p_hsn: hsn.trim(),
      p_rate: numericRate,
      p_is_active: isActive,
    });

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    setMessage(`Saved GST mapping for ${styleCode.trim()}.`);
    setStyleCode("");
    setSku("");
    setHsn("");
    setRate(defaultRate);
    setIsActive(true);
    await loadMissingSkus();
    setSaving(false);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading GST SKU master…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="GST SKU Master"
          description="Maintain SKU → HSN + GST rate mappings for Shopify orders."
          rightActions={
            <Link href="/erp/finance/gst" style={secondaryButtonStyle}>
              Back to GST
            </Link>
          }
        />

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Add / Update SKU Mapping</h2>
          <p style={subtitleStyle}>
            Create style-level mappings to cover all variants. Use SKU when you need an exact override.
          </p>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Style Code</span>
              <input
                type="text"
                value={styleCode}
                onChange={(event) => setStyleCode(event.target.value)}
                style={inputStyle}
                placeholder="MWSW06"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>SKU (optional)</span>
              <input
                type="text"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                style={inputStyle}
                placeholder="MWSW06-Black-L"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>HSN</span>
              <input
                type="text"
                value={hsn}
                onChange={(event) => setHsn(event.target.value)}
                style={inputStyle}
                placeholder="HSN code"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>GST Rate (%)</span>
              <input
                type="number"
                step="0.01"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                style={inputStyle}
                placeholder="5"
              />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              <span>Active</span>
            </label>
            <button type="submit" style={primaryButtonStyle} disabled={!canWrite || saving}>
              {saving ? "Saving…" : "Save Mapping"}
            </button>
          </form>
          {!canWrite && (
            <p style={{ color: "#b91c1c", marginTop: 12 }}>
              You need finance/admin/owner access to update SKU mappings.
            </p>
          )}
          {error && <p style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p>}
          {message && <p style={{ color: "#047857", marginTop: 12 }}>{message}</p>}
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Bulk Upsert</h2>
          <p style={subtitleStyle}>
            Paste multiple mappings (style_code, HSN, optional GST rate). Rates default to 5% and must
            remain 5% for now.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Bulk paste</span>
              <textarea
                rows={8}
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                style={{ ...inputStyle, fontFamily: "monospace" }}
                placeholder={`MGSW29,61124990,5\nMWSJ14 61124990\nMWSW06\t61124990\t5`}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={secondaryButtonStyle} onClick={handleDownloadTemplate}>
                Download template
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleBulkValidate}>
                Validate
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleBulkSave}
                disabled={!canWrite || bulkSaving}
              >
                {bulkSaving ? "Saving…" : "Save Bulk"}
              </button>
            </div>
          </div>

          {bulkPreview.length > 0 && (
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ paddingBottom: 8 }}>Line</th>
                    <th style={{ paddingBottom: 8 }}>Style Code</th>
                    <th style={{ paddingBottom: 8 }}>HSN</th>
                    <th style={{ paddingBottom: 8 }}>GST Rate</th>
                    <th style={{ paddingBottom: 8 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPreview.map((row) => (
                    <tr key={`${row.line}-${row.raw}`} style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "8px 0" }}>{row.line}</td>
                      <td style={{ padding: "8px 0" }}>{row.style_code || "—"}</td>
                      <td style={{ padding: "8px 0" }}>{row.hsn || "—"}</td>
                      <td style={{ padding: "8px 0" }}>{row.gst_rate ?? "—"}</td>
                      <td style={{ padding: "8px 0" }}>
                        {row.status === "ok" ? (
                          <span style={{ color: "#047857" }}>OK</span>
                        ) : (
                          <span style={{ color: "#b91c1c" }}>{row.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {bulkResult && (
            <div style={{ marginTop: 12, color: "#047857" }}>
              Bulk save complete: inserted {bulkResult.inserted}, updated {bulkResult.updated}, errors{" "}
              {bulkResult.errors}.
              {bulkResult.error_rows && bulkResult.error_rows.length > 0 && (
                <div style={{ marginTop: 8, color: "#b91c1c" }}>
                  <strong>First errors:</strong>
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {bulkResult.error_rows.slice(0, 10).map((row) => (
                      <li key={`${row.line}-${row.style_code}-${row.hsn}`}>
                        Line {row.line}: {row.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {bulkError && <p style={{ color: "#b91c1c", marginTop: 12 }}>{bulkError}</p>}
        </section>

        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Missing Style Mappings</h3>
          {missingSkus.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {missingSkus.map((row) => (
                <li key={row.style_code} style={{ marginBottom: 8 }}>
                  <div>
                    <strong>{row.style_code}</strong>
                    {row.title ? ` — ${row.title}` : ""}
                    {row.example_sku ? ` (ex: ${row.example_sku})` : ""}
                  </div>
                  <button
                    type="button"
                    style={{ ...secondaryButtonStyle, marginTop: 6 }}
                    onClick={() => {
                      setStyleCode(row.style_code);
                      setSku(row.example_sku || "");
                      setHsn("");
                      setRate(defaultRate);
                    }}
                  >
                    Use this style
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>No missing SKU mappings detected.</p>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
