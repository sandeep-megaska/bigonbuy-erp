import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function EmployeeLoginsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [linkResult, setLinkResult] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [emailInputs, setEmailInputs] = useState({});
  const [linking, setLinking] = useState({});

  const canWrite = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);
const [recoveryLink, setRecoveryLink] = useState("");
const [successMsg, setSuccessMsg] = useState("");

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
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, employee_no, full_name, work_email")
      .eq("company_id", companyId)
      .order("full_name", { ascending: true });

    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) {
      setEmployees(data || []);
      const defaults = {};
      (data || []).forEach((emp) => {
        defaults[emp.id] = emp.work_email || "";
      });
      setEmailInputs(defaults);
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  async function handleLink(emp) {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only owner/admin/hr can link logins.");
      return;
    }
    const email = (emailInputs[emp.id] || emp.work_email || "").trim();
    if (!email) {
      setErr("Email is required to link a login.");
      return;
    }

    setErr("");
    setSuccess("");
    setLinking((prev) => ({ ...prev, [emp.id]: true }));
    setLinkResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        throw new Error("No active session. Please sign in again.");
      }

     const resp = await fetch("/api/hr/link-employee-user", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
  companyId: ctx.companyId,
  employeeId: emp.id,
  employeeEmail: email,
}),

});

const data = await res.json();

if (!res.ok || !data.ok) {
  throw new Error(data.error || "Failed to link employee login");
}

setSuccessMsg("Employee login linked successfully.");
setRecoveryLink(data.recoveryLink || "");


      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to link login.");
      }
      setSuccess("Linked successfully");
      setLinkResult({ userId: payload.userId, recoveryLink: payload.recoveryLink });
    } catch (e) {
      setErr(e?.message || "Unable to link login.");
    } finally {
      setLinking((prev) => ({ ...prev, [emp.id]: false }));
    }
  }

  if (loading) {
    return <div style={pageStyle}>Loading employee logins…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={pageStyle}>
        <h1>Employee Logins</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={dangerButtonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0 }}>Employee Logins</h1>
          <p style={{ margin: "6px 0 0", color: "#555" }}>
            Link employees to Supabase Auth users for ERP access.
          </p>
          <p style={{ margin: "6px 0 0", color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr">← HR Home</a>
          <a href="/erp">ERP Home</a>
          <button onClick={handleSignOut} style={dangerButtonStyle}>Sign Out</button>
        </div>
      </div>

      {err ? (
        <div style={errorBoxStyle}>{err}</div>
      ) : null}
      {successMsg && (
  <div style={{ marginTop: 12, padding: 12, border: "1px solid #d1fae5", background: "#ecfdf5", borderRadius: 6 }}>
    <div style={{ fontWeight: 600 }}>{successMsg}</div>

    {recoveryLink && (
      <>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          Send this link to the employee to set their password:
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            type="text"
            value={recoveryLink}
            readOnly
            style={{ flex: 1, padding: 8, fontSize: 12 }}
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(recoveryLink);
              alert("Password setup link copied");
            }}
          >
            Copy
          </button>
        </div>
      </>
    )}
  </div>
)}

      {!canWrite ? (
        <div style={{ marginTop: 12, color: "#6b7280" }}>
          You are in read-only mode. Only owner/admin/hr can link employee logins.
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {(employees || []).map((emp) => (
          <div key={emp.id} style={cardStyle}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{emp.full_name || "Unnamed Employee"}</div>
              <div style={{ color: "#6b7280", fontSize: 13 }}>
                Employee #{emp.employee_no || "—"} · ID: {emp.id}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 320 }}>
              <input
                type="email"
                value={emailInputs[emp.id] ?? ""}
                onChange={(e) => setEmailInputs((prev) => ({ ...prev, [emp.id]: e.target.value }))}
                placeholder="Employee email"
                style={inputStyle}
                disabled={!canWrite || linking[emp.id]}
              />
              <button
                onClick={() => handleLink(emp)}
                style={primaryButtonStyle}
                disabled={!canWrite || linking[emp.id]}
              >
                {linking[emp.id] ? "Linking…" : "Link Login"}
              </button>
            </div>
          </div>
        ))}
        {!employees.length ? (
          <div style={{ color: "#6b7280" }}>No employees found for this company.</div>
        ) : null}
      </div>
    </div>
  );
}

const pageStyle = {
  padding: 24,
  fontFamily: "system-ui",
  maxWidth: 1000,
  margin: "0 auto",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const cardStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#fff",
  boxShadow: "0 3px 10px rgba(0,0,0,0.03)",
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  width: "100%",
  fontSize: 14,
};

const primaryButtonStyle = {
  padding: "10px 14px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600,
  minWidth: 110,
};

const secondaryButtonStyle = {
  padding: "10px 14px",
  background: "#e5e7eb",
  color: "#111827",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600,
};

const dangerButtonStyle = {
  padding: "10px 14px",
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600,
};

const errorBoxStyle = {
  marginTop: 12,
  padding: 12,
  borderRadius: 8,
  background: "#fff3f3",
  border: "1px solid #fca5a5",
  color: "#991b1b",
};

const successBoxStyle = {
  marginTop: 12,
  padding: 12,
  borderRadius: 8,
  background: "#ecfdf3",
  border: "1px solid #bbf7d0",
  color: "#166534",
};
