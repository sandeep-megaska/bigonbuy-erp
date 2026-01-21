import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Papa from "papaparse";
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

const tabButtonStyle = (active: boolean) => ({
  ...secondaryButtonStyle,
  borderColor: active ? "#111827" : "#d1d5db",
  backgroundColor: active ? "#111827" : "#fff",
  color: active ? "#fff" : "#111827",
});

type ChannelAccount = {
  id: string;
  channel_key: string;
  name: string;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
};

type WarehouseOption = {
  id: string;
  name: string;
  code: string | null;
};

type LocationRow = {
  id: string;
  warehouse_id: string;
  warehouse_name: string | null;
  fulfillment_type: string;
  is_default: boolean;
  is_active: boolean;
  external_location_ref: string | null;
  created_at: string;
};

type AliasRow = {
  id: string;
  variant_id: string;
  internal_sku: string;
  channel_sku: string;
  asin: string | null;
  listing_id: string | null;
  is_active: boolean;
  created_at: string;
};

type JobRow = {
  id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  requested_by: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

type VariantSuggestion = {
  variant_id: string;
  sku: string;
  size: string | null;
  color: string | null;
  style_code: string | null;
  title: string | null;
};

export default function OmsChannelDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const channelId = Array.isArray(id) ? id[0] : id;

  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [account, setAccount] = useState<ChannelAccount | null>(null);
  const [activeTab, setActiveTab] = useState("locations");

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationWarehouseId, setLocationWarehouseId] = useState("");
  const [locationFulfillmentType, setLocationFulfillmentType] = useState("self_ship");
  const [locationIsDefault, setLocationIsDefault] = useState(false);
  const [locationIsActive, setLocationIsActive] = useState(true);
  const [locationExternalRef, setLocationExternalRef] = useState("");
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);

  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [aliasSearch, setAliasSearch] = useState("");
  const [aliasChannelSku, setAliasChannelSku] = useState("");
  const [aliasAsin, setAliasAsin] = useState("");
  const [aliasListingId, setAliasListingId] = useState("");
  const [aliasIsActive, setAliasIsActive] = useState(true);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [variantQuery, setVariantQuery] = useState("");
  const [variantSuggestions, setVariantSuggestions] = useState<VariantSuggestion[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<VariantSuggestion | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const [jobs, setJobs] = useState<JobRow[]>([]);

  const canWrite = useMemo(() => (ctx ? isAdmin(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!channelId) return;
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

      await Promise.all([
        loadAccount(active),
        loadWarehouses(active),
        loadLocations(active),
        loadAliases(active),
        loadJobs(active),
      ]);

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, channelId]);

  async function loadAccount(isActive = true) {
    setError(null);
    const { data, error: loadError } = await supabase.rpc("erp_channel_account_list");
    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    const list = (data || []) as ChannelAccount[];
    const found = list.find((item) => item.id === channelId) || null;
    if (isActive) setAccount(found);
  }

  async function loadWarehouses(isActive = true) {
    const { data, error: loadError } = await supabase
      .from("erp_warehouses")
      .select("id, name, code")
      .order("name", { ascending: true });
    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) setWarehouses((data || []) as WarehouseOption[]);
  }

  async function loadLocations(isActive = true) {
    if (!channelId) return;
    const { data, error: loadError } = await supabase.rpc("erp_channel_location_list", {
      p_channel_account_id: channelId,
    });
    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) setLocations((data || []) as LocationRow[]);
  }

  async function loadAliases(isActive = true) {
    if (!channelId) return;
    const { data, error: loadError } = await supabase.rpc("erp_channel_alias_list", {
      p_channel_account_id: channelId,
      p_q: aliasSearch.trim() || null,
      p_limit: 200,
      p_offset: 0,
    });
    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) setAliases((data || []) as AliasRow[]);
  }

  async function loadJobs(isActive = true) {
    if (!channelId) return;
    const { data, error: loadError } = await supabase.rpc("erp_channel_job_list", {
      p_channel_account_id: channelId,
      p_job_type: null,
      p_status: null,
      p_limit: 100,
      p_offset: 0,
    });
    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) setJobs((data || []) as JobRow[]);
  }

  function resetLocationForm() {
    setEditingLocationId(null);
    setLocationWarehouseId("");
    setLocationFulfillmentType("self_ship");
    setLocationIsDefault(false);
    setLocationIsActive(true);
    setLocationExternalRef("");
  }

  async function handleLocationSubmit(event: FormEvent) {
    event.preventDefault();
    if (!channelId) return;
    if (!canWrite) {
      setError("Only owner/admin can manage channel locations.");
      return;
    }
    if (!locationWarehouseId) {
      setError("Select a warehouse.");
      return;
    }

    setError(null);
    const payload = {
      id: editingLocationId,
      channel_account_id: channelId,
      warehouse_id: locationWarehouseId,
      fulfillment_type: locationFulfillmentType,
      is_default: locationIsDefault,
      is_active: locationIsActive,
      external_location_ref: locationExternalRef.trim() || null,
    };

    const { error: upsertError } = await supabase.rpc("erp_channel_location_upsert", { p: payload });
    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    resetLocationForm();
    await loadLocations();
  }

  function handleLocationEdit(location: LocationRow) {
    setEditingLocationId(location.id);
    setLocationWarehouseId(location.warehouse_id);
    setLocationFulfillmentType(location.fulfillment_type);
    setLocationIsDefault(location.is_default);
    setLocationIsActive(location.is_active);
    setLocationExternalRef(location.external_location_ref || "");
  }

  async function handleVariantSearch() {
    if (!variantQuery.trim()) return;
    const { data, error: searchError } = await supabase.rpc("erp_variant_search", {
      p_query: variantQuery.trim(),
      p_limit: 10,
    });
    if (searchError) {
      setError(searchError.message);
      return;
    }
    setVariantSuggestions((data || []) as VariantSuggestion[]);
  }

  function selectVariant(variant: VariantSuggestion) {
    setSelectedVariant(variant);
    setVariantQuery(variant.sku);
    setVariantSuggestions([]);
  }

  function resetAliasForm() {
    setEditingAliasId(null);
    setAliasChannelSku("");
    setAliasAsin("");
    setAliasListingId("");
    setAliasIsActive(true);
    setSelectedVariant(null);
    setVariantQuery("");
  }

  async function handleAliasSubmit(event: FormEvent) {
    event.preventDefault();
    if (!channelId) return;
    if (!canWrite) {
      setError("Only owner/admin can manage aliases.");
      return;
    }
    if (!selectedVariant) {
      setError("Select an internal SKU.");
      return;
    }
    if (!aliasChannelSku.trim()) {
      setError("Channel SKU is required.");
      return;
    }

    setError(null);
    const payload = {
      id: editingAliasId,
      channel_account_id: channelId,
      variant_id: selectedVariant.variant_id,
      channel_sku: aliasChannelSku.trim(),
      asin: aliasAsin.trim() || null,
      listing_id: aliasListingId.trim() || null,
      is_active: aliasIsActive,
    };

    const { error: upsertError } = await supabase.rpc("erp_channel_alias_upsert", { p: payload });
    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    resetAliasForm();
    await loadAliases();
  }

  function handleAliasEdit(alias: AliasRow) {
    setEditingAliasId(alias.id);
    setAliasChannelSku(alias.channel_sku);
    setAliasAsin(alias.asin || "");
    setAliasListingId(alias.listing_id || "");
    setAliasIsActive(alias.is_active);
    setSelectedVariant({
      variant_id: alias.variant_id,
      sku: alias.internal_sku,
      size: null,
      color: null,
      style_code: null,
      title: null,
    });
    setVariantQuery(alias.internal_sku);
  }

  async function handleAliasSearchSubmit(event: FormEvent) {
    event.preventDefault();
    await loadAliases();
  }

  async function handleExportAliases() {
    if (!channelId) return;
    setError(null);
    const { data, error: loadError } = await supabase.rpc("erp_channel_alias_list", {
      p_channel_account_id: channelId,
      p_q: null,
      p_limit: 2000,
      p_offset: 0,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }

    const rows = (data || []) as AliasRow[];
    const csvRows = rows.map((row) => ({
      internal_sku: row.internal_sku,
      variant_id: row.variant_id,
      channel_sku: row.channel_sku,
      asin: row.asin || "",
      listing_id: row.listing_id || "",
      is_active: row.is_active,
    }));

    const csv = Papa.unparse(csvRows, { skipEmptyLines: true });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `channel-aliases-${channelId}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  async function handleImportAliases(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !channelId) return;
    if (!canWrite) {
      setError("Only owner/admin can import aliases.");
      return;
    }

    setImporting(true);
    setImportSummary(null);
    setImportErrors([]);
    setError(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data || [];
        const errors: string[] = [];
        let successCount = 0;

        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          const variantId = row.variant_id || "";
          const channelSku = row.channel_sku || "";
          if (!variantId || !channelSku) {
            errors.push(`Row ${i + 2}: variant_id and channel_sku are required.`);
            continue;
          }

          const payload = {
            channel_account_id: channelId,
            variant_id: variantId,
            channel_sku: channelSku,
            asin: row.asin || null,
            listing_id: row.listing_id || null,
            is_active: row.is_active ? row.is_active.toLowerCase() === "true" : true,
          };

          const { error: upsertError } = await supabase.rpc("erp_channel_alias_upsert", { p: payload });
          if (upsertError) {
            errors.push(`Row ${i + 2}: ${upsertError.message}`);
          } else {
            successCount += 1;
          }
        }

        setImportSummary(`Imported ${successCount} alias${successCount === 1 ? "" : "es"}.`);
        setImportErrors(errors);
        setImporting(false);
        await loadAliases();
      },
      error: (parseError) => {
        setImportErrors([parseError.message]);
        setImporting(false);
      },
    });
  }

  async function handleCreateInventoryJob() {
    if (!channelId) return;
    if (!canWrite) {
      setError("Only owner/admin can create jobs.");
      return;
    }
    setError(null);
    setNotice(null);

    const { error: createError } = await supabase.rpc("erp_channel_job_create", {
      p_channel_account_id: channelId,
      p_job_type: "inventory_push",
      p_payload: { source: "manual" },
    });

    if (createError) {
      setError(createError.message);
      return;
    }

    setNotice("Inventory push job queued.");
    await loadJobs();
  }

  if (loading) {
    return (
      <ErpShell>
        <div style={pageContainerStyle}>Loading channel…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>OMS · Channel</p>
            <h1 style={h1Style}>{account ? account.name : "Channel"}</h1>
            <p style={subtitleStyle}>{account ? account.channel_key : ""}</p>
            <div style={{ marginTop: 8 }}>
              <Link href="/erp/oms/channels" style={{ color: "#2563eb" }}>
                ← Back to channels
              </Link>
            </div>
          </div>
        </header>

        {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
        {notice ? <div style={{ color: "#059669" }}>{notice}</div> : null}

        <section style={{ display: "flex", gap: 12 }}>
          <button type="button" style={tabButtonStyle(activeTab === "locations")} onClick={() => setActiveTab("locations")}>
            Locations
          </button>
          <button type="button" style={tabButtonStyle(activeTab === "aliases")} onClick={() => setActiveTab("aliases")}>
            Aliases
          </button>
          <button type="button" style={tabButtonStyle(activeTab === "jobs")} onClick={() => setActiveTab("jobs")}>
            Jobs
          </button>
        </section>

        {activeTab === "locations" ? (
          <section style={cardStyle}>
            <h2 style={{ margin: "0 0 12px" }}>Warehouse locations</h2>
            {!canWrite ? (
              <p style={subtitleStyle}>Only owner/admin can manage channel locations.</p>
            ) : (
              <form onSubmit={handleLocationSubmit} style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={subtitleStyle}>Warehouse</span>
                  <select
                    value={locationWarehouseId}
                    onChange={(event) => setLocationWarehouseId(event.target.value)}
                    style={inputStyle}
                  >
                    <option value="">Select warehouse</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name} {warehouse.code ? `(${warehouse.code})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={subtitleStyle}>Fulfillment type</span>
                  <select
                    value={locationFulfillmentType}
                    onChange={(event) => setLocationFulfillmentType(event.target.value)}
                    style={inputStyle}
                  >
                    <option value="seller_flex">Seller Flex</option>
                    <option value="easy_ship">Easy Ship</option>
                    <option value="fba">FBA</option>
                    <option value="self_ship">Self Ship</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={subtitleStyle}>External location reference</span>
                  <input
                    value={locationExternalRef}
                    onChange={(event) => setLocationExternalRef(event.target.value)}
                    placeholder="Optional"
                    style={inputStyle}
                  />
                </label>
                <div style={{ display: "flex", gap: 16 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={locationIsDefault}
                      onChange={(event) => setLocationIsDefault(event.target.checked)}
                    />
                    <span style={subtitleStyle}>Default</span>
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={locationIsActive}
                      onChange={(event) => setLocationIsActive(event.target.checked)}
                    />
                    <span style={subtitleStyle}>Active</span>
                  </label>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button type="submit" style={primaryButtonStyle}>
                    {editingLocationId ? "Save location" : "Add location"}
                  </button>
                  {editingLocationId ? (
                    <button type="button" onClick={resetLocationForm} style={secondaryButtonStyle}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            )}

            <table style={{ ...tableStyle, marginTop: 16 }}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Warehouse</th>
                  <th style={tableHeaderCellStyle}>Fulfillment</th>
                  <th style={tableHeaderCellStyle}>Default</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>External ref</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {locations.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No locations mapped yet.
                    </td>
                  </tr>
                ) : (
                  locations.map((location) => (
                    <tr key={location.id}>
                      <td style={tableCellStyle}>{location.warehouse_name || location.warehouse_id}</td>
                      <td style={tableCellStyle}>{location.fulfillment_type}</td>
                      <td style={tableCellStyle}>{location.is_default ? "Yes" : "No"}</td>
                      <td style={tableCellStyle}>{location.is_active ? "Active" : "Inactive"}</td>
                      <td style={tableCellStyle}>{location.external_location_ref || "—"}</td>
                      <td style={tableCellStyle}>
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => handleLocationEdit(location)}
                            style={{ ...secondaryButtonStyle, padding: "6px 12px" }}
                          >
                            Edit
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "aliases" ? (
          <section style={cardStyle}>
            <h2 style={{ margin: "0 0 12px" }}>SKU aliases</h2>
            <form onSubmit={handleAliasSearchSubmit} style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <input
                value={aliasSearch}
                onChange={(event) => setAliasSearch(event.target.value)}
                placeholder="Search internal SKU, channel SKU, ASIN, listing ID"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button type="submit" style={secondaryButtonStyle}>
                Search
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleExportAliases}>
                Export CSV
              </button>
              <label style={{ ...secondaryButtonStyle, cursor: "pointer" }}>
                Import CSV
                <input type="file" accept=".csv" style={{ display: "none" }} onChange={handleImportAliases} />
              </label>
            </form>

            {importSummary ? <p style={{ color: "#059669" }}>{importSummary}</p> : null}
            {importErrors.length ? (
              <div style={{ color: "#b91c1c" }}>
                <strong>Import errors:</strong>
                <ul>
                  {importErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {importing ? <p style={subtitleStyle}>Importing aliases…</p> : null}

            {!canWrite ? (
              <p style={subtitleStyle}>Only owner/admin can manage aliases.</p>
            ) : (
              <form onSubmit={handleAliasSubmit} style={{ display: "grid", gap: 12, marginBottom: 16 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={subtitleStyle}>Find internal SKU</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={variantQuery}
                      onChange={(event) => setVariantQuery(event.target.value)}
                      placeholder="Search by SKU or style"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button type="button" onClick={handleVariantSearch} style={secondaryButtonStyle}>
                      Search
                    </button>
                  </div>
                  {selectedVariant ? (
                    <p style={subtitleStyle}>Selected: {selectedVariant.sku}</p>
                  ) : null}
                  {variantSuggestions.length ? (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {variantSuggestions.map((variant) => (
                        <li key={variant.variant_id}>
                          <button
                            type="button"
                            onClick={() => selectVariant(variant)}
                            style={{
                              ...secondaryButtonStyle,
                              width: "100%",
                              justifyContent: "space-between",
                              marginTop: 6,
                            }}
                          >
                            <span>{variant.sku}</span>
                            <span style={{ fontSize: 12, color: "#6b7280" }}>
                              {variant.title || ""} {variant.color ? `· ${variant.color}` : ""} {variant.size ? `· ${variant.size}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={subtitleStyle}>Channel SKU</span>
                  <input
                    value={aliasChannelSku}
                    onChange={(event) => setAliasChannelSku(event.target.value)}
                    placeholder="Amazon SellerSKU / Shopify SKU"
                    style={inputStyle}
                  />
                </label>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={subtitleStyle}>ASIN</span>
                    <input value={aliasAsin} onChange={(event) => setAliasAsin(event.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={subtitleStyle}>Listing ID</span>
                    <input
                      value={aliasListingId}
                      onChange={(event) => setAliasListingId(event.target.value)}
                      style={inputStyle}
                    />
                  </label>
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={aliasIsActive} onChange={(event) => setAliasIsActive(event.target.checked)} />
                  <span style={subtitleStyle}>Active</span>
                </label>
                <div style={{ display: "flex", gap: 12 }}>
                  <button type="submit" style={primaryButtonStyle}>
                    {editingAliasId ? "Save alias" : "Add alias"}
                  </button>
                  {editingAliasId ? (
                    <button type="button" onClick={resetAliasForm} style={secondaryButtonStyle}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            )}

            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Internal SKU</th>
                  <th style={tableHeaderCellStyle}>Channel SKU</th>
                  <th style={tableHeaderCellStyle}>ASIN</th>
                  <th style={tableHeaderCellStyle}>Listing</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {aliases.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No aliases yet.
                    </td>
                  </tr>
                ) : (
                  aliases.map((alias) => (
                    <tr key={alias.id}>
                      <td style={tableCellStyle}>{alias.internal_sku}</td>
                      <td style={tableCellStyle}>{alias.channel_sku}</td>
                      <td style={tableCellStyle}>{alias.asin || "—"}</td>
                      <td style={tableCellStyle}>{alias.listing_id || "—"}</td>
                      <td style={tableCellStyle}>{alias.is_active ? "Active" : "Inactive"}</td>
                      <td style={tableCellStyle}>
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => handleAliasEdit(alias)}
                            style={{ ...secondaryButtonStyle, padding: "6px 12px" }}
                          >
                            Edit
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "jobs" ? (
          <section style={cardStyle}>
            <h2 style={{ margin: "0 0 12px" }}>Channel jobs</h2>
            <p style={subtitleStyle}>Queue and track OMS sync jobs. External execution is not enabled in this sprint.</p>
            <button type="button" onClick={handleCreateInventoryJob} style={primaryButtonStyle}>
              Create Inventory Push Job
            </button>

            <table style={{ ...tableStyle, marginTop: 16 }}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Type</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Requested</th>
                  <th style={tableHeaderCellStyle}>Started</th>
                  <th style={tableHeaderCellStyle}>Finished</th>
                  <th style={tableHeaderCellStyle}>Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No jobs queued yet.
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id}>
                      <td style={tableCellStyle}>{job.job_type}</td>
                      <td style={tableCellStyle}>{job.status}</td>
                      <td style={tableCellStyle}>{new Date(job.requested_at).toLocaleString()}</td>
                      <td style={tableCellStyle}>{job.started_at ? new Date(job.started_at).toLocaleString() : "—"}</td>
                      <td style={tableCellStyle}>{job.finished_at ? new Date(job.finished_at).toLocaleString() : "—"}</td>
                      <td style={tableCellStyle}>{job.error || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}
