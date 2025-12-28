import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function HrEmployeesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [employees, setEmployees] = useState([]);
  const [designations, setDesignations] = useState([]);

  const [employeeNo, setEmployeeNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [status, setStatus] = useState("active");
  const [department, setDepartment] = useState("");
  const [designationId, setDesignationId] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editingValues, setEditingValues] = useState({});

  const canWrite = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);
  const designationById = useMemo(() => {
    const map = {};
    designations.forEach((d) => {
      map[d.id] = d;
    });
    return map;
  }, [designations]);

  useEffect(() => {
    let active = true;

    (async () => {
      setErr("");
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setAccessToken(session.access_token || "");
      setCtx(context);
      if (!context.companyId) {
        setErr(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await Promise.all([
        loadDesignations(session.access_token, active),
        loadEmployees(session.access_token, active),
      ]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadDesignations(token, isActive = true) {
    if (!token) return;
    const res = await fetch("/api/hr/designations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      if (isActive) setErr(data?.error || "Failed to load designations");
      return;
    }

    if (isActive) setDesignations(data.rows || data.designations || []);
  }

  async function loadEmployees(token, isActive = true) {
    if (!token) return;
    const res = await fetch("/api/hr/employees", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      if (isActive) setErr(data?.error || "Failed to load employees");
      return;
    }

    if (isActive) setEmployees(data.employees || []);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can create employees.");
      return;
    }
    if (!accessToken) {
      setErr("Missing session. Please sign in again.");
      return;
    }
    if (!fullName.trim()) {
      setErr("Full name is required.");
      return;
    }

    setErr("");
    const selectedDesignation = designationId ? designationById[designationId] : null;
    const payload = {
      employee_no: employeeNo.trim() || null,
      full_name: fullName.trim(),
      work_email: workEmail.trim() || null,
      phone: phone.trim() || null,
      joining_date: joiningDate || null,
      status: status || "active",
      department: department.trim() || null,
      designation_id: designationId || null,
      designation: selectedDesignation?.name || null,
    };

    const res = await fetch("/api/hr/employees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setErr(data?.error || "Failed to create employee");
      return;
    }

    setEmployeeNo("");
    setFullName("");
    setWorkEmail("");
    setPhone("");
    setJoiningDate("");
    setStatus("active");
    setDepartment("");
    setDesignationId("");
    await loadEmployees(accessToken);
  }

  function startEdit(emp) {
    setEditingId(emp.id);
    setEditingValues({
      employee_no: emp.employee_no || "",
      full_name: emp.full_name || "",
      work_email: emp.work_email || "",
      phone: emp.phone || "",
      joining_date: emp.joining_date ? emp.joining_date.split("T")[0] : "",
      status: emp.status || "active",
      department: emp.department || "",
      designation_id: emp.designation_id || "",
    });
  }

  async function saveEdit(id) {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can update employees.");
      return;
    }
    if (!accessToken) {
      setErr("Missing session. Please sign in again.");
      return;
    }
    setErr("");
    const trimmedName = (editingValues.full_name || "").trim();
    if (!trimmedName) {
      setErr("Full name is required.");
      return;
    }
    const selectedDesignation = editingValues.designation_id ? designationById[editingValues.designation_id] : null;
    const payload = {
      employee_no: (editingValues.employee_no || "").trim() || null,
      full_name: trimmedName,
      work_email: (editingValues.work_email || "").trim() || null,
      phone: (editingValues.phone || "").trim() || null,
      joining_date: editingValues.joining_date || null,
      status: editingValues.status || "active",
      department: (editingValues.department || "").trim() || null,
      designation_id: editingValues.designation_id || null,
      designation: selectedDesignation?.name || null,
    };

    const res = await fetch("/api/hr/employees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, id }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setErr(data?.error || "Failed to update employee");
      return;
    }
    setEditingId(null);
    await loadEmployees(accessToken);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) return <div style={{ padding: 24 }}>Loading employees…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Employees</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Employees</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Manage employee directory and profiles.</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr">← HR Home</a>
          <a href="/erp">ERP Home</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Add Employee</h3>

        {!canWrite ? (
          <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin/hr can create/update).</div>
        ) : (
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="Employee No" style={inputStyle} />
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full Name *" style={inputStyle} required />
            <input value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} placeholder="Work Email" style={inputStyle} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" style={inputStyle} />
            <input value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} placeholder="Joining Date" type="date" style={inputStyle} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="on_leave">on_leave</option>
            </select>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department" style={inputStyle} />
            <select
              value={designationId}
              onChange={(e) => setDesignationId(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select Designation (optional)</option>
              {designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.department ? ` — ${d.department}` : ""}
                </option>
              ))}
            </select>
            <div style={{ gridColumn: "1 / -1" }}>
              <button style={buttonStyle}>Create Employee</button>
            </div>
          </form>
        )}
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Employees ({employees.length})
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Contact</th>
                <th style={thStyle}>Dates</th>
                <th style={thStyle}>Org</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const isEditing = editingId === emp.id;
                return (
                  <tr key={emp.id}>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <>
                          <input
                            value={editingValues.employee_no}
                            onChange={(e) => setEditingValues({ ...editingValues, employee_no: e.target.value })}
                            placeholder="Employee No"
                            style={inputStyle}
                          />
                          <input
                            value={editingValues.full_name}
                            onChange={(e) => setEditingValues({ ...editingValues, full_name: e.target.value })}
                            placeholder="Full Name"
                            style={inputStyle}
                          />
                          <div style={{ fontSize: 12, color: "#777" }}>#{emp.id}</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600 }}>{emp.full_name}</div>
                          <div style={{ fontSize: 12, color: "#777" }}>{emp.employee_no || "—"} · {emp.id}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: "#777" }}>Status: {emp.status}</div>
                        </>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <>
                          <input
                            value={editingValues.work_email}
                            onChange={(e) => setEditingValues({ ...editingValues, work_email: e.target.value })}
                            placeholder="Work Email"
                            style={inputStyle}
                          />
                          <input
                            value={editingValues.phone}
                            onChange={(e) => setEditingValues({ ...editingValues, phone: e.target.value })}
                            placeholder="Phone"
                            style={inputStyle}
                          />
                        </>
                      ) : (
                        <>
                          <div>{emp.work_email || "—"}</div>
                          <div style={{ color: "#555" }}>{emp.phone || "—"}</div>
                        </>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
                          <input
                            type="date"
                            value={editingValues.joining_date}
                            onChange={(e) => setEditingValues({ ...editingValues, joining_date: e.target.value })}
                            style={inputStyle}
                          />
                          <select
                            value={editingValues.status}
                            onChange={(e) => setEditingValues({ ...editingValues, status: e.target.value })}
                            style={inputStyle}
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                            <option value="on_leave">on_leave</option>
                          </select>
                        </div>
                      ) : (
                        <>
                          <div style={{ color: "#555" }}>Joined: {emp.joining_date ? new Date(emp.joining_date).toLocaleDateString() : "—"}</div>
                          <div style={{ fontSize: 12, color: "#777" }}>{emp.status}</div>
                        </>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <>
                          <input
                            value={editingValues.department}
                            onChange={(e) => setEditingValues({ ...editingValues, department: e.target.value })}
                            placeholder="Department"
                            style={inputStyle}
                          />
                          <select
                            value={editingValues.designation_id}
                            onChange={(e) => setEditingValues({ ...editingValues, designation_id: e.target.value })}
                            style={inputStyle}
                          >
                            <option value="">Select Designation (optional)</option>
                            {designations.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                                {d.department ? ` — ${d.department}` : ""}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          <div>{emp.department || "—"}</div>
                          <div style={{ color: "#555" }}>
                            {emp.designation_id
                              ? designationById[emp.designation_id]?.name || emp.designation || "—"
                              : emp.designation || "—"}
                          </div>
                        </>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {canWrite ? (
                        isEditing ? (
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button onClick={() => saveEdit(emp.id)} style={smallButtonStyle}>Save</button>
                            <button onClick={() => setEditingId(null)} style={smallButtonStyle}>Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(emp)} style={smallButtonStyle}>Edit</button>
                        )
                      ) : (
                        <span style={{ color: "#777" }}>Read-only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const smallButtonStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const thStyle = { padding: 12, borderBottom: "1px solid #eee" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
