import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  cardStyle,
  eyebrowStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isAdmin, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

type Warehouse = {
  id: string;
  name: string;
  code: string | null;
  created_at: string;
};

export default function InventoryWarehousesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Warehouse[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

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

      await loadWarehouses(context.companyId, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadWarehouses(companyId: string, isActive = true) {
    setError("");
    const { data, error: loadError } = await supabase
      .from("erp_warehouses")
      .select("id, name, code, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (loadError) {
      if (isActive) setError(loadError.message);
      return;
    }
    if (isActive) setItems((data || []) as Warehouse[]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!name.trim()) {
      setError("Please provide a warehouse name.");
      return;
    }
    if (!canWrite) {
      setError("Only owner/admin can create or edit warehouses.");
      return;
    }

    setError("");
    const payload = {
      p_id: editingId || null,
      p_name: name.trim(),
      p_code: code.trim() || null,
    };

    if (editingId) {
      const { error: updateError } = await supabase.rpc("erp_inventory_warehouse_upsert", payload);
      if (updateError) {
        setError(updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase.rpc("erp_inventory_warehouse_upsert", payload);
      if (insertError) {
        setError(insertError.message);
        return;
      }
    }

    resetForm();
    await loadWarehouses(ctx.companyId);
  }

  function handleEdit(warehouse: Warehouse) {
    setEditingId(warehouse.id);
    setName(warehouse.name);
    setCode(warehouse.code || "");
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setCode("");
  }

  if (loading) {
    return (
      <ErpShell activeModule="workspace">
        <div style={pageContainerStyle}>Loading warehouses…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="workspace">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Inventory · Warehouses</p>
            <h1 style={h1Style}>Warehouses</h1>
            <p style={subtitleStyle}>Track physical and third-party warehouse locations.</p>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>{editingId ? "Edit Warehouse" : "Create Warehouse"}</h2>
          {!canWrite ? (
            <p style={mutedStyle}>Only owner/admin can create or edit warehouses.</p>
          ) : (
            <form onSubmit={handleSubmit} style={formGridStyle}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Warehouse name (e.g., Jaipur WH)"
                style={inputStyle}
              />
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Optional code (e.g., JPR)"
                style={inputStyle}
              />
              <div style={buttonRowStyle}>
                <button type="submit" style={primaryButtonStyle}>
                  {editingId ? "Save Changes" : "Create Warehouse"}
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

        <section style={tableStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={tableHeaderCellStyle}>Name</th>
                <th style={tableHeaderCellStyle}>Code</th>
                <th style={tableHeaderCellStyle}>Created</th>
                <th style={tableHeaderCellStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((warehouse) => (
                <tr key={warehouse.id}>
                  <td style={tableCellStyle}>
                    <div style={{ fontWeight: 600 }}>{warehouse.name}</div>
                    <div style={mutedStyle}>{warehouse.id}</div>
                  </td>
                  <td style={tableCellStyle}>{warehouse.code || "—"}</td>
                  <td style={tableCellStyle}>{new Date(warehouse.created_at).toLocaleString()}</td>
                  <td style={{ ...tableCellStyle, textAlign: "right" }}>
                    {canWrite ? (
                      <button type="button" onClick={() => handleEdit(warehouse)} style={secondaryButtonStyle}>
                        Edit
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} style={emptyStateStyle}>
                    No warehouses yet. Add Jaipur WH, FBA MH, or other locations.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </ErpShell>
  );
}

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  alignItems: "center",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0 0 16px",
  fontSize: 18,
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
};

const errorStyle: CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
};

const emptyStateStyle: CSSProperties = {
  ...tableCellStyle,
  textAlign: "center",
  color: "#6b7280",
};
