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

type MissingSkuRow = {
  sku: string;
  sample_title: string | null;
  last_seen_at: string | null;
};

export default function GstSkuMasterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missingSkus, setMissingSkus] = useState<MissingSkuRow[]>([]);
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
    const { data, error: missingError } = await supabase.rpc("erp_gst_missing_skus_shopify");
    if (missingError) {
      setError(missingError.message);
      return;
    }
    setMissingSkus((data || []) as MissingSkuRow[]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!sku.trim() || !hsn.trim()) {
      setError("SKU and HSN are required.");
      return;
    }

    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate)) {
      setError("GST rate must be a valid number.");
      return;
    }

    setSaving(true);
    const { error: upsertError } = await supabase.rpc("erp_gst_sku_upsert", {
      p_sku: sku.trim(),
      p_hsn: hsn.trim(),
      p_rate: numericRate,
      p_is_active: isActive,
    });

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    setMessage(`Saved GST mapping for ${sku.trim()}.`);
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
          <p style={subtitleStyle}>Mappings are required before GST generation can complete.</p>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>SKU</span>
              <input
                type="text"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                style={inputStyle}
                placeholder="SKU"
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
          <h3 style={{ marginTop: 0 }}>Missing SKU Mappings</h3>
          {missingSkus.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {missingSkus.map((row) => (
                <li key={row.sku} style={{ marginBottom: 8 }}>
                  <div>
                    <strong>{row.sku}</strong>
                    {row.sample_title ? ` — ${row.sample_title}` : ""}
                  </div>
                  <button
                    type="button"
                    style={{ ...secondaryButtonStyle, marginTop: 6 }}
                    onClick={() => {
                      setSku(row.sku);
                      setHsn("");
                      setRate(defaultRate);
                    }}
                  >
                    Use this SKU
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
