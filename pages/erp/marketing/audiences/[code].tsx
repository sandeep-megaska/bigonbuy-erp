import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import { cardStyle, pageContainerStyle, tableCellStyle, tableHeaderCellStyle, tableStyle } from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";

type CompanyContext = {
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
  session?: { access_token?: string | null } | null;
};

type AudienceDetails = {
  code: string;
  name: string;
  description: string | null;
  last_refreshed_at: string | null;
};

type Member = {
  customer_key: string;
  em_hash: string | null;
  ph_hash: string | null;
  member_since: string;
  member_rank: number | null;
  member_score: number | null;
  meta: Record<string, unknown>;
  updated_at: string;
};

const asDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

export default function MarketingAudienceMembersPage() {
  const router = useRouter();
  const code = useMemo(
    () => (typeof router.query.code === "string" ? router.query.code.trim() : ""),
    [router.query.code]
  );

  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<AudienceDetails | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const loadMembers = async (tokenOverride?: string | null) => {
    if (!code) return;
    setError(null);
    const params = new URLSearchParams({ audienceCode: code, limit: "500" });
    const response = await fetch(`/api/marketing/audiences/members?${params.toString()}`, {
      headers: {
        Authorization: tokenOverride ? `Bearer ${tokenOverride}` : ctx?.session?.access_token ? `Bearer ${ctx.session.access_token}` : "",
      },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      setAudience(null);
      setMembers([]);
      setError(payload?.error || "Failed to load members.");
      return;
    }
    setAudience(payload.data?.audience ?? null);
    setMembers(Array.isArray(payload.data?.members) ? payload.data.members : []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady || !code) return;
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

      await loadMembers(session.access_token);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady, code]);

  return (
    <ErpShell activeModule="marketing">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          title={`Marketing Audience · ${audience?.name || code || "Members"}`}
          description={audience?.description || "Active members in the selected audience."}
        />

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/erp/marketing/audiences">← Back to Audiences</Link>
            <span style={{ color: "#4b5563" }}>Last Refreshed: {asDate(audience?.last_refreshed_at ?? null)}</span>
          </div>
          {error ? <p style={{ margin: "12px 0 0", color: "#b91c1c" }}>{error}</p> : null}
        </section>

        <section style={cardStyle}>
          {loading ? (
            <p style={{ margin: 0 }}>Loading…</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Customer</th>
                    <th style={tableHeaderCellStyle}>Rank</th>
                    <th style={tableHeaderCellStyle}>Score</th>
                    <th style={tableHeaderCellStyle}>Email Hash</th>
                    <th style={tableHeaderCellStyle}>Phone Hash</th>
                    <th style={tableHeaderCellStyle}>Meta</th>
                    <th style={tableHeaderCellStyle}>Member Since</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member, index) => (
                    <tr key={`${member.customer_key}-${index}`}>
                      <td style={tableCellStyle}>{member.customer_key}</td>
                      <td style={tableCellStyle}>{member.member_rank ?? "—"}</td>
                      <td style={tableCellStyle}>{member.member_score ?? "—"}</td>
                      <td style={tableCellStyle}>{member.em_hash || "—"}</td>
                      <td style={tableCellStyle}>{member.ph_hash || "—"}</td>
                      <td style={tableCellStyle}>{JSON.stringify(member.meta || {})}</td>
                      <td style={tableCellStyle}>{asDate(member.member_since)}</td>
                    </tr>
                  ))}
                  {members.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={7}>
                        No active members.
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
