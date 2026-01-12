import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import {
  assignManager,
  assignUserRole,
  linkUser,
  listEmployees,
  listManagers,
  upsertEmployee,
} from "../../../lib/hrEmployeesApi";
import { supabase } from "../../../lib/supabaseClient";

const ROLE_OPTIONS = [
  { label: "Owner", value: "owner" },
  { label: "Admin", value: "admin" },
  { label: "HR", value: "hr" },
  { label: "Employee", value: "employee" },
];

function Banner({ tone = "info", title, children, onDismiss }) {
  const theme =
    tone === "error"
      ? { bg: "#fef2f2", border: "#fecaca", color: "#991b1b" }
      : tone === "success"
      ? { bg: "#ecfdf3", border: "#bbf7d0", color: "#166534" }
      : { bg: "#eff6ff", border: "#bfdbfe", color: "#1e40af" };

  return (
    <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, color: theme.color, borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          {title ? <strong style={{ display: "block", marginBottom: 4 }}>{title}</strong> : null}
          <div>{children}</div>
        </div>
        {onDismiss ? (
          <button onClick={onDismiss} style={linkButtonStyle}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          <button onClick={onClose} style={linkButtonStyle}>Close</button>
        </div>
        <div style={{ marginTop: 16 }}>{children}</div>
        {footer ? <div style={{ marginTop: 20 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

function ActionMenu({ actions, disabled }) {
  return (
    <details style={{ position: "relative", display: "inline-block" }} disabled={disabled}>
      <summary style={actionButtonStyle}>Actions</summary>
      <div style={menuStyle}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            style={menuItemStyle}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export default function HrEmployeesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [employees, setEmployees] = useState([]);
  const [managers, setManagers] = useState([]);
  const [search, setSearch] = useState("");

  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({
    id: null,
    full_name: "",
    employee_code: "",
    is_active: true,
  });

  const [managerModal, setManagerModal] = useState({ open: false, employee: null, managerId: "" });
  const [roleModal, setRoleModal] = useState({ open: false, employee: null, roleKey: "" });
  const [linkModal, setLinkModal] = useState({ open: false, employee: null, userId: "" });

  const canManage = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => {
      return [
        employee.full_name,
        employee.employee_code,
        employee.email,
        employee.role_key,
        employee.manager_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [employees, search]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;
      setCtx(context);

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await refreshData();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function refreshData() {
    setIsRefreshing(true);
    setError("");
    const [{ data: employeeData, error: employeeError }, { data: managerData, error: managerError }] =
      await Promise.all([listEmployees(), listManagers()]);

    if (employeeError) {
      setError(employeeError.message || "Unable to load employees.");
    } else {
      setEmployees(employeeData);
    }

    if (managerError) {
      setError((prev) => prev || managerError.message || "Unable to load managers.");
    } else {
      setManagers(managerData);
    }
    setIsRefreshing(false);
  }

  function openAddModal() {
    setEmployeeForm({ id: null, full_name: "", employee_code: "", is_active: true });
    setEmployeeModalOpen(true);
  }

  function openEditModal(employee) {
    setEmployeeForm({
      id: employee.id,
      full_name: employee.full_name || "",
      employee_code: employee.employee_code || "",
      is_active: employee.is_active ?? true,
    });
    setEmployeeModalOpen(true);
  }

  async function handleSaveEmployee() {
    if (!employeeForm.full_name.trim()) {
      setError("Full name is required.");
      return;
    }

    setError("");
    setSuccess("");
    const { error: upsertError } = await upsertEmployee({
      id: employeeForm.id,
      full_name: employeeForm.full_name.trim(),
      employee_code: employeeForm.id ? employeeForm.employee_code.trim() || null : null,
      is_active: employeeForm.is_active,
    });

    if (upsertError) {
      setError(upsertError.message || "Unable to save employee.");
      return;
    }

    setEmployeeModalOpen(false);
    setSuccess(employeeForm.id ? "Employee updated successfully." : "Employee added successfully.");
    await refreshData();
  }

  function openManagerModal(employee) {
    setManagerModal({
      open: true,
      employee,
      managerId: employee.manager_employee_id || "",
    });
  }

  async function handleAssignManager() {
    if (!managerModal.employee) return;
    setError("");
    setSuccess("");
    const { error: assignError } = await assignManager(
      managerModal.employee.id,
      managerModal.managerId || null
    );
    if (assignError) {
      setError(assignError.message || "Unable to assign manager.");
      return;
    }
    setManagerModal({ open: false, employee: null, managerId: "" });
    setSuccess("Manager assignment updated.");
    await refreshData();
  }

  function openRoleModal(employee) {
    setRoleModal({
      open: true,
      employee,
      roleKey: employee.role_key || "employee",
    });
  }

  async function handleAssignRole() {
    if (!roleModal.employee?.user_id) {
      setError("Link a user before assigning a role.");
      return;
    }
    setError("");
    setSuccess("");
    const { error: roleError } = await assignUserRole(roleModal.employee.user_id, roleModal.roleKey);
    if (roleError) {
      setError(roleError.message || "Unable to assign role.");
      return;
    }
    setRoleModal({ open: false, employee: null, roleKey: "" });
    setSuccess("Role updated successfully.");
    await refreshData();
  }

  function openLinkModal(employee) {
    setLinkModal({ open: true, employee, userId: employee.user_id || "" });
  }

  async function handleLinkUser() {
    if (!linkModal.employee) return;
    const userId = linkModal.userId.trim();
    if (!userId) {
      setError("User ID is required to link.");
      return;
    }
    setError("");
    setSuccess("");
    const { error: linkError } = await linkUser(linkModal.employee.id, userId);
    if (linkError) {
      setError(linkError.message || "Unable to link user.");
      return;
    }
    setLinkModal({ open: false, employee: null, userId: "" });
    setSuccess("User linked successfully.");
    await refreshData();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) return <div style={pageStyle}>Loading employees…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={pageStyle}>
        <h1 style={{ marginTop: 0 }}>Employees</h1>
        <p style={{ color: "#b91c1c" }}>{error || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <ErpNavBar roleKey={ctx?.roleKey} />
      <header style={headerStyle}>
        <div>
          <h1 style={{ margin: 0 }}>Employees</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Manage employee profiles and access.</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {canManage ? (
            <button type="button" onClick={openAddModal} style={primaryButtonStyle}>
              Add Employee
            </button>
          ) : null}
          <a href="/erp/hr" style={linkStyle}>← HR Home</a>
          <a href="/erp" style={linkStyle}>ERP Home</a>
        </div>
      </header>

      <div style={{ display: "grid", gap: 12 }}>
        {error ? <Banner tone="error" title="Something went wrong" onDismiss={() => setError("")}>{error}</Banner> : null}
        {success ? <Banner tone="success" title="Success" onDismiss={() => setSuccess("")}>{success}</Banner> : null}
      </div>

      <section style={panelStyle}>
        <div style={panelHeaderStyle}>
          <div>
            <h3 style={{ margin: 0 }}>Employee Directory</h3>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
              {isRefreshing ? "Refreshing data…" : `${filteredEmployees.length} employees`}
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, code, manager, email, role…"
            style={searchInputStyle}
          />
        </div>

        {!filteredEmployees.length ? (
          <div style={emptyStateStyle}>
            <h4 style={{ marginTop: 0 }}>No employees found</h4>
            <p style={{ margin: 0, color: "#6b7280" }}>
              {search.trim()
                ? "Try adjusting your search keywords or clear the filter."
                : "Add your first employee to start building the directory."}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Employee Code</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Manager</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => (
                  <tr key={employee.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{employee.full_name || "Unnamed employee"}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{employee.email || "No email on file"}</div>
                    </td>
                    <td style={tdStyle}>{employee.employee_code || "—"}</td>
                    <td style={tdStyle}>
                      <span style={pillStyle(employee.role_key ? "blue" : "gray")}>
                        {employee.role_key || "unassigned"}
                      </span>
                    </td>
                    <td style={tdStyle}>{employee.manager_name || "—"}</td>
                    <td style={tdStyle}>
                      <span style={pillStyle(employee.is_active ? "green" : "red")}>
                        {employee.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {canManage ? (
                        <ActionMenu
                          actions={[
                            {
                              label: "Edit employee",
                              onClick: () => openEditModal(employee),
                            },
                            {
                              label: "Assign manager",
                              onClick: () => openManagerModal(employee),
                            },
                            {
                              label: "Assign role",
                              onClick: () => openRoleModal(employee),
                            },
                            {
                              label: "Link user",
                              onClick: () => openLinkModal(employee),
                            },
                          ]}
                        />
                      ) : (
                        <span style={{ color: "#6b7280", fontSize: 13 }}>Read-only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {employeeModalOpen ? (
        <Modal
          title={employeeForm.id ? "Edit Employee" : "Add Employee"}
          onClose={() => setEmployeeModalOpen(false)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setEmployeeModalOpen(false)} style={buttonStyle}>Cancel</button>
              <button onClick={handleSaveEmployee} style={primaryButtonStyle}>
                {employeeForm.id ? "Save Changes" : "Create Employee"}
              </button>
            </div>
          }
        >
          <div style={formGridStyle}>
            <label style={labelStyle}>
              Full name
              <input
                value={employeeForm.full_name}
                onChange={(event) => setEmployeeForm({ ...employeeForm, full_name: event.target.value })}
                placeholder="Jane Doe"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Employee code
              <input
                value={employeeForm.employee_code}
                placeholder="BB000001"
                style={{ ...inputStyle, backgroundColor: "#f3f4f6" }}
                readOnly
              />
              <span style={{ color: "#6b7280", fontSize: 12 }}>
                Employee ID will be auto-generated (BB000001).
              </span>
            </label>
            <label style={labelStyle}>
              Status
              <select
                value={employeeForm.is_active ? "active" : "inactive"}
                onChange={(event) =>
                  setEmployeeForm({ ...employeeForm, is_active: event.target.value === "active" })
                }
                style={inputStyle}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
        </Modal>
      ) : null}

      {managerModal.open ? (
        <Modal
          title="Assign Manager"
          onClose={() => setManagerModal({ open: false, employee: null, managerId: "" })}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setManagerModal({ open: false, employee: null, managerId: "" })} style={buttonStyle}>
                Cancel
              </button>
              <button onClick={handleAssignManager} style={primaryButtonStyle}>Save</button>
            </div>
          }
        >
          <p style={{ marginTop: 0 }}>
            Update manager for <strong>{managerModal.employee?.full_name}</strong>.
          </p>
          <label style={labelStyle}>
            Manager
            <select
              value={managerModal.managerId}
              onChange={(event) => setManagerModal({ ...managerModal, managerId: event.target.value })}
              style={inputStyle}
            >
              <option value="">No manager</option>
              {managers
                .filter((manager) => manager.id !== managerModal.employee?.id)
                .map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.full_name || manager.id}
                  </option>
                ))}
            </select>
          </label>
        </Modal>
      ) : null}

      {roleModal.open ? (
        <Modal
          title="Assign Role"
          onClose={() => setRoleModal({ open: false, employee: null, roleKey: "" })}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setRoleModal({ open: false, employee: null, roleKey: "" })} style={buttonStyle}>
                Cancel
              </button>
              <button onClick={handleAssignRole} style={primaryButtonStyle} disabled={!roleModal.employee?.user_id}>
                Save Role
              </button>
            </div>
          }
        >
          <p style={{ marginTop: 0 }}>
            Assign a company role to <strong>{roleModal.employee?.full_name}</strong>.
          </p>
          {!roleModal.employee?.user_id ? (
            <Banner tone="info" title="User not linked">
              Link this employee to an auth user before assigning a role.
            </Banner>
          ) : (
            <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
              Linked user: <code>{roleModal.employee?.user_id}</code>
            </p>
          )}
          <label style={labelStyle}>
            Role
            <select
              value={roleModal.roleKey}
              onChange={(event) => setRoleModal({ ...roleModal, roleKey: event.target.value })}
              style={inputStyle}
              disabled={!roleModal.employee?.user_id}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        </Modal>
      ) : null}

      {linkModal.open ? (
        <Modal
          title="Link User"
          onClose={() => setLinkModal({ open: false, employee: null, userId: "" })}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setLinkModal({ open: false, employee: null, userId: "" })} style={buttonStyle}>
                Cancel
              </button>
              <button onClick={handleLinkUser} style={primaryButtonStyle}>Link User</button>
            </div>
          }
        >
          <p style={{ marginTop: 0 }}>
            Connect <strong>{linkModal.employee?.full_name}</strong> to a Supabase user.
          </p>
          <label style={labelStyle}>
            User ID (UUID)
            <input
              value={linkModal.userId}
              onChange={(event) => setLinkModal({ ...linkModal, userId: event.target.value })}
              placeholder="00000000-0000-0000-0000-000000000000"
              style={inputStyle}
            />
          </label>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 12 }}>
            Linking a user also grants the employee role if they do not already have access.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

const pageStyle = { padding: 24, fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" };
const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "flex-start",
  marginBottom: 18,
};
const panelStyle = {
  marginTop: 18,
  padding: 16,
  border: "1px solid #eee",
  borderRadius: 12,
  background: "#fff",
};
const panelHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: 12,
};
const emptyStateStyle = {
  border: "1px dashed #e5e7eb",
  borderRadius: 12,
  padding: 24,
  textAlign: "center",
};
const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};
const labelStyle = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 };
const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 };
const searchInputStyle = { ...inputStyle, minWidth: 240 };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db", cursor: "pointer", background: "#fff" };
const primaryButtonStyle = {
  ...buttonStyle,
  backgroundColor: "#2563eb",
  color: "#fff",
  border: "1px solid #1d4ed8",
};
const linkButtonStyle = { background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 };
const linkStyle = { color: "#2563eb", textDecoration: "none" };
const actionButtonStyle = {
  listStyle: "none",
  cursor: "pointer",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontWeight: 600,
};
const menuStyle = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 6px)",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  boxShadow: "0 8px 20px rgba(15,23,42,0.15)",
  padding: 8,
  minWidth: 180,
  display: "grid",
  gap: 6,
  zIndex: 20,
};
const menuItemStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "#f9fafb",
  cursor: "pointer",
  textAlign: "left",
  fontWeight: 600,
};
const thStyle = { padding: 12, borderBottom: "1px solid #e5e7eb", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6b7280" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f3f4f6", verticalAlign: "top" };
const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.4)",
  display: "grid",
  placeItems: "center",
  zIndex: 50,
  padding: 16,
};
const modalStyle = {
  background: "#fff",
  borderRadius: 16,
  padding: 24,
  maxWidth: 640,
  width: "100%",
  boxShadow: "0 24px 40px rgba(15,23,42,0.2)",
};

function pillStyle(tone) {
  if (tone === "green") {
    return { background: "#dcfce7", color: "#166534", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 600 };
  }
  if (tone === "red") {
    return { background: "#fee2e2", color: "#991b1b", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 600 };
  }
  if (tone === "blue") {
    return { background: "#dbeafe", color: "#1e40af", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 600 };
  }
  return { background: "#f3f4f6", color: "#374151", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 600 };
}
