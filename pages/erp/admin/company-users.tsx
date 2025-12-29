import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import type { NextPage } from "next";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];

type EmployeeRow = {
  id: string;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  employment_status: string | null;
  joining_date: string | null;
  user_id: string | null;
  role_key: string | null;
};

type RoleRow = { key: string; name: string; usageCount?: number };

type ApiError = { ok: false; error: string; details?: string | null };
type ApiListResponse = { ok: true; employees: EmployeeRow[] };
type ApiCreateResponse = { ok: true; employee: EmployeeRow };
type ApiGrantResponse = {
  ok: true;
  employee_id: string;
  employee_code: string;
  user_id: string;
  role_key: string;
  temp_password?: string;
};
type ApiUploadResponse = { ok: true; path: string; uploadUrl: string };

const defaultEmployeeStatus = "active";

const CompanyUsersPage: NextPage = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"employees" | "access">("employees");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [listError, setListError] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState(defaultEmployeeStatus);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [aadhaarLast4, setAadhaarLast4] = useState("");
  const [idProofType, setIdProofType] = useState("");
  const [addressJson, setAddressJson] = useState("");
  const [salaryJson, setSalaryJson] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [idProofFile, setIdProofFile] = useState<File | null>(null);

  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  const [grantEmployeeId, setGrantEmployeeId] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRoleKey, setGrantRoleKey] = useState("employee");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [grantSuccess, setGrantSuccess] = useState("");

  const signedInEmail = useMemo(() => session?.user?.email ?? "member", [session]);

  const fetchAccessToken = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) return null;
    return data.session.access_token;
  }, []);

  const loadEmployees = useCallback(async () => {
    setListError("");
    const token = await fetchAccessToken();
    if (!token) {
      setListError("Please sign in again.");
      return;
    }

    const res = await fetch("/api/erp/employees/list", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as ApiListResponse | ApiError;

    if (!res.ok || !body.ok) {
      setEmployees([]);
      setListError(body.ok ? "Unable to load employees" : body.error);
      return;
    }
    setEmployees(body.employees || []);
  }, [fetchAccessToken]);

  const loadRoles = useCallback(async () => {
    const token = await fetchAccessToken();
    if (!token) return;

    const res = await fetch("/api/hr/roles/list", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { ok: boolean; roles?: RoleRow[]; error?: string };
    if (res.ok && body.ok && body.roles) {
      setRoles(body.roles);
    }
  }, [fetchAccessToken]);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const currentSession = data?.session ?? null;
      if (!currentSession) {
        window.location.href = "/erp/login";
        return;
      }

      setSession(currentSession);
      await Promise.all([loadEmployees(), loadRoles()]);
      if (active) setLoading(false);
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        window.location.href = "/erp/login";
      } else {
        setSession(nextSession);
      }
    });

    return () => {
      active = false;
      authListener?.subscription.unsubscribe();
    };
  }, [loadEmployees, loadRoles]);

  const parseJsonField = (value: string, label: string) => {
    if (!value.trim()) return null;
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new Error(`${label} must be valid JSON`);
    }
  };

  const uploadFile = useCallback(
    async (file: File, kind: "photo" | "id-proof", employeeId: string | null) => {
      const token = await fetchAccessToken();
      if (!token) throw new Error("Missing session token");

      const endpoint =
        kind === "photo" ? "/api/erp/employees/upload-photo" : "/api/erp/employees/upload-id-proof";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          employee_id: employeeId,
          file_name: file.name,
          content_type: file.type || "application/octet-stream",
        }),
      });

      const body = (await res.json()) as ApiUploadResponse | ApiError;
      if (!res.ok || !body.ok) {
        throw new Error(body.ok ? "Failed to prepare upload" : body.error);
      }

      const upload = await fetch(body.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!upload.ok) {
        throw new Error("Failed to upload file to storage");
      }

      return body.path;
    },
    [fetchAccessToken],
  );

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCreateError("");
      setCreateSuccess("");
      setCreateBusy(true);
      setTempPassword(null);

      try {
        if (!fullName.trim()) {
          setCreateError("Full name is required.");
          return;
        }

        const address = parseJsonField(addressJson, "Address JSON");
        const salary = parseJsonField(salaryJson, "Salary JSON");

        let photoPath: string | null = null;
        let idProofPath: string | null = null;

        if (photoFile) {
          photoPath = await uploadFile(photoFile, "photo", null);
        }

        if (idProofFile) {
          idProofPath = await uploadFile(idProofFile, "id-proof", null);
        }

        const token = await fetchAccessToken();
        if (!token) {
          setCreateError("Please sign in again.");
          return;
        }

        const res = await fetch("/api/erp/employees/create", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            full_name: fullName,
            email: email || null,
            phone: phone || null,
            designation: designation || null,
            department: department || null,
            joining_date: joiningDate || null,
            employment_status: employmentStatus || defaultEmployeeStatus,
            dob: dob || null,
            gender: gender || null,
            address_json: address,
            salary_json: salary,
            photo_path: photoPath,
            id_proof_type: idProofType || null,
            aadhaar_last4: aadhaarLast4 || null,
            id_proof_path: idProofPath,
          }),
        });

        const body = (await res.json()) as ApiCreateResponse | ApiError;
        if (!res.ok || !body.ok) {
          setCreateError(body.ok ? "Failed to create employee" : body.error);
          return;
        }

        const created = body.employee as EmployeeRow;
        setCreateSuccess(`Employee created with code ${created.employee_code}`);
        await loadEmployees();
        setTab("access");
        setGrantEmployeeId(created.id);
        setGrantEmail(created.email || email || "");
        setGrantRoleKey("employee");
        setFullName("");
        setEmail("");
        setPhone("");
        setDesignation("");
        setDepartment("");
        setJoiningDate("");
        setEmploymentStatus(defaultEmployeeStatus);
        setDob("");
        setGender("");
        setAadhaarLast4("");
        setIdProofType("");
        setAddressJson("");
        setSalaryJson("");
        setPhotoFile(null);
        setIdProofFile(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create employee";
        setCreateError(message);
      } finally {
        setCreateBusy(false);
      }
    },
    [
      fullName,
      email,
      phone,
      designation,
      department,
      joiningDate,
      employmentStatus,
      dob,
      gender,
      addressJson,
      salaryJson,
      idProofType,
      aadhaarLast4,
      photoFile,
      idProofFile,
      fetchAccessToken,
      uploadFile,
      loadEmployees,
    ],
  );

  const handleGrant = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setGrantError("");
      setGrantSuccess("");
      setTempPassword(null);
      setGrantBusy(true);

      try {
        if (!grantEmployeeId) {
          setGrantError("Select an employee first.");
          return;
        }
        const trimmedEmail = grantEmail.trim().toLowerCase();
        if (!trimmedEmail) {
          setGrantError("Email is required.");
          return;
        }

        const token = await fetchAccessToken();
        if (!token) {
          setGrantError("Please sign in again.");
          return;
        }

        const res = await fetch("/api/erp/employees/grant-access", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            employee_id: grantEmployeeId,
            email: trimmedEmail,
            role_key: grantRoleKey,
          }),
        });

        const body = (await res.json()) as ApiGrantResponse | ApiError;
        if (!res.ok || !body.ok) {
          setGrantError(body.ok ? "Failed to grant access" : body.error);
          return;
        }

        setGrantSuccess("System access granted successfully.");
        setTempPassword(body.temp_password || null);
        await loadEmployees();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to grant access";
        setGrantError(message);
      } finally {
        setGrantBusy(false);
      }
    },
    [grantEmployeeId, grantEmail, grantRoleKey, fetchAccessToken, loadEmployees],
  );

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.href = "/erp/login";
  }, []);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === grantEmployeeId) || null,
    [employees, grantEmployeeId],
  );

  if (loading) {
    return <div style={containerStyle}>Loading company users…</div>;
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Admin</p>
          <h1 style={titleStyle}>Company Users</h1>
          <p style={subtitleStyle}>
            Create employee records and provision ERP login access with secure temporary passwords.
          </p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{signedInEmail}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>
            ← Back to ERP Home
          </Link>
          <button type="button" onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </header>

      <div style={tabRowStyle}>
        <button
          type="button"
          style={tab === "employees" ? tabButtonActive : tabButton}
          onClick={() => setTab("employees")}
        >
          Employees
        </button>
        <button
          type="button"
          style={tab === "access" ? tabButtonActive : tabButton}
          onClick={() => setTab("access")}
        >
          Grant System Access
        </button>
      </div>

      {tab === "employees" ? (
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: "0 0 8px" }}>Create Employee</h2>
              <p style={{ margin: 0, color: "#4b5563" }}>
                Add HR and legal details. Employee codes are generated automatically.
              </p>
            </div>
            <button type="button" onClick={loadEmployees} style={{ ...buttonStyle, background: "#111827" }}>
              Refresh List
            </button>
          </div>

          {createError ? <div style={errorBox}>{createError}</div> : null}
          {createSuccess ? <div style={okBox}>{createSuccess}</div> : null}

          <form onSubmit={handleCreate} style={{ display: "grid", gap: 12 }}>
            <div style={gridCols2}>
              <Field label="Full name *">
                <input
                  style={inputStyle}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Employee full name"
                  required
                />
              </Field>
              <Field label="Work email (optional)">
                <input
                  style={inputStyle}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </Field>
            </div>

            <div style={gridCols3}>
              <Field label="Phone">
                <input
                  style={inputStyle}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 ..."
                />
              </Field>
              <Field label="Department">
                <input
                  style={inputStyle}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Department"
                />
              </Field>
              <Field label="Designation (title)">
                <input
                  style={inputStyle}
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="HR Executive"
                />
              </Field>
            </div>

            <div style={gridCols3}>
              <Field label="Joining date">
                <input
                  style={inputStyle}
                  type="date"
                  value={joiningDate}
                  onChange={(e) => setJoiningDate(e.target.value)}
                />
              </Field>
              <Field label="Employment status">
                <select
                  style={selectStyle}
                  value={employmentStatus}
                  onChange={(e) => setEmploymentStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="terminated">Terminated</option>
                </select>
              </Field>
              <Field label="Gender">
                <input
                  style={inputStyle}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  placeholder="Gender"
                />
              </Field>
            </div>

            <div style={gridCols3}>
              <Field label="Date of birth">
                <input style={inputStyle} type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </Field>
              <Field label="ID proof type">
                <input
                  style={inputStyle}
                  value={idProofType}
                  onChange={(e) => setIdProofType(e.target.value)}
                  placeholder="aadhaar / passport / PAN"
                />
              </Field>
              <Field label="Aadhaar last 4">
                <input
                  style={inputStyle}
                  maxLength={4}
                  value={aadhaarLast4}
                  onChange={(e) => setAadhaarLast4(e.target.value)}
                  placeholder="1234"
                />
              </Field>
            </div>

            <div style={gridCols2}>
              <Field label="Address JSON (optional)">
                <textarea
                  style={textAreaStyle}
                  value={addressJson}
                  onChange={(e) => setAddressJson(e.target.value)}
                  placeholder='{"line1": "123 Street", "city": "Bengaluru"}'
                  rows={3}
                />
              </Field>
              <Field label="Salary JSON (optional)">
                <textarea
                  style={textAreaStyle}
                  value={salaryJson}
                  onChange={(e) => setSalaryJson(e.target.value)}
                  placeholder='{"ctc": 1000000, "currency": "INR"}'
                  rows={3}
                />
              </Field>
            </div>

            <div style={gridCols2}>
              <Field label="Photo (storage path only)">
                <input
                  style={inputStyle}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                />
              </Field>
              <Field label="ID proof document">
                <input
                  style={inputStyle}
                  type="file"
                  onChange={(e) => setIdProofFile(e.target.files?.[0] || null)}
                />
              </Field>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                style={{ ...buttonStyle, background: "#2563eb" }}
                disabled={createBusy}
              >
                {createBusy ? "Creating..." : "Create employee"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {tab === "access" ? (
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: "0 0 8px" }}>Grant System Access</h2>
              <p style={{ margin: 0, color: "#4b5563" }}>
                Link an employee to Supabase Auth and assign an ERP role. Temporary passwords are
                shown once.
              </p>
            </div>
            <button type="button" onClick={loadEmployees} style={{ ...buttonStyle, background: "#111827" }}>
              Refresh List
            </button>
          </div>

          {grantError ? <div style={errorBox}>{grantError}</div> : null}
          {grantSuccess ? <div style={okBox}>{grantSuccess}</div> : null}
          {tempPassword ? (
            <div style={{ ...okBox, background: "#ecfdf3", color: "#166534" }}>
              Temporary password: <code>{tempPassword}</code>
              <button
                type="button"
                style={{ ...buttonStyle, background: "#059669", marginLeft: 12 }}
                onClick={() => navigator.clipboard.writeText(tempPassword || "")}
              >
                Copy
              </button>
              <p style={{ margin: "6px 0 0", fontSize: 14 }}>
                Share securely with the employee. This will not be shown again.
              </p>
            </div>
          ) : null}

          <form onSubmit={handleGrant} style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div style={gridCols2}>
              <Field label="Employee">
                <select
                  style={selectStyle}
                  value={grantEmployeeId}
                  onChange={(e) => {
                    const value = e.target.value;
                    setGrantEmployeeId(value);
                    const emp = employees.find((em) => em.id === value);
                    if (emp?.email) setGrantEmail(emp.email);
                  }}
                >
                  <option value="">Select employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_code} — {emp.full_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Email for login">
                <input
                  style={inputStyle}
                  type="email"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                />
              </Field>
            </div>

            <div style={gridCols2}>
              <Field label="ERP role">
                <select
                  style={selectStyle}
                  value={grantRoleKey}
                  onChange={(e) => setGrantRoleKey(e.target.value)}
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name || role.key}
                    </option>
                  ))}
                  {!roles.length ? <option value="employee">employee</option> : null}
                </select>
              </Field>
            </div>

            {selectedEmployee ? (
              <div style={{ padding: 12, background: "#f3f4f6", borderRadius: 8 }}>
                <strong>{selectedEmployee.full_name}</strong> — {selectedEmployee.employee_code} •{" "}
                {selectedEmployee.designation || "No title"}{" "}
                {selectedEmployee.user_id ? "(already linked)" : "(no login yet)"}
              </div>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                style={{ ...buttonStyle, background: "#2563eb" }}
                disabled={grantBusy}
              >
                {grantBusy ? "Granting..." : "Grant access"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section style={{ ...cardStyle, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Employees</h2>
            <p style={{ margin: "4px 0 0", color: "#4b5563" }}>
              Owner/Admin/HR only. Use Grant Access to provision logins.
            </p>
          </div>
          <button type="button" onClick={loadEmployees} style={{ ...buttonStyle, background: "#111827" }}>
            Refresh
          </button>
        </div>
        {listError ? <p style={{ color: "#b91c1c" }}>{listError}</p> : null}
        {!listError && employees.length === 0 ? (
          <p style={{ color: "#4b5563", margin: 0 }}>No employees found.</p>
        ) : null}
        {!listError && employees.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Designation</th>
                  <th style={thStyle}>Department</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Joined</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td style={tdStyle}>{emp.employee_code}</td>
                    <td style={tdStyle}>{emp.full_name}</td>
                    <td style={tdStyle}>{emp.designation || "—"}</td>
                    <td style={tdStyle}>{emp.department || "—"}</td>
                    <td style={tdStyle}>{emp.email || "—"}</td>
                    <td style={tdStyle}>{emp.role_key || "—"}</td>
                    <td style={tdStyle}>{emp.employment_status || "—"}</td>
                    <td style={tdStyle}>{formatDate(emp.joining_date)}</td>
                    <td style={tdStyle}>
                      {emp.user_id ? (
                        <span style={{ color: "#059669", fontWeight: 600 }}>Linked</span>
                      ) : (
                        <button
                          type="button"
                          style={{ ...buttonStyle, background: "#2563eb", padding: "8px 10px" }}
                          onClick={() => {
                            setTab("access");
                            setGrantEmployeeId(emp.id);
                            setGrantEmail(emp.email || "");
                          }}
                        >
                          Grant Access
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
};

export default CompanyUsersPage;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString();
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "40px 48px",
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
  paddingBottom: 24,
  marginBottom: 24,
};

const buttonStyle: CSSProperties = {
  padding: "12px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
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
  marginBottom: 12,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 15,
};

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 15,
  backgroundColor: "#fff",
};

const textAreaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 80,
  fontFamily: "inherit",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 8,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  color: "#4b5563",
  fontWeight: 600,
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

const okBox: CSSProperties = {
  background: "#ecfeff",
  border: "1px solid #bae6fd",
  color: "#0369a1",
  padding: 12,
  borderRadius: 8,
  margin: "12px 0",
};

const tabRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 12,
};

const tabButton: CSSProperties = {
  ...buttonStyle,
  background: "#e5e7eb",
  color: "#111827",
};

const tabButtonActive: CSSProperties = {
  ...buttonStyle,
  background: "#2563eb",
  color: "#fff",
};

const gridCols2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
};

const gridCols3: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};
