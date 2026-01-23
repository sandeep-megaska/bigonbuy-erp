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

const defaultRate = "18";

type MissingMappingRow = {
  style_code: string;
  example_sku: string | null;
  last_seen: string | null;
  title: string | null;
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
                placeholder="18"
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
