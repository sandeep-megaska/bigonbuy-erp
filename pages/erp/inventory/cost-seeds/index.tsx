import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CSSProperties } from "react";
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
import { getCompanyContext, isInventoryWriter, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { useInventoryCostSeedList } from "../../../../lib/erp/inventoryCostSeeds";
import { useDebouncedValue } from "../../../../lib/erp/inventoryStock";
import { supabase } from "../../../../lib/supabaseClient";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

type VariantLookup = {
  id: string;
  sku: string;
};

export default function InventoryCostSeedsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [formSku, setFormSku] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formEffectiveFrom, setFormEffectiveFrom] = useState("");
  const [saving, setSaving] = useState(false);

  const debouncedQuery = useDebouncedValue(searchQuery, 300);

  const canWrite = useMemo(() => isInventoryWriter(ctx?.roleKey), [ctx?.roleKey]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx({
        companyId: context.companyId,
        roleKey: context.roleKey,
        membershipError: context.membershipError,
      });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const { data: rows, loading: listLoading, error: listError } = useInventoryCostSeedList({
    companyId: ctx?.companyId ?? null,
    query: debouncedQuery,
    refreshKey,
  });

  const displayError = error || listError;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!ctx?.companyId) {
      setError("Company context missing.");
      return;
    }

    const trimmedSku = formSku.trim();
    if (!trimmedSku) {
      setError("SKU is required.");
      return;
    }

    const parsedCost = Number(formCost);
    if (!Number.isFinite(parsedCost) || parsedCost <= 0) {
      setError("Standard unit cost must be greater than 0.");
      return;
    }

    setSaving(true);

    const { data: variant, error: variantError } = await supabase
      .from("erp_variants")
      .select("id, sku")
      .eq("company_id", ctx.companyId)
      .eq("sku", trimmedSku)
      .maybeSingle();

    if (variantError || !variant?.id) {
      setSaving(false);
      setError(variantError?.message || "SKU not found in inventory variants.");
      return;
    }

    const { error: upsertError } = await supabase.rpc("erp_inventory_cost_seed_upsert", {
      p_variant_id: (variant as VariantLookup).id,
      p_standard_unit_cost: parsedCost,
      p_effective_from: formEffectiveFrom || null,
      p_sku: trimmedSku,
    });

    if (upsertError) {
      setSaving(false);
      setError(upsertError.message || "Failed to save cost seed.");
      return;
    }

    setNotice(`Saved cost seed for ${trimmedSku}.`);
    setFormCost("");
    setFormEffectiveFrom("");
    setRefreshKey((prev) => prev + 1);
    setSaving(false);
  };

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading cost seeds…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Cost Seeds</p>
            <h1 style={h1Style}>Inventory Cost Seeds</h1>
            <p style={subtitleStyle}>Seed standard costs to bootstrap COGS posting before GRNs.</p>
          </div>
        </header>

        {displayError ? <div style={errorStyle}>{displayError}</div> : null}
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        <section style={cardStyle}>
          <form onSubmit={handleSubmit} style={formStyle}>
            <div style={fieldGroupStyle}>
              <label style={labelStyle} htmlFor="cost-seed-sku">
                SKU
              </label>
              <input
                id="cost-seed-sku"
                value={formSku}
                onChange={(event) => setFormSku(event.target.value)}
                placeholder="SKU"
                style={inputStyle}
              />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle} htmlFor="cost-seed-cost">
                Standard Unit Cost
              </label>
              <input
                id="cost-seed-cost"
                type="number"
                step="0.01"
                value={formCost}
                onChange={(event) => setFormCost(event.target.value)}
                placeholder="0.00"
                style={inputStyle}
              />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle} htmlFor="cost-seed-effective">
                Effective From
              </label>
              <input
                id="cost-seed-effective"
                type="date"
                value={formEffectiveFrom}
                onChange={(event) => setFormEffectiveFrom(event.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                type="submit"
                style={{
                  ...primaryButtonStyle,
                  opacity: saving || !canWrite ? 0.6 : 1,
                }}
                disabled={saving || !canWrite}
              >
                {saving ? "Saving…" : "Save Cost Seed"}
              </button>
            </div>
          </form>
          {!canWrite ? (
            <p style={helperStyle}>You need inventory write access to update cost seeds.</p>
          ) : null}
        </section>

        <section style={cardStyle}>
          <div style={filterRowStyle}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by SKU or product"
              style={inputStyle}
            />
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => setRefreshKey((prev) => prev + 1)}
              disabled={listLoading}
            >
              {listLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {listLoading ? <div style={mutedStyle}>Loading cost seeds…</div> : null}

          <table style={{ ...tableStyle, marginTop: 16 }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>SKU</th>
                <th style={tableHeaderCellStyle}>Product</th>
                <th style={tableHeaderCellStyle}>Variant</th>
                <th style={tableHeaderCellStyle}>Standard Cost</th>
                <th style={tableHeaderCellStyle}>Effective From</th>
                <th style={tableHeaderCellStyle}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tableCellStyle, textAlign: "center" }}>
                    No cost seeds found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td style={tableCellStyle}>{row.sku || "—"}</td>
                    <td style={tableCellStyle}>{row.product_title || "—"}</td>
                    <td style={tableCellStyle}>
                      {formatVariantLabel(row.style_code, row.color, row.size)}
                    </td>
                    <td style={tableCellStyle}>{formatCost(row.standard_unit_cost)}</td>
                    <td style={tableCellStyle}>{row.effective_from}</td>
                    <td style={tableCellStyle}>{formatDateTime(row.updated_at)}</td>
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

function formatCost(value: number) {
  if (!Number.isFinite(value ?? NaN)) return "—";
  return value.toFixed(2);
}

function formatVariantLabel(styleCode: string | null, color: string | null, size: string | null) {
  const parts = [styleCode, color, size].filter((part) => part && part.trim() !== "");
  return parts.length ? parts.join(" · ") : "—";
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

const formStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 16,
  alignItems: "end",
};

const fieldGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#4b5563",
};

const helperStyle: CSSProperties = {
  marginTop: 8,
  color: "#6b7280",
  fontSize: 13,
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
};

const mutedStyle: CSSProperties = {
  marginTop: 12,
  color: "#6b7280",
  fontSize: 13,
};

const errorStyle: CSSProperties = {
  marginBottom: 16,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#b91c1c",
};

const noticeStyle: CSSProperties = {
  marginBottom: 16,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#047857",
};
