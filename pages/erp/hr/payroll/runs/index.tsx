import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../../components/erp/ErpNavBar";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../../lib/erp/nav";
import { supabase } from "../../../../../lib/supabaseClient";

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

type PayrollRun = {
  id: string;
  year: number;
  month: number;
  status: string | null;
  finalized_at: string | null;
  notes?: string | null;
};

type AccessState = {
  isAuthenticated: boolean;
  isManager: boolean;
  roleKey?: string;
};

type CompanyContext = {
  session: { access_token?: string } | null;
  email: string | null;
  companyId: string | null;
  roleKey: string | null;
  membershipError: string | null;
};

export default function PayrollRunsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [access, setAccess] = useState<AccessState>({
    isAuthenticated: false,
    isManager: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [year, setYear] = useState(currentYear.toString());
  const [month, setMonth] = useState(currentMonth.toString().padStart(2, "0"));
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "hr", "payroll"].includes(ctx.roleKey);
  }, [ctx]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);

      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context as CompanyContext);

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await loadRuns(context.session);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadRuns = async (sessionOverride?: CompanyContext["session"]) => {
    const response = await fetch("/api/erp/payroll/runs/list", {
      method: "GET",
      headers: getAuthHeaders(sessionOverride ?? ctx?.session ?? null),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.error || "Unable to load payroll runs.");
      return;
    }
    setRuns(payload.runs || []);
  };

  const handleCreateRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setError("Only HR/admin/owner/payroll can create payroll runs.");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch("/api/erp/payroll/runs/create", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        year: Number(year),
        month: Number(month),
        notes: notes.trim() || null,
      }),
    });
    const payload = await response.json();
    setIsSubmitting(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to create payroll run.");
      return;
    }

    await loadRuns();
    setIsCreateOpen(false);
    setNotes("");

    if (payload?.id) {
      router.push(`/erp/hr/payroll/runs/${payload.id}`);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const getAuthHeaders = (sessionOverride: CompanyContext["session"] | null = null) => {
    const token = sessionOverride?.access_token ?? ctx?.session?.access_token;
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  };

  if (loading) {
    return <div style={containerStyle}>Loading payroll runs…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={titleStyle}>Payroll Runs</h1>
        <p style={{ color: "#b91c1c" }}>{error || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={dangerButtonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx.roleKey ?? undefined} />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Payroll</p>
          <h1 style={titleStyle}>Payroll Runs</h1>
          <p style={subtitleStyle}>Create and manage payroll runs aligned with the current schema.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong> · Role: <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={linkStyle}>← Back to HR</Link>
          <Link href="/erp" style={linkStyle}>ERP Home</Link>
          <button type="button" onClick={() => setIsCreateOpen(true)} style={primaryButtonStyle}>
            New Payroll Run
          </button>
        </div>
      </header>

      {error ? (
        <div style={errorStyle}>{error}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Runs</h2>
            <p style={sectionSubtitleStyle}>Newest payroll runs appear first.</p>
          </div>
          <span style={sectionMetaStyle}>{runs.length} total</span>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {runs.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No payroll runs yet.</div>
          ) : (
            runs.map((run) => (
              <div key={run.id} style={cardStyle}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>
                    {run.year}-{String(run.month).padStart(2, "0")}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 13 }}>
                    Status: {run.status || "Draft"}
                  </div>
                  <div style={{ color: "#9ca3af", fontSize: 12 }}>{run.id}</div>
                </div>
                <Link href={`/erp/hr/payroll/runs/${run.id}`} style={secondaryButtonStyle}>
                  Open Run
                </Link>
              </div>
            ))
          )}
        </div>
      </section>

      {isCreateOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Create Payroll Run</h3>
              <button type="button" onClick={() => setIsCreateOpen(false)} style={ghostButtonStyle}>
                ✕
              </button>
            </div>
            <p style={{ color: "#6b7280", marginTop: 8 }}>
              Capture the payroll period details and optional notes.
            </p>
            {!canWrite ? (
              <div style={{ color: "#b45309", marginTop: 12 }}>
                You are in read-only mode. Only owner/admin/hr/payroll can create runs.
              </div>
            ) : (
              <form onSubmit={handleCreateRun} style={{ marginTop: 16, display: "grid", gap: 12 }}>
                <div style={inputGridStyle}>
                  <label style={labelStyle}>
                    Year
                    <input
                      type="number"
                      value={year}
                      onChange={(event) => setYear(event.target.value)}
                      style={inputStyle}
                      min={2000}
                    />
                  </label>
                  <label style={labelStyle}>
                    Month
                    <input
                      type="number"
                      value={month}
                      onChange={(event) => setMonth(event.target.value)}
                      style={inputStyle}
                      min={1}
                      max={12}
                    />
                  </label>
                </div>
                <label style={labelStyle}>
                  Notes
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    style={{ ...inputStyle, minHeight: 84 }}
                    placeholder="Optional notes for this payroll run"
                  />
                </label>
                <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setIsCreateOpen(false)} style={secondaryButtonStyle}>
                    Cancel
                  </button>
                  <button type="submit" style={primaryButtonStyle} disabled={isSubmitting}>
                    {isSubmitting ? "Creating…" : "Create Run"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const containerStyle = {
  maxWidth: 1120,
  margin: "72px auto",
  padding: "48px 56px 56px",
  borderRadius: 12,
  border: "1px solid #e7eaf0",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 14px 32px rgba(15, 23, 42, 0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 24,
  flexWrap: "wrap" as const,
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 24,
  marginBottom: 28,
};

const eyebrowStyle = {
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 8,
};

const titleStyle = {
  margin: 0,
  fontSize: 30,
};

const subtitleStyle = {
  marginTop: 10,
  color: "#6b7280",
  maxWidth: 480,
};

const linkStyle = {
  color: "#2563eb",
  textDecoration: "none",
};

const sectionStyle = {
  border: "1px solid #eef1f6",
  borderRadius: 12,
  padding: 20,
  backgroundColor: "#f9fafb",
};

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
  gap: 12,
  flexWrap: "wrap" as const,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 20,
};

const sectionSubtitleStyle = {
  margin: 0,
  color: "#6b7280",
};

const sectionMetaStyle = {
  color: "#6b7280",
  fontSize: 13,
};

const cardStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: 16,
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  backgroundColor: "#fff",
  gap: 16,
};

const errorStyle = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#b91c1c",
};

const primaryButtonStyle = {
  padding: "10px 16px",
  backgroundColor: "#2563eb",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

const secondaryButtonStyle = {
  padding: "10px 14px",
  backgroundColor: "#fff",
  border: "1px solid #d1d5db",
  color: "#111827",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  textDecoration: "none",
};

const ghostButtonStyle = {
  border: "none",
  background: "transparent",
  fontSize: 18,
  cursor: "pointer",
  color: "#6b7280",
};

const dangerButtonStyle = {
  padding: "10px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

const modalOverlayStyle = {
  position: "fixed" as const,
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 20,
};

const modalStyle = {
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 24,
  width: "100%",
  maxWidth: 520,
  boxShadow: "0 16px 30px rgba(15, 23, 42, 0.2)",
};

const inputGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 12,
};

const labelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 14,
  color: "#111827",
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: 14,
};
