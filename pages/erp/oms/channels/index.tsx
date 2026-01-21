import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

const channelOptions = [
  { key: "amazon_in", label: "Amazon IN" },
  { key: "shopify", label: "Shopify" },
  { key: "flipkart", label: "Flipkart" },
  { key: "myntra", label: "Myntra" },
];

const channelDefaultNames: Record<string, string> = {
  amazon_in: "Amazon IN - Bigonbuy",
  shopify: "Shopify - Bigonbuy",
  flipkart: "Flipkart - Bigonbuy",
  myntra: "Myntra - Bigonbuy",
};

type ChannelAccount = {
  id: string;
  channel_key: string;
  name: string;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export default function OmsChannelAccountsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ChannelAccount[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [channelKey, setChannelKey] = useState(channelOptions[0].key);
  const [name, setName] = useState(channelDefaultNames[channelOptions[0].key]);
  const [isActive, setIsActive] = useState(true);
  const [metadataText, setMetadataText] = useState("{}");

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadAccounts(active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadAccounts(isActive = true) {
    setError(null);
    const { data, error: loadError } = await supabase.rpc("erp_channel_account_list");
    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) setItems((data || []) as ChannelAccount[]);
  }

  function resetForm() {
    setEditingId(null);
    setChannelKey(channelOptions[0].key);
    setName(channelDefaultNames[channelOptions[0].key]);
    setIsActive(true);
    setMetadataText("{}");
  }

  function handleChannelChange(value: string) {
    setChannelKey(value);
    if (!editingId && !name.trim()) {
      setName(channelDefaultNames[value] || "");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only owner/admin can manage channel accounts.");
      return;
    }

    if (!channelKey) {
      setError("Select a channel.");
      return;
    }
    if (!name.trim()) {
      setError("Provide a display name.");
      return;
    }

    let metadata: Record<string, unknown> = {};
    if (metadataText.trim()) {
      try {
        metadata = JSON.parse(metadataText);
      } catch (parseError) {
        setError("Metadata must be valid JSON.");
        return;
      }
    }

    setError(null);
    const payload = {
      id: editingId,
      channel_key: channelKey,
      name: name.trim(),
      is_active: isActive,
      metadata,
    };

    const { data, error: upsertError } = await supabase.rpc("erp_channel_account_upsert", { p: payload });
    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    if (data && typeof data === "string") {
      setEditingId(null);
    }

    resetForm();
    await loadAccounts();
  }

  function handleEdit(item: ChannelAccount) {
    setEditingId(item.id);
    setChannelKey(item.channel_key);
    setName(item.name);
    setIsActive(item.is_active);
    setMetadataText(JSON.stringify(item.metadata ?? {}, null, 2));
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS</p>
            <h1 style={h1Style}>Channel accounts</h1>
            <p style={subtitleStyle}>Manage marketplace and store connections for OMS workflows.</p>
          </div>
        </header>

        {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}

        <section style={cardStyle}>
          <h2 style={{ margin: "0 0 12px" }}>{editingId ? "Edit channel" : "Create channel"}</h2>
          {!canWrite ? (
            <p style={subtitleStyle}>Only owner/admin can create or edit channel accounts.</p>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={subtitleStyle}>Channel</span>
                <select
                  value={channelKey}
                  onChange={(event) => handleChannelChange(event.target.value)}
                  style={inputStyle}
                >
                  {channelOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={subtitleStyle}>Display name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={channelDefaultNames[channelKey]}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={subtitleStyle}>Metadata (JSON)</span>
                <textarea
                  value={metadataText}
                  onChange={(event) => setMetadataText(event.target.value)}
                  rows={4}
                  style={{ ...inputStyle, fontFamily: "monospace" }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                <span style={subtitleStyle}>Active</span>
              </label>
              <div style={{ display: "flex", gap: 12 }}>
                <button type="submit" style={primaryButtonStyle}>
                  {editingId ? "Save changes" : "Create channel"}
                </button>
                {editingId ? (
                  <button type="button" onClick={resetForm} style={secondaryButtonStyle}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </section>

        <section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Channel</th>
                <th style={tableHeaderCellStyle}>Name</th>
                <th style={tableHeaderCellStyle}>Status</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    Loading channel accounts…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No channel accounts yet.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td style={tableCellStyle}>{item.channel_key}</td>
                    <td style={tableCellStyle}>{item.name}</td>
                    <td style={tableCellStyle}>{item.is_active ? "Active" : "Inactive"}</td>
                    <td style={tableCellStyle}>{new Date(item.created_at).toLocaleDateString()}</td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <Link href={`/erp/oms/channels/${item.id}`} style={{ color: "#2563eb" }}>
                          Manage
                        </Link>
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => handleEdit(item)}
                            style={{ ...secondaryButtonStyle, padding: "6px 12px" }}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}
