import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../../components/erp/ErpNavBar";
import ContactsTab from "../../../../../components/erp/hr/employee-tabs/ContactsTab";
import AddressTab from "../../../../../components/erp/hr/employee-tabs/AddressTab";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../../lib/erp/nav";
import { supabase } from "../../../../../lib/supabaseClient";

const lifecycleOptions = [
  { value: "preboarding", label: "Preboarding" },
  { value: "active", label: "Active" },
  { value: "on_notice", label: "On Notice" },
  { value: "exited", label: "Exited" },
];

const docTypeOptions = [
  { value: "photo", label: "Photo" },
  { value: "id_proof", label: "ID Proof" },
  { value: "offer_letter", label: "Offer Letter" },
  { value: "certificate", label: "Certificate" },
  { value: "other", label: "Other" },
];

export default function EmployeeProfilePage() {
  const router = useRouter();
  const employeeId = useMemo(() => {
    const param = router.query.id;
    return Array.isArray(param) ? param[0] : param;
  }, [router.query.id]);

  const [ctx, setCtx] = useState(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined });
  const [accessToken, setAccessToken] = useState("");
  const [employee, setEmployee] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [employeeList, setEmployeeList] = useState([]);
  const [masters, setMasters] = useState({
    departments: [],
    jobTitles: [],
    locations: [],
    employmentTypes: [],
  });
  const [jobForm, setJobForm] = useState({
    department_id: "",
    job_title_id: "",
    location_id: "",
    employment_type_id: "",
    manager_employee_id: "",
    lifecycle_status: "preboarding",
    exit_date: "",
  });
  const [docForm, setDocForm] = useState({ doc_type: "other", notes: "" });
  const [uploadFile, setUploadFile] = useState(null);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );
  const headerEmail = useMemo(() => {
    const workEmail = contacts.find((contact) => contact.contact_type === "work_email" && contact.email);
    if (workEmail?.email) return workEmail.email;
    const primaryEmail = contacts.find((contact) => contact.email && contact.is_primary);
    return primaryEmail?.email || "";
  }, [contacts]);

  useEffect(() => {
    let active = true;
    if (!router.isReady || !employeeId) return;

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
      setCtx(context);
      setAccessToken(session.access_token || "");

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await Promise.all([
        loadEmployee(session.access_token),
        loadMasters(session.access_token),
        loadDocuments(session.access_token),
        loadEmployeeDirectory(session.access_token),
        loadContacts(session.access_token),
      ]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady, employeeId, router]);

  async function loadEmployee(token = accessToken) {
    if (!employeeId || !token) return;
    const res = await fetch(`/api/erp/hr/employees/${employeeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to load employee");
      return;
    }
    const emp = data.employee;
    setEmployee(emp);
    setJobForm({
      department_id: emp.department_id || "",
      job_title_id: emp.job_title_id || "",
      location_id: emp.location_id || "",
      employment_type_id: emp.employment_type_id || "",
      manager_employee_id: emp.manager_employee_id || "",
      lifecycle_status: emp.lifecycle_status || "preboarding",
      exit_date: emp.exit_date ? emp.exit_date.split("T")[0] : "",
    });
  }

  async function loadMasters(token = accessToken) {
    const types = [
      ["departments", "departments"],
      ["jobTitles", "job-titles"],
      ["locations", "locations"],
      ["employmentTypes", "employment-types"],
    ];
    const results = await Promise.all(
      types.map(([stateKey, apiType]) =>
        fetch(`/api/erp/hr/masters?type=${apiType}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json().then((data) => [stateKey, data, r.ok]))
      )
    );

    setMasters((prev) => {
      const next = { ...prev };
      results.forEach(([stateKey, data, ok]) => {
        if (ok && data?.ok) {
          next[stateKey] = data.rows || [];
        }
      });
      return next;
    });
  }

  async function loadDocuments(token = accessToken) {
    if (!employeeId || !token) return;
    const res = await fetch(`/api/erp/hr/employees/documents?employee_id=${employeeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to load documents");
      return;
    }
    setDocuments(data.documents || []);
  }

  async function loadContacts(token = accessToken) {
    if (!employeeId || !token) return;
    const res = await fetch(`/api/erp/hr/employees/${employeeId}/contacts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to load contacts");
      return;
    }
    setContacts(data.contacts || []);
  }

  async function loadEmployeeDirectory(token = accessToken) {
    const res = await fetch("/api/hr/employees", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok && data?.ok) {
      setEmployeeList(data.employees || []);
    }
  }

  async function handleSaveJob(e) {
    e.preventDefault();
    if (!canManage) {
      setError("Only owner/admin/hr can update job info.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      employee_id: employeeId,
      department_id: jobForm.department_id || null,
      job_title_id: jobForm.job_title_id || null,
      location_id: jobForm.location_id || null,
      employment_type_id: jobForm.employment_type_id || null,
      manager_employee_id: jobForm.manager_employee_id || null,
      lifecycle_status: jobForm.lifecycle_status || "preboarding",
      exit_date: jobForm.exit_date || null,
    };

    const res = await fetch("/api/erp/hr/employees/job", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to update job info");
      return;
    }
    await loadEmployee();
  }

  async function handleUploadDocument(e) {
    e.preventDefault();
    if (!canManage) {
      setError("Only owner/admin/hr can upload documents.");
      return;
    }
    if (!uploadFile) {
      setError("Select a file to upload.");
      return;
    }
    setError("");
    setUploading(true);

    const uploadRes = await fetch("/api/erp/employees/documents/upload-url", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        file_name: uploadFile.name,
      }),
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.ok) {
      setUploading(false);
      setError(uploadData?.error || "Failed to create upload URL");
      return;
    }

    const putRes = await fetch(uploadData.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": uploadFile.type || "application/octet-stream" },
      body: uploadFile,
    });

    if (!putRes.ok) {
      setUploading(false);
      setError("Failed to upload file to storage");
      return;
    }

    const saveRes = await fetch("/api/erp/hr/employees/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        doc_type: docForm.doc_type,
        notes: docForm.notes || null,
        file_path: uploadData.path,
        file_name: uploadFile.name,
        mime_type: uploadFile.type || null,
        size_bytes: uploadFile.size || null,
      }),
    });

    const saveData = await saveRes.json();
    setUploading(false);
    if (!saveRes.ok || !saveData?.ok) {
      setError(saveData?.error || "Failed to save document");
      return;
    }

    setDocForm({ doc_type: "other", notes: "" });
    setUploadFile(null);
    await loadDocuments();
  }

  async function handleDeleteDocument(docId) {
    if (!canManage) return;
    const res = await fetch("/api/erp/hr/employees/documents", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_id: docId }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to delete document");
      return;
    }
    await loadDocuments();
  }

  async function handleViewDocument(docId) {
    const res = await fetch(`/api/erp/employees/documents/signed-url?document_id=${docId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok || !data.url) {
      setError(data?.error || "Failed to create signed URL");
      return;
    }
    window.open(data.url, "_blank");
  }

  const jobOptions = {
    departments: masters.departments.filter((d) => d.is_active),
    jobTitles: masters.jobTitles.filter((d) => d.is_active),
    locations: masters.locations.filter((d) => d.is_active),
    employmentTypes: masters.employmentTypes.filter((d) => d.is_active),
  };

  if (loading) {
    return <div style={containerStyle}>Loading employee…</div>;
  }

  if (!employee) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Employee</h1>
        <p style={{ color: "#b91c1c" }}>{error || "Employee not found."}</p>
        <button onClick={async () => { await supabase.auth.signOut(); router.replace("/"); }} style={dangerButtonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={ctx?.access} roleKey={ctx?.roleKey} />

      <div style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Employee</p>
          <h1 style={titleStyle}>{employee.full_name || "Employee"}</h1>
          <p style={subtitleStyle}>
            {employee.employee_code ? `#${employee.employee_code}` : ""}
            {headerEmail ? ` · ${headerEmail}` : ""}
          </p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Status: <strong>{employee.lifecycle_status || "preboarding"}</strong>{" "}
            {employee.employment_type ? `· ${employee.employment_type}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp/hr/employees" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to Employees</a>
          <a href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>HR Home</a>
        </div>
      </div>

      {error ? <div style={errorBoxStyle}>{error}</div> : null}

      <div style={tabsRowStyle}>
        {[
          ["overview", "Overview"],
          ["job", "Job"],
          ["contacts", "Contacts"],
          ["addresses", "Addresses"],
          ["documents", "Documents"],
          ["salary", "Salary"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{ ...tabButtonStyle, ...(tab === key ? tabButtonActiveStyle : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Overview</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <OverviewItem label="Email" value={headerEmail || "—"} />
            <OverviewItem label="Phone" value={employee.phone || "—"} />
            <OverviewItem label="Department" value={employee.department_name || employee.department || "—"} />
            <OverviewItem label="Job Title" value={employee.job_title || employee.designation || "—"} />
            <OverviewItem label="Location" value={employee.location_name || "—"} />
            <OverviewItem label="Employment Type" value={employee.employment_type || "—"} />
            <OverviewItem label="Lifecycle" value={employee.lifecycle_status || "preboarding"} />
            <OverviewItem label="Joining Date" value={formatDate(employee.joining_date)} />
          </div>
        </div>
      ) : null}

      {tab === "job" ? (
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Job & Reporting</h3>
            {!canManage ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
          </div>
          <form onSubmit={handleSaveJob} style={formGridStyle}>
            <label style={labelStyle}>
              Department
              <select
                value={jobForm.department_id}
                onChange={(e) => setJobForm({ ...jobForm, department_id: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              >
                <option value="">Select department</option>
                {jobOptions.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Job Title
              <select
                value={jobForm.job_title_id}
                onChange={(e) => setJobForm({ ...jobForm, job_title_id: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              >
                <option value="">Select job title</option>
                {jobOptions.jobTitles.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Location
              <select
                value={jobForm.location_id}
                onChange={(e) => setJobForm({ ...jobForm, location_id: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              >
                <option value="">Select location</option>
                {jobOptions.locations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Employment Type
              <select
                value={jobForm.employment_type_id}
                onChange={(e) => setJobForm({ ...jobForm, employment_type_id: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              >
                <option value="">Select type</option>
                {jobOptions.employmentTypes.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Manager
              <select
                value={jobForm.manager_employee_id}
                onChange={(e) => setJobForm({ ...jobForm, manager_employee_id: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              >
                <option value="">No manager</option>
                {employeeList
                  .filter((emp) => emp.id !== employee.id)
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} {emp.employee_code ? `(${emp.employee_code})` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label style={labelStyle}>
              Lifecycle Status
              <select
                value={jobForm.lifecycle_status}
                onChange={(e) => setJobForm({ ...jobForm, lifecycle_status: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              >
                {lifecycleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Exit Date
              <input
                type="date"
                value={jobForm.exit_date || ""}
                onChange={(e) => setJobForm({ ...jobForm, exit_date: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              />
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canManage || saving}>
                {saving ? "Saving…" : "Save Job"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {tab === "contacts" ? (
        <div style={panelStyle}>
          <ContactsTab
            employeeId={employeeId}
            accessToken={accessToken}
            canManage={canManage}
            initialContacts={contacts}
            onContactsUpdated={setContacts}
          />
        </div>
      ) : null}

      {tab === "addresses" ? (
        <div style={panelStyle}>
          <AddressTab employeeId={employeeId} accessToken={accessToken} canManage={canManage} />
        </div>
      ) : null}

      {tab === "documents" ? (
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Documents</h3>
            {!canManage ? <span style={{ color: "#6b7280" }}>Uploads limited to HR</span> : null}
          </div>

          {canManage ? (
            <form onSubmit={handleUploadDocument} style={formGridStyle}>
              <label style={labelStyle}>
                Document Type
                <select
                  value={docForm.doc_type}
                  onChange={(e) => setDocForm({ ...docForm, doc_type: e.target.value })}
                  style={inputStyle}
                >
                  {docTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Notes
                <input
                  type="text"
                  value={docForm.notes}
                  onChange={(e) => setDocForm({ ...docForm, notes: e.target.value })}
                  style={inputStyle}
                  placeholder="Optional note"
                />
              </label>
              <label style={labelStyle}>
                File
                <input
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  style={inputStyle}
                />
              </label>
              <div style={{ gridColumn: "1 / -1" }}>
                <button type="submit" style={primaryButtonStyle} disabled={uploading}>
                  {uploading ? "Uploading…" : "Upload Document"}
                </button>
              </div>
            </form>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <div style={tableHeaderStyle}>Documents ({documents.length})</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>File</th>
                    <th style={thStyle}>Notes</th>
                    <th style={thStyle}>Created</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td style={tdStyle}>{doc.doc_type}</td>
                      <td style={tdStyle}>{doc.file_name || doc.file_path}</td>
                      <td style={tdStyle}>{doc.notes || "—"}</td>
                      <td style={tdStyle}>{formatDate(doc.created_at)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button onClick={() => handleViewDocument(doc.id)} style={smallButtonStyle}>
                            View
                          </button>
                          {canManage ? (
                            <button onClick={() => handleDeleteDocument(doc.id)} style={smallButtonStyle}>
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "salary" ? (
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Salary</h3>
          <p style={{ color: "#6b7280" }}>Salary details will be available in a future phase.</p>
        </div>
      ) : null}
    </div>
  );
}

function OverviewItem({ label, value }) {
  return (
    <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 10 }}>
      <p style={{ margin: "0 0 4px", color: "#6b7280", fontSize: 12 }}>{label}</p>
      <p style={{ margin: 0, color: "#111827", fontWeight: 600 }}>{value}</p>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

const containerStyle = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "32px 36px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "flex-start",
  marginBottom: 14,
  flexWrap: "wrap",
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = { margin: "4px 0 8px", fontSize: 28, color: "#111827" };
const subtitleStyle = { margin: 0, color: "#4b5563", fontSize: 15 };

const tabsRowStyle = {
  display: "flex",
  gap: 8,
  marginBottom: 12,
  flexWrap: "wrap",
};

const tabButtonStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  cursor: "pointer",
};

const tabButtonActiveStyle = {
  background: "#eef2ff",
  borderColor: "#6366f1",
  color: "#312e81",
  fontWeight: 700,
};

const panelStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
};

const labelStyle = { display: "flex", flexDirection: "column", gap: 6, color: "#111827", fontWeight: 600 };

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
  marginTop: 10,
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  outline: "none",
};

const primaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #1d4ed8",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};

const dangerButtonStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #b91c1c",
  background: "#dc2626",
  color: "#fff",
  cursor: "pointer",
};

const smallButtonStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#f9fafb",
  cursor: "pointer",
};

const tableHeaderStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontWeight: 700,
};

const thStyle = { padding: 12, borderBottom: "1px solid #e5e7eb", textAlign: "left" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f3f4f6", verticalAlign: "top" };

const errorBoxStyle = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#991b1b",
};
