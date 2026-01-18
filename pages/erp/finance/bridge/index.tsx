import Link from "next/link";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
  inputStyle,
} from "../../../../components/erp/uiStyles";
import { supabase } from "../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

const reportCards = [
  {
    title: "Inventory Closing Snapshot",
    description: "Month-end stock on hand and valuation coverage by warehouse.",
    href: "/erp/finance/bridge/inventory-closing",
    icon: "📦",
  },
  {
    title: "Inventory Movement Summary",
    description: "Ledger movement totals by type and warehouse.",
    href: "/erp/finance/bridge/movements",
    icon: "🔁",
  },
  {
    title: "COGS Estimate",
    description: "Estimated cost of goods sold for sales-out movements.",
    href: "/erp/finance/bridge/cogs",
    icon: "💸",
  },
  {
    title: "GRN Register",
    description: "GRN list with total costs and missing cost flags.",
    href: "/erp/finance/bridge/grn-register",
    icon: "🧾",
  },
];

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);
const formatMonthInput = (value: Date) => value.toISOString().slice(0, 7);

function monthRange(monthValue: string) {
  const [year, month] = monthValue.split("-").map((part) => Number(part));
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    start: formatDateInput(start),
    end: formatDateInput(end),
  };
}

function buildQuery(params: Record<string, string | null | undefined>) {
  const query: Record<string, string> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value) query[key] = value;
  });
  return query;
}

type WarehouseOption = { id: string; name: string };

export default function FinanceBridgeHome() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [monthValue, setMonthValue] = useState(() => formatMonthInput(new Date()));
  const [warehouseId, setWarehouseId] = useState<string>("");

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
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;

    async function loadWarehouses() {
      if (!ctx?.companyId) return;
      const { data, error: loadError } = await supabase
        .from("erp_warehouses")
        .select("id, name")
        .eq("company_id", ctx.companyId)
        .order("name");

      if (!active) return;

      if (loadError) {
        setError(loadError.message || "Failed to load warehouses.");
        return;
      }

      setWarehouses((data || []) as WarehouseOption[]);
    }

    loadWarehouses();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const { start, end } = useMemo(() => monthRange(monthValue), [monthValue]);

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading Finance Bridge…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Finance Bridge"
            description="Accounts-ready inventory and GRN summaries."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
          <p style={subtitleStyle}>
            You are signed in as {ctx?.email || "unknown user"}, but no company is linked to your
            account.
          </p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Finance Bridge"
          description="Accounts-ready inventory and GRN summaries for CA/GST review."
          rightActions={
            <Link href="/erp/finance" style={linkButtonStyle}>
              Back to Finance
            </Link>
          }
        />

        <section style={cardStyle}>
          <div style={filterGridStyle}>
            <div>
              <label style={labelStyle}>Reporting month</label>
              <input
                type="month"
                value={monthValue}
                style={inputStyle}
                onChange={(event) => setMonthValue(event.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Warehouse</label>
              <select
                value={warehouseId}
                style={inputStyle}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value="">All warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                Month range: {start} → {end}
              </span>
            </div>
          </div>
        </section>

        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

        <section style={cardGridStyle}>
          {reportCards.map((card) => {
            const query =
              card.href === "/erp/finance/bridge/inventory-closing"
                ? buildQuery({ asOf: end, warehouseId })
                : buildQuery({ from: start, to: end, warehouseId });

            return (
              <Link
                key={card.href}
                href={{ pathname: card.href, query }}
                style={{ ...cardStyle, ...cardLinkStyle }}
              >
                <div style={cardIconStyle}>{card.icon}</div>
                <div>
                  <h2 style={cardTitleStyle}>{card.title}</h2>
                  <p style={cardDescriptionStyle}>{card.description}</p>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </ErpShell>
  );
}

const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 6,
};

const cardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 16,
};

const cardLinkStyle: CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
  textAlign: "left",
  textDecoration: "none",
  color: "#111827",
};

const cardIconStyle = {
  width: 42,
  height: 42,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  backgroundColor: "#ecfeff",
  color: "#0ea5e9",
  fontWeight: "bold",
  fontSize: 18,
};

const cardTitleStyle = {
  margin: "2px 0 6px",
  fontSize: 18,
  color: "#111827",
};

const cardDescriptionStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 14,
};

const linkButtonStyle = {
  ...secondaryButtonStyle,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
