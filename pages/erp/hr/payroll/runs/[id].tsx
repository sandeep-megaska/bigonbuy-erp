import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../../components/erp/ErpNavBar";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../../lib/erp/nav";
import { supabase } from "../../../../../lib/supabaseClient";

type PayrollRun = {
  id: string;
  year: number;
  month: number;
  status: string | null;
  finalized_at: string | null;
  notes?: string | null;
};

type PayrollItem = {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  employee_code?: string | null;
  salary_basic?: number | null;
  salary_hra?: number | null;
  salary_allowances?: number | null;
  gross?: number | null;
  deductions?: number | null;
  net_pay?: number | null;
  ot_amount?: number | null;
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

type OtDraft = {
  payrollItemId: string;
  employeeName: string;
  hours: string;
  rate: string;
  amount: string;
  notes: string;
};

const emptyOtDraft = (): OtDraft => ({
  payrollItemId: "",
  employeeName: "",
  hours: "",
  rate: "",
  amount: "0",
  notes: "",
});

export default function PayrollRunDetailPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<CompanyContext | null>(null);
  const [access, setAccess] = useState<AccessState>({
    isAuthenticated: false,
    isManager: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [otModalOpen, setOtModalOpen] = useState(false);
  const [otDraft, setOtDraft] = useState<OtDraft>(emptyOtDraft());
  const [isSavingOt, setIsSavingOt] = useState(false);

  const runId = typeof router.query.id === "string" ? router.query.id : "";

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
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId || !router.isReady || !runId) return;
    let active = true;

    (async () => {
      setLoading(true);
      await loadRunDetails(ctx.session);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, ctx?.session, router.isReady, runId]);

  const loadRunDetails = async (sessionOverride?: CompanyContext["session"]) => {
    if (!runId) return;
    const headers = getAuthHeaders(sessionOverride ?? ctx?.session ?? null);

    const [runResponse, itemsResponse] = await Promise.all([
      fetch("/api/erp/payroll/runs/get", {
        method: "POST",
        headers,
        body: JSON.stringify({ runId }),
      }),
      fetch("/api/erp/payroll/items/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ payrollRunId: runId }),
      }),
    ]);

    const runPayload = await runResponse.json();
    const itemsPayload = await itemsResponse.json();

    if (!runResponse.ok) {
      setError(runPayload?.error || "Unable to load payroll run.");
      return;
    }

    if (!itemsResponse.ok) {
      setError(itemsPayload?.error || "Unable to load payroll items.");
      return;
    }

    setRun(runPayload.run || null);
    setItems(itemsPayload.items || []);
  };

  const handleGenerate = async () => {
    if (!runId) return;
    setIsGenerating(true);
    const response = await fetch("/api/erp/payroll/runs/generate", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ payrollRunId: runId }),
    });
    const payload = await response.json();
    setIsGenerating(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to generate payroll items.");
      return;
    }

    await loadRunDetails();
  };

  const openOtModal = async (item: PayrollItem) => {
    setError("");
    setOtModalOpen(true);
    const employeeName = item.employee_name || item.employee_code || "Employee";
    setOtDraft({
      payrollItemId: item.id,
      employeeName,
      hours: "",
      rate: "",
      amount: item.ot_amount ? Number(item.ot_amount).toFixed(2) : "0",
      notes: "",
    });

    const response = await fetch("/api/erp/payroll/item-lines/list", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ payrollItemId: item.id }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.error || "Unable to load overtime details.");
      return;
    }

    const otLine = (payload.lines || []).find((line: { code?: string }) => line.code === "OT");
    if (otLine) {
      const hours = otLine.units ?? "";
      const rate = otLine.rate ?? "";
      const amount = otLine.amount ?? 0;
      setOtDraft((prev) => ({
        ...prev,
        hours: hours !== null && hours !== undefined ? String(hours) : "",
        rate: rate !== null && rate !== undefined ? String(rate) : "",
        amount: Number(amount || 0).toFixed(2),
        notes: otLine.notes ? String(otLine.notes) : "",
      }));
    }
  };

  const handleOtChange = (field: keyof OtDraft, value: string) => {
    if (field === "hours" || field === "rate") {
      const nextHours = field === "hours" ? value : otDraft.hours;
      const nextRate = field === "rate" ? value : otDraft.rate;
      const computed = Number(nextHours || 0) * Number(nextRate || 0);
      setOtDraft((prev) => ({
        ...prev,
        [field]: value,
        amount: computed.toFixed(2),
      }));
      return;
    }

    setOtDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveOt = async () => {
    if (!otDraft.payrollItemId) return;
    setIsSavingOt(true);
    const upsertResponse = await fetch("/api/erp/payroll/item-lines/upsert", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        payrollItemId: otDraft.payrollItemId,
        code: "OT",
        units: otDraft.hours || null,
        rate: otDraft.rate || null,
        amount: otDraft.amount || null,
        notes: otDraft.notes,
      }),
    });
    const upsertPayload = await upsertResponse.json();
    if (!upsertResponse.ok) {
      setIsSavingOt(false);
      setError(upsertPayload?.error || "Unable to save overtime line.");
      return;
    }

    const recalcResponse = await fetch("/api/erp/payroll/item/recalculate", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ payrollItemId: otDraft.payrollItemId }),
    });
    const recalcPayload = await recalcResponse.json();
    setIsSavingOt(false);

    if (!recalcResponse.ok) {
      setError(recalcPayload?.error || "Unable to recalculate payroll item.");
      return;
    }

    setOtModalOpen(false);
    await loadRunDetails();
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
    return <div style={containerStyle}>Loading payroll run…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={titleStyle}>Payroll Run</h1>
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
          <h1 style={titleStyle}>Payroll Run Details</h1>
          <p style={subtitleStyle}>Review items, overtime, and totals for this payroll run.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong> · Role: <strong>{ctx.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr/payroll/runs" style={linkStyle}>← Back to Payroll Runs</Link>
          <Link href="/erp/hr" style={linkStyle}>HR Home</Link>
          <button type="button" onClick={handleGenerate} style={primaryButtonStyle} disabled={isGenerating || !canWrite}>
            {isGenerating ? "Generating…" : "Generate Items"}
          </button>
        </div>
      </header>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>
              {run ? `${run.year}-${String(run.month).padStart(2, "0")}` : "Payroll Run"}
            </h2>
            <p style={sectionSubtitleStyle}>Status: {run?.status || "Draft"}</p>
            {run?.notes ? <p style={sectionSubtitleStyle}>Notes: {run.notes}</p> : null}
          </div>
          <span style={sectionMetaStyle}>{items.length} payroll items</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Employee</th>
                <th style={tableHeaderStyle}>Basic</th>
                <th style={tableHeaderStyle}>HRA</th>
                <th style={tableHeaderStyle}>Allowances</th>
                <th style={tableHeaderStyle}>OT</th>
                <th style={tableHeaderStyle}>Gross</th>
                <th style={tableHeaderStyle}>Deductions</th>
                <th style={tableHeaderStyle}>Net Pay</th>
                <th style={tableHeaderStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={9} style={emptyStateStyle}>No payroll items yet. Generate items to get started.</td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} style={rowStyle}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 600 }}>{item.employee_name || "Employee"}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{item.employee_code || item.employee_id}</div>
                    </td>
                    <td style={tableCellStyle}>{formatAmount(item.salary_basic)}</td>
                    <td style={tableCellStyle}>{formatAmount(item.salary_hra)}</td>
                    <td style={tableCellStyle}>{formatAmount(item.salary_allowances)}</td>
                    <td style={tableCellStyle}>{formatAmount(item.ot_amount)}</td>
                    <td style={tableCellStyle}>{formatAmount(item.gross)}</td>
                    <td style={tableCellStyle}>{formatAmount(item.deductions)}</td>
                    <td style={tableCellStyle}>{formatAmount(item.net_pay)}</td>
                    <td style={tableCellStyle}>
                      <button type="button" onClick={() => openOtModal(item)} style={secondaryButtonStyle}>
                        Edit OT
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {otModalOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Edit Overtime</h3>
              <button type="button" onClick={() => setOtModalOpen(false)} style={ghostButtonStyle}>
                ✕
              </button>
            </div>
            <p style={{ color: "#6b7280", marginTop: 8 }}>
              Update overtime for <strong>{otDraft.employeeName}</strong>.
            </p>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <label style={labelStyle}>
                Hours
                <input
                  type="number"
                  value={otDraft.hours}
                  onChange={(event) => handleOtChange("hours", event.target.value)}
                  style={inputStyle}
                  min={0}
                />
              </label>
              <label style={labelStyle}>
                Rate
                <input
                  type="number"
                  value={otDraft.rate}
                  onChange={(event) => handleOtChange("rate", event.target.value)}
                  style={inputStyle}
                  min={0}
                />
              </label>
              <label style={labelStyle}>
                Amount (auto)
                <input type="text" value={otDraft.amount} style={inputStyle} readOnly />
              </label>
              <label style={labelStyle}>
                Notes
                <textarea
                  value={otDraft.notes}
                  onChange={(event) => handleOtChange("notes", event.target.value)}
                  style={{ ...inputStyle, minHeight: 90 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" onClick={() => setOtModalOpen(false)} style={secondaryButtonStyle}>
                Cancel
              </button>
              <button type="button" onClick={handleSaveOt} style={primaryButtonStyle} disabled={isSavingOt}>
                {isSavingOt ? "Saving…" : "Save OT"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const formatAmount = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const containerStyle = {
  maxWidth: 1200,
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
  maxWidth: 520,
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
  margin: "4px 0 0",
  color: "#6b7280",
};

const sectionMetaStyle = {
  color: "#6b7280",
  fontSize: 13,
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  backgroundColor: "#fff",
  borderRadius: 10,
  overflow: "hidden",
};

const tableHeaderStyle = {
  textAlign: "left" as const,
  padding: "12px 14px",
  backgroundColor: "#e5e7eb",
  fontSize: 13,
  color: "#374151",
};

const tableCellStyle = {
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 14,
  color: "#111827",
  verticalAlign: "top" as const,
};

const rowStyle = {
  backgroundColor: "#fff",
};

const emptyStateStyle = {
  padding: "20px",
  textAlign: "center" as const,
  color: "#6b7280",
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
  padding: "8px 12px",
  backgroundColor: "#fff",
  border: "1px solid #d1d5db",
  color: "#111827",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
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
