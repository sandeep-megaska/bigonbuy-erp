import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  pageWrapperStyle,
  primaryButtonStyle,
  subtitleStyle,
} from "../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { supabase } from "../../../lib/supabaseClient";

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const labelStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  fontWeight: 600,
};

export default function MetaSettingsPage() {
  const router = useRouter();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [metaPixelId, setMetaPixelId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestEventCode, setMetaTestEventCode] = useState("");
  const [metaAdAccountId, setMetaAdAccountId] = useState("");
  const [syncingEntities, setSyncingEntities] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  const loadSettings = useCallback(async (resolvedCompanyId: string) => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("erp_mkt_settings")
      .select("meta_pixel_id, meta_access_token, meta_test_event_code, meta_ad_account_id")
      .eq("company_id", resolvedCompanyId)
      .maybeSingle();

    if (queryError) {
      setError(queryError.message);
    } else {
      setMetaPixelId(data?.meta_pixel_id ?? "");
      setMetaAccessToken(data?.meta_access_token ?? "");
      setMetaTestEventCode(data?.meta_test_event_code ?? "");
      setMetaAdAccountId(data?.meta_ad_account_id ?? "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      const session = await requireAuthRedirectHome(router);
      if (!session || !mounted) return;
      const context = await getCompanyContext(session);
      if (!mounted) return;
      if (!context.companyId) {
        setError("No active company mapped for current user");
        setLoading(false);
        return;
      }
      setCompanyId(context.companyId);
      await loadSettings(context.companyId);
    }
    bootstrap();
    return () => {
      mounted = false;
    };
  }, [loadSettings, router]);


  async function onSyncEntities() {
    setSyncingEntities(true);
    setError(null);
    setMessage(null);
    setSyncSummary(null);
    try {
      const response = await fetch("/api/marketing/meta/sync-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) {
        throw new Error(json?.details || json?.error || "Meta entity sync failed");
      }
      const warningText = Array.isArray(json.warnings) && json.warnings.length > 0
        ? ` Warnings: ${json.warnings.map((warning: { type: string; message: string }) => `${warning.type} - ${warning.message}`).join("; ")}`
        : "";
      setSyncSummary(
        `Synced campaigns=${json.campaigns_upserted}, adsets=${json.adsets_upserted}, ads=${json.ads_upserted}, pages=${json.pages_fetched}.${warningText}`,
      );
    } catch (syncError: unknown) {
      setError(syncError instanceof Error ? syncError.message : "Meta entity sync failed");
    } finally {
      setSyncingEntities(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    const { error: upsertError } = await supabase.from("erp_mkt_settings").upsert(
      {
        company_id: companyId,
        meta_pixel_id: metaPixelId.trim() || null,
        meta_access_token: metaAccessToken.trim() || null,
        meta_test_event_code: metaTestEventCode.trim() || null,
        meta_ad_account_id: metaAdAccountId.trim() || null,
      },
      { onConflict: "company_id" },
    );

    if (upsertError) {
      setError(upsertError.message);
    } else {
      setMessage("Meta settings saved.");
    }
    setSaving(false);
  }

  return (
    <ErpShell activeModule="marketing">
      <div style={pageWrapperStyle}>
        <div style={pageContainerStyle}>
          <header style={pageHeaderStyle}>
            <div>
              <p style={eyebrowStyle}>Marketing</p>
              <h1 style={h1Style}>Meta Settings</h1>
              <p style={subtitleStyle}>Configure Meta CAPI credentials per company.</p>
            </div>
          </header>

          <section style={cardStyle}>
            <form style={formGridStyle} onSubmit={onSubmit}>
              <label style={labelStyle}>
                Meta Pixel ID
                <input style={inputStyle} value={metaPixelId} onChange={(e) => setMetaPixelId(e.target.value)} />
              </label>
              <label style={labelStyle}>
                Meta Access Token
                <input
                  style={inputStyle}
                  type="password"
                  autoComplete="off"
                  value={metaAccessToken}
                  onChange={(e) => setMetaAccessToken(e.target.value)}
                />
              </label>
              <label style={labelStyle}>
                Meta Test Event Code (optional)
                <input style={inputStyle} value={metaTestEventCode} onChange={(e) => setMetaTestEventCode(e.target.value)} />
              </label>
              <label style={labelStyle}>
                Meta Ad Account ID (required for entity sync)
                <input style={inputStyle} value={metaAdAccountId} onChange={(e) => setMetaAdAccountId(e.target.value)} />
              </label>

              {error ? <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}
              {message ? <p style={{ color: "#166534", margin: 0 }}>{message}</p> : null}
              {syncSummary ? <p style={{ color: "#166534", margin: 0 }}>{syncSummary}</p> : null}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={primaryButtonStyle} type="submit" disabled={saving || loading || !companyId}>
                  {saving ? "Saving…" : "Save settings"}
                </button>
                <button
                  style={{ ...primaryButtonStyle, background: syncingEntities ? "#475569" : "#0f766e" }}
                  type="button"
                  disabled={syncingEntities || loading || !companyId}
                  onClick={onSyncEntities}
                >
                  {syncingEntities ? "Syncing…" : "Sync Meta Entities"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </ErpShell>
  );
}
