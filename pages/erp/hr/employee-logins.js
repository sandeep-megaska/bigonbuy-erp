import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

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

function Pill({ children, tone = "gray" }) {
  const bg =
    tone === "green"
      ? "#ecfdf5"
      : tone === "red"
      ? "#fef2f2"
      : tone === "blue"
      ? "#eff6ff"
      : "#f3f4f6";
  const fg =
    tone === "green"
      ? "#065f46"
      : tone === "red"
      ? "#991b1b"
      : tone === "blue"
      ? "#1e40af"
      : "#111827";
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

export default function EmployeeLogins() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [sessionEmail, setSessionEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [companyId, setCompanyId] = useState("");

  const [employees, setEmployees] = useState([]);
  const [mappings, setMappings] = useState([]); // { employee_id, user_id, is_active }
  const [emailDrafts, setEmailDrafts] = useState({}); // employeeId -> email text

  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [recoveryLink, setRecoveryLink] = useState("");
  const [busyEmployeeId, setBusyEmployeeId] = useState(null);

  const canManage = useMemo(() => {
    return roleKey === "owner" || roleKey === "admin" || roleKey === "hr";
  }, [roleKey]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  async function loadContextAndData() {
    setLoading(true);
    setError("");
    setSuccessMsg("");
    setRecoveryLink("");

    const { data: sdata, error: serr } = await supabase.auth.getSession();
    if (serr || !sdata?.session) {
      router.replace("/");
      return;
    }

    const session = sdata.session;
    setSessionEmail(session.user.email || "");

    // Company membership (Phase 0)
    const { data: member, error: merr } = await supabase
      .from("erp_company_users")
      .select("company_id, role_key, is_active")
      .eq("user_id", session.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (merr) {
      setError(merr.message);
      setLoading(false);
      return;
    }

    if (!member?.company_id) {
      setError("No active company membership found for this user.");
      setLoading(false);
      return;
    }

    setCompanyId(member.company_id);
    setRoleKey(member.role_key || "");

    // Load employees
    const { data: emps, error: eerr } = await supabase
      .from("erp_employees")
      .select("id, employee_no, full_name, work_email, personal_email, phone, status, department, designation")
      .eq("company_id", member.company_id)
      .order("created_at", { ascending: false });

    if (eerr) {
      setError(eerr.message);
      setLoading(false);
      return;
    }

    setEmployees(emps || []);

    // Prepare default email drafts
    const drafts = {};
    (emps || []).forEach((e) => {
      drafts[e.id] = (e.work_email || e.personal_email || "").trim();
    });
    setEmailDrafts(drafts);

    // Load existing mappings
    const { data: maps, error: mapErr } = await supabase
      .from("erp_employee_users")
      .select("employee_id, user_id, is_active")
      .eq("company_id", member.company_id);

    if (mapErr) {
      // mapping table exists but policy might block; show error
      setError(mapErr.message);
      setLoading(false);
      return;
    }

    setMappings(maps || []);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await loadContextAndData();
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function mappingForEmployee(employeeId) {
    return mappings.find((m) => m.employee_id === employeeId && m.is_active);
  }

  async function linkLogin(emp) {
    setError("");
    setSuccessMsg("");
    setRecoveryLink("");

    if (!canManage) {
      setError("You do not have permission to link employee logins.");
      return;
    }

    const email = (emailDrafts[emp.id] || "").trim();
    if (!email) {
      setError("Please enter an email address for this employee.");
      return;
    }
    if (!companyId) {
      setError("companyId missing. Please refresh and try again.");
      return;
    }

    setBusyEmployeeId(emp.id);
    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !sessionData?.session) {
        throw new Error("Session expired. Please sign in again.");
      }

      const accessToken = sessionData.session.access_token;

      const res = await fetch("/api/hr/link-employee-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          companyId: companyId,
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

      // refresh mappings so status updates
      const { data: maps, error: mapErr } = await supabase
        .from("erp_employee_users")
        .select("employee_id, user_id, is_active")
        .eq("company_id", companyId);

      if (!mapErr) setMappings(maps || []);
    } catch (e) {
      setError(e?.message || "Something went wrong");
    } finally {
      setBusyEmployeeId(null);
    }
  }

  return (
    <div style={{ padding: 28, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, opacity: 0.7 }}>HR</div>
          <h1 style={{ margin: "6px 0 6px", fontSize: 44, lineHeight: 1.05 }}>Employee Logins</h1>
          <div style={{ opacity: 0.75, marginBottom: 6 }}>
            Link employees to Supabase logins and generate password setup links.
          </div>
          <div style={{ opacity: 0.75 }}>
            Signed in as <b>{sessionEmail || "—"}</b>
            {roleKey ? (
              <>
                {" "}
                · Role: <b>{roleKey}</b>
              </>
            ) : null}
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
            onClick={signOut}
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

      {loading && <div>Loading…</div>}

      {!loading && error && (
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
          {error}
        </div>
      )}

      {!loading && (successMsg || recoveryLink) && (
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
          <div style={{ fontWeight: 800 }}>{successMsg || "Success"}</div>
          {recoveryLink ? (
            <>
              <div style={{ marginTop: 6, fontSize: 13 }}>
                Send this link to the employee to set their password:
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <input
                  type="text"
                  value={recoveryLink}
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
                      await navigator.clipboard.writeText(recoveryLink);
                      alert("Password setup link copied");
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
            </>
          ) : null}
        </div>
      )}

      {!loading && !canManage && (
        <div style={{ marginBottom: 12 }}>
          <Pill tone="red">Read-only / Not permitted</Pill>{" "}
          <span style={{ opacity: 0.8 }}>Only owner/admin/hr can link employee logins.</span>
        </div>
      )}

      {!loading && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Employees</div>
              <div style={{ opacity: 0.75, marginTop: 4 }}>
                For each employee, confirm the email and click <b>Link Login</b>.
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
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Status</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Login Email</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid #eee" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const map = mappingForEmployee(emp.id);
                  const mapped = !!map;
                  return (
                    <tr key={emp.id}>
                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                        <div style={{ fontWeight: 900 }}>{emp.full_name}</div>
                        <div style={{ opacity: 0.75, fontSize: 13 }}>
                          Employee #{emp.employee_no} · ID: {emp.id}
                        </div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>
                          {emp.department ? `${emp.department} · ` : ""}
                          {emp.designation || ""}
                        </div>
                      </td>

                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                        {mapped ? <Pill tone="green">Linked</Pill> : <Pill>Not linked</Pill>}
                        {emp.status ? (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>{emp.status}</div>
                        ) : null}
                      </td>

                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                        <input
                          type="email"
                          value={emailDrafts[emp.id] ?? ""}
                          onChange={(e) =>
                            setEmailDrafts((prev) => ({
                              ...prev,
                              [emp.id]: e.target.value,
                            }))
                          }
                          placeholder="employee@email.com"
                          style={{
                            width: "100%",
                            minWidth: 280,
                            padding: 10,
                            borderRadius: 10,
                            border: "1px solid #d1d5db",
                          }}
                          disabled={!canManage}
                        />
                        {mapped ? (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                            user_id: <code>{map.user_id}</code>
                          </div>
                        ) : null}
                      </td>

                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #f3f4f6" }}>
                        <button
                          onClick={() => linkLogin(emp)}
                          disabled={!canManage || busyEmployeeId === emp.id}
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
                          {busyEmployeeId === emp.id ? "Linking…" : "Link Login"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
      )}

      <div style={{ marginTop: 14, opacity: 0.7, fontSize: 12 }}>
        Tip: After linking, send the password setup link to the employee. They can then log in and use{" "}
        <code>/me</code>.
      </div>
    </div>
  );
}
