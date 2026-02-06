import Link from "next/link";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  ordinal_position: number;
};

type ColumnsByTable = Record<string, ColumnRow[]>;

export default function ErpSchemaPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState("");
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [error, setError] = useState("");

  const isAuthorized = useMemo(
    () => ctx?.roleKey === "owner" || ctx?.roleKey === "admin",
    [ctx]
  );

  const groupedColumns = useMemo(() => {
    return columns.reduce<ColumnsByTable>((acc, column) => {
      const list = acc[column.table_name] ?? [];
      list.push(column);
      acc[column.table_name] = list;
      return acc;
    }, {});
  }, [columns]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      setAccessToken(session.access_token || "");
      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      if (context.roleKey !== "owner" && context.roleKey !== "admin") {
        setLoading(false);
        return;
      }

      await loadColumns(session.access_token, active);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadColumns(token: string, isActive = true) {
    if (!token) return;
    setError("");
    const res = await fetch("/api/admin/dev/schema", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      if (isActive) setError(data?.error || "Failed to load ERP schema");
      return;
    }

    if (isActive) setColumns(data.columns || []);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading ERP schema…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>ERP Schema</h1>
        <p style={{ color: "#b91c1c" }}>{error || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>Dev Tools</p>
        <h1 style={titleStyle}>ERP Schema</h1>
        <div style={errorBox}>Not authorized. Owner/admin access required.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/erp" style={linkButtonStyle}>
            Back to ERP Home
          </Link>
          <button onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Dev Tools</p>
          <h1 style={titleStyle}>ERP Schema</h1>
          <p style={subtitleStyle}>
            Column metadata for ERP tables (public schema, erp_* only).
          </p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role:{" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>
            ← Back to ERP Home
          </Link>
          <button type="button" onClick={() => loadColumns(accessToken)} style={buttonStyle}>
            Refresh
          </button>
        </div>
      </header>

      {error ? <div style={errorBox}>{error}</div> : null}
      {!error && Object.keys(groupedColumns).length === 0 ? (
        <p style={{ color: "#6b7280" }}>No ERP tables found.</p>
      ) : null}

      <div style={tableGroup}>
        {Object.entries(groupedColumns).map(([tableName, rows]) => (
          <section key={tableName} style={cardStyle}>
            <h2 style={sectionTitle}>{tableName}</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Column</th>
                    <th style={thStyle}>Data Type</th>
                    <th style={thStyle}>Nullable</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.table_name}-${row.column_name}`}>
                      <td style={tdStyle}>{row.column_name}</td>
                      <td style={tdStyle}>{row.data_type}</td>
                      <td style={tdStyle}>{row.is_nullable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "36px 44px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Inter, Arial, sans-serif",
  boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  backgroundColor: "#fff",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "1px solid #f1f3f5",
  paddingBottom: 20,
  marginBottom: 24,
};

const buttonStyle: CSSProperties = {
  padding: "12px 16px",
  backgroundColor: "#111827",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const linkButtonStyle: CSSProperties = {
  ...buttonStyle,
  textDecoration: "none",
  display: "inline-block",
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = {
  margin: "6px 0 8px",
  fontSize: 32,
  color: "#111827",
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontSize: 16,
};

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 18,
  backgroundColor: "#f9fafb",
  boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 420,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  color: "#4b5563",
  fontWeight: 600,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tdStyle: CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f1f5f9",
  color: "#111827",
  fontSize: 14,
  verticalAlign: "top",
};

const errorBox: CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecdd3",
  color: "#b91c1c",
  padding: 12,
  borderRadius: 8,
  margin: "12px 0",
};

const tableGroup: CSSProperties = {
  display: "grid",
  gap: 16,
};

const sectionTitle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 18,
  color: "#111827",
};
