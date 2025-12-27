import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";

function Pill({ tone = "gray", children }) {
  const bg =
    tone === "green" ? "#ecfdf5" : tone === "red" ? "#fef2f2" : tone === "blue" ? "#eff6ff" : "#f3f4f6";
  const fg =
    tone === "green" ? "#065f46" : tone === "red" ? "#991b1b" : tone === "blue" ? "#1e40af" : "#111827";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function Card({ children }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </div>
  );
}

export default function OnboardingLinksPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [links, setLinks] = useState({}); // employeeId -> link
  const [successMsg, setSuccessMsg] = useState("");

  const canManage = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;
      setCtx(context);
      if (!context.companyId) {
        setErr(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }
      await loadEmployees(context.companyId, active);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadEmployees(companyId, isActive = true) {
    setErr("");
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, employee_no, full_name, work_email, personal_email, status")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) setEmployees(data || []);
  }

  async function generateLink(emp) {
    if (!ctx?.companyId) return;
    setErr("");
    setSuccessMsg("");

    if (!canManage) {
      setErr("You do not have permission to create onboarding links.");
      return;
    }

    setBusyId(emp.id);
    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !sessionData?.session?.access_token) {
        throw new Error("Unable to load session for request");
      }

      const res = await fetch("/api/hr/create-onboarding-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ companyId: ctx.companyId, employeeId: emp.id }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to create onboarding link");
      }

      setLinks((prev) => ({ ...prev, [emp.id]: data.link }));
      setSuccessMsg("Join link generated. Copy and share with the employee.");
    } catch (e) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Loading onboarding…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Onboarding Links</h1>
        <p style={{ color: "#b91c1c" }}>{err || "Company context missing."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>HR</div>
          <h1 style={{ margin: "6px 0 6px", fontSize: 36, lineHeight: 1.05 }}>Employee Onboarding</h1>
          <div style={{ opacity: 0.75, marginBottom: 6 }}>
            Generate join links for employees to set up their accounts. Links expire in 7 days.
          </div>
          <div style={{ opacity: 0.75 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Link href="/erp/hr" style={{ marginTop: 8 }}>
            ← HR Home
          </Link>
          <Link href="/erp" style={{ marginTop: 8 }}>
            ERP Home
          </Link>
          <button
            onClick={handleSignOut}
            style={{
              border: "none",
              background: "#dc2626",
              color: "white",
              padding: "10px 14px",
              borderRadius: 10,
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 18 }} />

      {err ? (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: 12,
            borderRadius: 10,
            marginBottom: 14,
            whiteSpace: "pre-wrap",
          }}
        >
          {err}
        </div>
      ) : null}

      {successMsg ? (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #bbf7d0",
            color: "#065f46",
            padding: 12,
            borderRadius: 10,
            marginBottom: 14,
          }}
        >
          {successMsg}
        </div>
      ) : null}

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Employees</div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>
              Click <b>Generate Join Link</b> to send a 7-day onboarding link.
            </div>
          </div>
          <div style={{ alignSelf: "center" }}>
            <Pill tone="blue">{employees.length} employees</Pill>
          </div>
        </div>

        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Employee</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Email</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Status</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                    <div style={{ fontWeight: 900 }}>{emp.full_name}</div>
                    <div style={{ opacity: 0.75, fontSize: 13 }}>
                      Employee #{emp.employee_no || "—"} · ID: {emp.id}
                    </div>
                  </td>
                  <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                    <div>{emp.work_email || emp.personal_email || "No email"}</div>
                  </td>
                  <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                    {emp.status ? <Pill tone={emp.status === "active" ? "green" : "gray"}>{emp.status}</Pill> : "—"}
                  </td>
                  <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                    <button
                      onClick={() => generateLink(emp)}
                      disabled={!canManage || busyId === emp.id}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #d1d5db",
                        background: canManage ? "#2563eb" : "#e5e7eb",
                        color: canManage ? "#fff" : "#6b7280",
                        cursor: canManage ? "pointer" : "not-allowed",
                        fontWeight: 800,
                      }}
                    >
                      {busyId === emp.id ? "Generating…" : "Generate Join Link"}
                    </button>
                    {links[emp.id] ? (
                      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="text"
                          value={links[emp.id]}
                          readOnly
                          style={{
                            flex: 1,
                            padding: 10,
                            borderRadius: 10,
                            border: "1px solid #d1d5db",
                            fontSize: 12,
                          }}
                        />
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(links[emp.id]);
                              alert("Join link copied");
                            } catch {
                              alert("Could not copy. Please copy manually.");
                            }
                          }}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid #d1d5db",
                            cursor: "pointer",
                            fontWeight: 700,
                            background: "#fff",
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 14, opacity: 0.75 }}>
                    No employees found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {!canManage ? (
        <div style={{ marginTop: 12 }}>
          <Pill tone="red">Read-only</Pill>{" "}
          <span style={{ opacity: 0.8 }}>Only owner/admin/hr can generate onboarding links.</span>
        </div>
      ) : null}

      <div style={{ marginTop: 14, opacity: 0.7, fontSize: 12 }}>
        Tip: Share the join link with the employee. After they complete onboarding, they can sign in and access <code>/me</code>.
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: "12px 16px",
  backgroundColor: "#111827",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};
