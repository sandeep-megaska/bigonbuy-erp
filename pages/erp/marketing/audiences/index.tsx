import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  session?: { access_token?: string | null } | null;
};

type AudienceRow = {
  code: string;
  name: string;
  description: string | null;
  audience_type: string;
  refresh_freq: string;
  is_active: boolean;
  last_refreshed_at: string | null;
  active_members: number;
};

const dateOrDash = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

export default function MarketingAudiencesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AudienceRow[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRefresh = useMemo(() => Boolean(ctx?.roleKey && ["owner", "admin"].includes(ctx.roleKey)), [ctx?.roleKey]);

  const getHeaders = () => {
    const token = ctx?.session?.access_token;
    return {
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "application/json",
    };
  };

  const loadAudiences = async (tokenOverride?: string | null) => {
    setError(null);
    const response = await fetch("/api/marketing/audiences/list", {
      headers: {
        Authorization: tokenOverride ? `Bearer ${tokenOverride}` : getHeaders().Authorization,
      },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      setRows([]);
      setError(payload?.error || "Failed to load audiences.");
      return;
    }
    setRows(Array.isArray(payload.data) ? payload.data : []);
  };

  const refreshAudience = async (audienceCode: string | null) => {
    if (!canRefresh) return;
    setRefreshing(audienceCode || "all");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/marketing/audiences/refresh", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ audienceCode }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to refresh audiences.");
        return;
      }
      setMessage(audienceCode ? `Refreshed ${audienceCode}` : "Refreshed all audiences");
      await loadAudiences(ctx?.session?.access_token ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh audiences.");
    } finally {
      setRefreshing(null);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const companyContext = await getCompanyContext(session);
      if (!active) return;

      setCtx(companyContext as CompanyContext);
      if (!companyContext.companyId) {
        setError(companyContext.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      await loadAudiences(session.access_token);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          title="Marketing · Audiences"
          description="System-defined marketing audiences with refresh controls and active member counts."
        />

        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={secondaryButtonStyle} onClick={() => void loadAudiences()} disabled={loading}>
              Reload
            </button>
            {canRefresh ? (
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void refreshAudience(null)}
                disabled={refreshing !== null}
              >
                {refreshing === "all" ? "Refreshing..." : "Refresh All"}
              </button>
            ) : null}
          </div>
          {message ? <p style={{ margin: 0, color: "#065f46" }}>{message}</p> : null}
          {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}
        </section>

        <section style={{ ...cardStyle, marginTop: 16 }}>
          {loading ? (
            <p style={{ margin: 0 }}>Loading…</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Code</th>
                    <th style={tableHeaderCellStyle}>Name</th>
                    <th style={tableHeaderCellStyle}>Active Members</th>
                    <th style={tableHeaderCellStyle}>Last Refreshed</th>
                    <th style={tableHeaderCellStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.code}>
                      <td style={tableCellStyle}>{row.code}</td>
                      <td style={tableCellStyle}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong>{row.name}</strong>
                          <span style={{ color: "#4b5563", fontSize: 12 }}>{row.description || "—"}</span>
                        </div>
                      </td>
                      <td style={tableCellStyle}>{row.active_members.toLocaleString()}</td>
                      <td style={tableCellStyle}>{dateOrDash(row.last_refreshed_at)}</td>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <Link href={`/erp/marketing/audiences/${encodeURIComponent(row.code)}`}>View Members</Link>
                          {canRefresh ? (
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => void refreshAudience(row.code)}
                              disabled={refreshing !== null}
                            >
                              {refreshing === row.code ? "Refreshing..." : "Refresh"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={5}>
                        No audiences found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
