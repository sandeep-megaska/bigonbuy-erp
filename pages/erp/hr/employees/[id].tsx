import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import {
  Tabs,
  SectionCard,
  Pill,
  Modal,
  LabeledValue,
  buttonStyle,
  primaryButtonStyle,
  inputStyle,
  labelStyle,
  gridStyle,
} from "../../../../components/erp/EmployeeProfileUI";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../lib/erp/nav";

type EmployeeProfileResponse = {
  ok: boolean;
  employee?: {
    id: string;
    full_name: string | null;
    employee_code: string | null;
    lifecycle_status: string | null;
    status: string | null;
    joining_date: string | null;
  };
  job?: {
    id: string | null;
    effective_from: string | null;
    department_id: string | null;
    designation_id: string | null;
    grade_id: string | null;
    location_id: string | null;
    cost_center_id: string | null;
    manager_employee_id: string | null;
  } | null;
  contacts?: {
    primary_phone: string | null;
    alternate_phone: string | null;
    email: string | null;
  };
  addresses?: {
    current: AddressFormState;
    permanent: AddressFormState;
  };
  statutory?: {
    pan: string | null;
    uan: string | null;
    pf_number: string | null;
    esic_number: string | null;
    professional_tax_number: string | null;
  } | null;
  bank?: {
    restricted: boolean;
    account_holder_name: string | null;
    account_number: string | null;
    ifsc_code: string | null;
    bank_name: string | null;
  } | null;
  compensation?: {
    salary_structure_id: string | null;
    salary_structure_name: string | null;
    effective_from: string | null;
    currency: string | null;
    gross_annual: number | null;
  } | null;
  access?: {
    role_key: string | null;
    can_manage: boolean;
    can_payroll: boolean;
    can_bank: boolean;
    can_statutory: boolean;
    can_hr: boolean;
  };
  error?: string;
};

type AddressFormState = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "job", label: "Job" },
  { id: "contacts", label: "Contacts" },
  { id: "address", label: "Address" },
  { id: "statutory", label: "Statutory (India)" },
  { id: "bank", label: "Bank" },
  { id: "compensation", label: "Compensation" },
];

const emptyAddress: AddressFormState = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

const statusTone: Record<string, "green" | "yellow" | "red" | "gray" | "blue"> = {
  active: "green",
  preboarding: "blue",
  on_notice: "yellow",
  exited: "red",
  inactive: "gray",
};

export default function EmployeeProfilePage() {
  const router = useRouter();
  const employeeId = useMemo(() => {
    const param = router.query.id;
    return Array.isArray(param) ? param[0] : param;
  }, [router.query.id]);

  const [ctx, setCtx] = useState<{ roleKey?: string | null; companyId?: string | null } | null>(null);
  const [accessToken, setAccessToken] = useState<string>("");
  const [employee, setEmployee] = useState<EmployeeProfileResponse["employee"] | null>(null);
  const [job, setJob] = useState<EmployeeProfileResponse["job"] | null>(null);
  const [contacts, setContacts] = useState({ primary_phone: "", alternate_phone: "", email: "" });
  const [addresses, setAddresses] = useState({ current: { ...emptyAddress }, permanent: { ...emptyAddress } });
  const [statutory, setStatutory] = useState<EmployeeProfileResponse["statutory"] | null>(null);
  const [bank, setBank] = useState<EmployeeProfileResponse["bank"] | null>(null);
  const [compensation, setCompensation] = useState<EmployeeProfileResponse["compensation"] | null>(null);
  const [access, setAccess] = useState<EmployeeProfileResponse["access"] | null>(null);

  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [compModalOpen, setCompModalOpen] = useState(false);
  const [jobForm, setJobForm] = useState({
    effective_from: "",
    department_id: "",
    designation_id: "",
    grade_id: "",
    location_id: "",
    cost_center_id: "",
    manager_employee_id: "",
  });
  const [compForm, setCompForm] = useState({
    effective_from: "",
    salary_structure_id: "",
    currency: "INR",
    gross_annual: "",
    notes: "",
  });

  const [masters, setMasters] = useState({
    departments: [],
    designations: [],
    grades: [],
    locations: [],
    costCenters: [],
    managers: [],
    salaryStructures: [],
  });

  const canManage = Boolean(access?.can_manage || isHr(ctx?.roleKey));
  const canPayroll = Boolean(access?.can_payroll);
  const canBank = Boolean(access?.can_bank);
  const canStatutory = Boolean(access?.can_statutory);
  const canHr = Boolean(access?.can_hr);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!router.isReady || !employeeId) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;

      setAccessToken(session.access_token || "");
      setCtx({ roleKey: accessState.roleKey ?? context.roleKey ?? null, companyId: context.companyId });

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }

      await Promise.all([loadProfile(session.access_token), loadMasters(session.access_token)]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [employeeId, router]);

  async function loadProfile(token: string) {
    if (!employeeId) return;
    const res = await fetch(`/api/erp/hr/employees/${employeeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as EmployeeProfileResponse;
    if (!res.ok || !data.ok) {
      setError(data.error || "Failed to load employee profile");
      return;
    }

    setEmployee(data.employee ?? null);
    setJob(data.job ?? null);
    setContacts({
      primary_phone: data.contacts?.primary_phone ?? "",
      alternate_phone: data.contacts?.alternate_phone ?? "",
      email: data.contacts?.email ?? "",
    });
    setAddresses({
      current: normalizeAddress(data.addresses?.current),
      permanent: normalizeAddress(data.addresses?.permanent),
    });
    setStatutory(data.statutory ?? null);
    setBank(data.bank ?? null);
    setCompensation(data.compensation ?? null);
    setAccess(data.access ?? null);

    setJobForm({
      effective_from: "",
      department_id: data.job?.department_id ?? "",
      designation_id: data.job?.designation_id ?? "",
      grade_id: data.job?.grade_id ?? "",
      location_id: data.job?.location_id ?? "",
      cost_center_id: data.job?.cost_center_id ?? "",
      manager_employee_id: data.job?.manager_employee_id ?? "",
    });
  }

  async function loadMasters(token: string) {
    const masterTypes = [
      ["departments", "departments"],
      ["designations", "designations"],
      ["grades", "grades"],
      ["locations", "locations"],
      ["costCenters", "cost-centers"],
      ["salaryStructures", "salary-structures"],
    ] as const;

    const [managerRes, ...masterResponses] = await Promise.all([
      fetch("/api/hr/employees", { headers: { Authorization: `Bearer ${token}` } }),
      ...masterTypes.map(([_, apiType]) =>
        fetch(`/api/erp/hr/masters?type=${apiType}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ),
    ]);

    if (managerRes.ok) {
      const managerData = await managerRes.json();
      setMasters((prev) => ({ ...prev, managers: managerData.employees || [] }));
    }

    const masterResults = await Promise.all(masterResponses.map((res) => res.json()));
    setMasters((prev) => {
      const next = { ...prev } as typeof prev;
      masterResults.forEach((data, index) => {
        const [stateKey] = masterTypes[index];
        if (data?.ok) {
          next[stateKey] = data.rows || [];
        }
      });
      return next;
    });
  }

  async function handleSaveContacts() {
    if (!canManage) {
      setError("Only owner/admin/hr can update contacts.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/erp/hr/employees/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        primary_phone: contacts.primary_phone,
        alternate_phone: contacts.alternate_phone,
        email: contacts.email,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data.ok) {
      setError(data.error || "Failed to update contacts");
      return;
    }
    await loadProfile(accessToken);
  }

  async function handleSaveAddresses() {
    if (!canManage) {
      setError("Only owner/admin/hr can update addresses.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/erp/hr/employees/addresses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        current: addresses.current,
        permanent: addresses.permanent,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data.ok) {
      setError(data.error || "Failed to update addresses");
      return;
    }
    await loadProfile(accessToken);
  }

  async function handleSaveJob() {
    if (!canManage) {
      setError("Only owner/admin/hr can update job info.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/erp/hr/employees/job-assignment", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        effective_from: jobForm.effective_from || null,
        department_id: jobForm.department_id || null,
        designation_id: jobForm.designation_id || null,
        grade_id: jobForm.grade_id || null,
        location_id: jobForm.location_id || null,
        cost_center_id: jobForm.cost_center_id || null,
        manager_employee_id: jobForm.manager_employee_id || null,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data.ok) {
      setError(data.error || "Failed to add job assignment");
      return;
    }
    setJobModalOpen(false);
    await loadProfile(accessToken);
  }

  async function handleSaveCompensation() {
    if (!canPayroll) {
      setError("Only owner/admin/payroll can assign compensation.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/erp/hr/employees/compensation", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        effective_from: compForm.effective_from || null,
        salary_structure_id: compForm.salary_structure_id || null,
        currency: compForm.currency || "INR",
        gross_annual: compForm.gross_annual ? Number(compForm.gross_annual) : null,
        notes: compForm.notes || null,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok || !data.ok) {
      setError(data.error || "Failed to assign compensation");
      return;
    }
    setCompModalOpen(false);
    await loadProfile(accessToken);
  }

  function resolveLabel(list: Array<{ id?: string; name?: string; title?: string }>, id: string | null | undefined) {
    if (!id) return "—";
    const match = list.find((item) => item.id === id);
    return match?.name || match?.title || "—";
  }

  function formatDate(value?: string | null) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  function maskAccountNumber(value?: string | null) {
    if (!value) return "••••••";
    const trimmed = value.replace(/\s+/g, "");
    if (trimmed.length <= 4) return "••••";
    return `••••${trimmed.slice(-4)}`;
  }

  if (loading) {
    return <div style={pageStyle}>Loading employee profile…</div>;
  }

  if (!employee) {
    return (
      <div style={pageStyle}>
        <ErpNavBar roleKey={ctx?.roleKey ?? undefined} />
        <div style={{ marginTop: 24 }}>
          <a href="/erp/hr/employees" style={linkStyle}>← Back to Employees</a>
          <h1 style={{ marginTop: 12 }}>Employee Profile</h1>
          <p style={{ color: "#b91c1c" }}>{error || "Employee not found."}</p>
        </div>
      </div>
    );
  }

  const lifecycleStatus = employee.lifecycle_status || employee.status || "preboarding";

  return (
    <div style={pageStyle}>
      <ErpNavBar roleKey={ctx?.roleKey ?? undefined} />
      <div style={{ marginTop: 16 }}>
        <a href="/erp/hr/employees" style={linkStyle}>← Back to Employees</a>
      </div>
      <header style={headerStyle}>
        <div>
          <h1 style={{ margin: "8px 0" }}>{employee.full_name || "Unnamed employee"}</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: "#6b7280" }}>Employee ID: {employee.employee_code || "—"}</span>
            <Pill label={lifecycleStatus.replace(/_/g, " ")} tone={statusTone[lifecycleStatus] || "gray"} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {canManage ? (
            <button type="button" style={buttonStyle} onClick={() => setJobModalOpen(true)}>
              Change assignment
            </button>
          ) : null}
          {canPayroll ? (
            <button type="button" style={primaryButtonStyle} onClick={() => setCompModalOpen(true)}>
              Assign compensation
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div style={{ ...alertStyle, background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
          {error}
        </div>
      ) : null}

      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
        {activeTab === "overview" ? (
          <>
            <SectionCard title="Basic information" subtitle="Core profile essentials">
              <div style={gridStyle}>
                <LabeledValue label="Full name" value={employee.full_name || "—"} />
                <LabeledValue label="Employee ID" value={employee.employee_code || "—"} />
                <LabeledValue label="Lifecycle status" value={lifecycleStatus.replace(/_/g, " ")} />
                <LabeledValue label="Date of joining" value={formatDate(employee.joining_date)} />
              </div>
            </SectionCard>

            <SectionCard title="Current assignment" subtitle="Effective-dated job snapshot">
              <div style={gridStyle}>
                <LabeledValue
                  label="Department"
                  value={resolveLabel(masters.departments, job?.department_id)}
                />
                <LabeledValue
                  label="Designation"
                  value={resolveLabel(masters.designations, job?.designation_id)}
                />
                <LabeledValue label="Grade" value={resolveLabel(masters.grades, job?.grade_id)} />
                <LabeledValue
                  label="Location"
                  value={resolveLabel(masters.locations, job?.location_id)}
                />
                <LabeledValue
                  label="Cost center"
                  value={resolveLabel(masters.costCenters, job?.cost_center_id)}
                />
                <LabeledValue label="Manager" value={resolveManagerName(masters.managers, job?.manager_employee_id)} />
              </div>
            </SectionCard>
          </>
        ) : null}

        {activeTab === "job" ? (
          <SectionCard
            title="Job assignment"
            subtitle="Most recent effective-dated assignment"
            actions={
              canManage ? (
                <button type="button" style={buttonStyle} onClick={() => setJobModalOpen(true)}>
                  Change assignment
                </button>
              ) : null
            }
          >
            <div style={gridStyle}>
              <LabeledValue label="Effective from" value={formatDate(job?.effective_from)} />
              <LabeledValue label="Department" value={resolveLabel(masters.departments, job?.department_id)} />
              <LabeledValue label="Designation" value={resolveLabel(masters.designations, job?.designation_id)} />
              <LabeledValue label="Grade" value={resolveLabel(masters.grades, job?.grade_id)} />
              <LabeledValue label="Location" value={resolveLabel(masters.locations, job?.location_id)} />
              <LabeledValue label="Cost center" value={resolveLabel(masters.costCenters, job?.cost_center_id)} />
              <LabeledValue label="Manager" value={resolveManagerName(masters.managers, job?.manager_employee_id)} />
            </div>
          </SectionCard>
        ) : null}

        {activeTab === "contacts" ? (
          <SectionCard
            title="Contact details"
            subtitle="Primary contact and alternate phone"
            actions={
              <button type="button" style={buttonStyle} onClick={handleSaveContacts} disabled={saving || !canManage}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            }
          >
            <form onSubmit={(event) => event.preventDefault()}>
              <div style={gridStyle}>
                <label>
                  <div style={labelStyle}>Primary phone</div>
                  <input
                    style={inputStyle}
                    value={contacts.primary_phone}
                    onChange={(e) => setContacts((prev) => ({ ...prev, primary_phone: e.target.value }))}
                    placeholder="e.g., +91 98765 43210"
                    disabled={!canManage}
                  />
                </label>
                <label>
                  <div style={labelStyle}>Alternate phone</div>
                  <input
                    style={inputStyle}
                    value={contacts.alternate_phone}
                    onChange={(e) => setContacts((prev) => ({ ...prev, alternate_phone: e.target.value }))}
                    placeholder="Optional"
                    disabled={!canManage}
                  />
                </label>
                <label>
                  <div style={labelStyle}>Email</div>
                  <input
                    style={inputStyle}
                    value={contacts.email}
                    onChange={(e) => setContacts((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="name@example.com"
                    type="email"
                    disabled={!canManage}
                  />
                </label>
              </div>
            </form>
            {!canManage ? (
              <p style={{ marginTop: 12, color: "#6b7280", fontSize: 13 }}>
                You have read-only access to contact information.
              </p>
            ) : null}
          </SectionCard>
        ) : null}

        {activeTab === "address" ? (
          <SectionCard
            title="Address information"
            subtitle="Permanent and current address"
            actions={
              <button type="button" style={buttonStyle} onClick={handleSaveAddresses} disabled={saving || !canManage}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            }
          >
            <form onSubmit={(event) => event.preventDefault()}>
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ ...sectionPanelStyle }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Current address</div>
                  <div style={gridStyle}>
                    {renderAddressFields(
                      addresses.current,
                      (next) => setAddresses((prev) => ({ ...prev, current: next })),
                      !canManage
                    )}
                  </div>
                </div>
                <div style={{ ...sectionPanelStyle }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Permanent address</div>
                  <div style={gridStyle}>
                    {renderAddressFields(
                      addresses.permanent,
                      (next) => setAddresses((prev) => ({ ...prev, permanent: next })),
                      !canManage
                    )}
                  </div>
                </div>
              </div>
            </form>
            {!canManage ? (
              <p style={{ marginTop: 12, color: "#6b7280", fontSize: 13 }}>
                You have read-only access to addresses.
              </p>
            ) : null}
          </SectionCard>
        ) : null}

        {activeTab === "statutory" ? (
          <SectionCard title="Statutory identifiers" subtitle="India-ready compliance details">
            {!canStatutory ? (
              <div style={emptyStateStyle}>No access to statutory details.</div>
            ) : statutory ? (
              <div style={gridStyle}>
                <LabeledValue label="PAN" value={statutory.pan || "—"} />
                <LabeledValue label="UAN" value={statutory.uan || "—"} />
                <LabeledValue label="PF Number" value={statutory.pf_number || "—"} />
                <LabeledValue label="ESIC" value={statutory.esic_number || "—"} />
                <LabeledValue label="Professional Tax" value={statutory.professional_tax_number || "—"} />
              </div>
            ) : (
              <div style={emptyStateStyle}>Coming soon.</div>
            )}
          </SectionCard>
        ) : null}

        {activeTab === "bank" ? (
          <SectionCard title="Bank details" subtitle="Restricted payroll data">
            {canBank ? (
              <div style={gridStyle}>
                <LabeledValue label="Account holder" value={bank?.account_holder_name || "—"} />
                <LabeledValue label="Account number" value={maskAccountNumber(bank?.account_number)} />
                <LabeledValue label="IFSC" value={bank?.ifsc_code || "—"} />
                <LabeledValue label="Bank name" value={bank?.bank_name || "—"} />
              </div>
            ) : canHr ? (
              <div style={gridStyle}>
                <LabeledValue label="Account holder" value="Restricted" />
                <LabeledValue label="Account number" value={maskAccountNumber(bank?.account_number)} />
                <LabeledValue label="IFSC" value="Restricted" />
                <LabeledValue label="Bank name" value="Restricted" />
              </div>
            ) : (
              <div style={emptyStateStyle}>No access to bank details.</div>
            )}
            {canHr && !canBank ? (
              <p style={{ marginTop: 12, color: "#6b7280", fontSize: 13 }}>
                HR can view masked bank details only. Payroll, owner, or admin access is required for edits.
              </p>
            ) : null}
          </SectionCard>
        ) : null}

        {activeTab === "compensation" ? (
          <SectionCard
            title="Compensation"
            subtitle="Current salary structure assignment"
            actions={
              canPayroll ? (
                <button type="button" style={buttonStyle} onClick={() => setCompModalOpen(true)}>
                  Assign compensation
                </button>
              ) : null
            }
          >
            {canPayroll ? (
              <div style={gridStyle}>
                <LabeledValue
                  label="Salary structure"
                  value={compensation?.salary_structure_name || compensation?.salary_structure_id || "—"}
                />
                <LabeledValue label="Effective from" value={formatDate(compensation?.effective_from)} />
                <LabeledValue label="Currency" value={compensation?.currency || "—"} />
                <LabeledValue
                  label="Gross annual"
                  value={compensation?.gross_annual ? `₹${Number(compensation.gross_annual).toLocaleString("en-IN")}` : "—"}
                />
              </div>
            ) : (
              <div style={emptyStateStyle}>No access to compensation details.</div>
            )}
          </SectionCard>
        ) : null}
      </div>

      {jobModalOpen ? (
        <Modal
          title="Change assignment"
          onClose={() => setJobModalOpen(false)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button type="button" style={buttonStyle} onClick={() => setJobModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={primaryButtonStyle} onClick={handleSaveJob} disabled={saving}>
                {saving ? "Saving…" : "Save assignment"}
              </button>
            </div>
          }
        >
          <form onSubmit={(event) => event.preventDefault()}>
            <div style={gridStyle}>
              <label>
                <div style={labelStyle}>Effective from</div>
                <input
                  style={inputStyle}
                  type="date"
                  value={jobForm.effective_from}
                  onChange={(e) => setJobForm((prev) => ({ ...prev, effective_from: e.target.value }))}
                />
              </label>
              {renderSelect("Department", jobForm.department_id, masters.departments, (value) =>
                setJobForm((prev) => ({ ...prev, department_id: value }))
              )}
              {renderSelect("Designation", jobForm.designation_id, masters.designations, (value) =>
                setJobForm((prev) => ({ ...prev, designation_id: value }))
              )}
              {renderSelect("Grade", jobForm.grade_id, masters.grades, (value) =>
                setJobForm((prev) => ({ ...prev, grade_id: value }))
              )}
              {renderSelect("Location", jobForm.location_id, masters.locations, (value) =>
                setJobForm((prev) => ({ ...prev, location_id: value }))
              )}
              {renderSelect("Cost center", jobForm.cost_center_id, masters.costCenters, (value) =>
                setJobForm((prev) => ({ ...prev, cost_center_id: value }))
              )}
              <label>
                <div style={labelStyle}>Manager</div>
                <select
                  style={inputStyle}
                  value={jobForm.manager_employee_id}
                  onChange={(e) => setJobForm((prev) => ({ ...prev, manager_employee_id: e.target.value }))}
                >
                  <option value="">No manager</option>
                  {masters.managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p style={{ marginTop: 12, color: "#6b7280", fontSize: 13 }}>
              A new effective-dated assignment will be created to preserve history.
            </p>
          </form>
        </Modal>
      ) : null}

      {compModalOpen ? (
        <Modal
          title="Assign compensation"
          onClose={() => setCompModalOpen(false)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button type="button" style={buttonStyle} onClick={() => setCompModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={primaryButtonStyle} onClick={handleSaveCompensation} disabled={saving}>
                {saving ? "Saving…" : "Assign"}
              </button>
            </div>
          }
        >
          <form onSubmit={(event) => event.preventDefault()}>
            <div style={gridStyle}>
              <label>
                <div style={labelStyle}>Effective from</div>
                <input
                  style={inputStyle}
                  type="date"
                  value={compForm.effective_from}
                  onChange={(e) => setCompForm((prev) => ({ ...prev, effective_from: e.target.value }))}
                />
              </label>
              <label>
                <div style={labelStyle}>Salary structure</div>
                <select
                  style={inputStyle}
                  value={compForm.salary_structure_id}
                  onChange={(e) => setCompForm((prev) => ({ ...prev, salary_structure_id: e.target.value }))}
                >
                  <option value="">Select structure</option>
                  {masters.salaryStructures.map((structure) => (
                    <option key={structure.id} value={structure.id}>
                      {structure.name || structure.code || structure.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div style={labelStyle}>Currency</div>
                <input
                  style={inputStyle}
                  value={compForm.currency}
                  onChange={(e) => setCompForm((prev) => ({ ...prev, currency: e.target.value }))}
                />
              </label>
              <label>
                <div style={labelStyle}>Gross annual</div>
                <input
                  style={inputStyle}
                  type="number"
                  value={compForm.gross_annual}
                  onChange={(e) => setCompForm((prev) => ({ ...prev, gross_annual: e.target.value }))}
                />
              </label>
              <label>
                <div style={labelStyle}>Notes</div>
                <textarea
                  style={{ ...inputStyle, minHeight: 80 }}
                  value={compForm.notes}
                  onChange={(e) => setCompForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </label>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function resolveManagerName(
  managers: Array<{ id?: string; full_name?: string }>,
  managerId?: string | null
) {
  if (!managerId) return "—";
  return managers.find((manager) => manager.id === managerId)?.full_name || "—";
}

function renderSelect(
  label: string,
  value: string,
  options: Array<{ id?: string; name?: string; title?: string }>,
  onChange: (value: string) => void
) {
  return (
    <label>
      <div style={labelStyle}>{label}</div>
      <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name || option.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function renderAddressFields(
  address: AddressFormState,
  onChange: (next: AddressFormState) => void,
  disabled = false
) {
  return (
    <>
      <label>
        <div style={labelStyle}>Address line 1</div>
        <input
          style={inputStyle}
          value={address.line1}
          onChange={(e) => onChange({ ...address, line1: e.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <div style={labelStyle}>Address line 2</div>
        <input
          style={inputStyle}
          value={address.line2}
          onChange={(e) => onChange({ ...address, line2: e.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <div style={labelStyle}>City</div>
        <input
          style={inputStyle}
          value={address.city}
          onChange={(e) => onChange({ ...address, city: e.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <div style={labelStyle}>State</div>
        <input
          style={inputStyle}
          value={address.state}
          onChange={(e) => onChange({ ...address, state: e.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <div style={labelStyle}>Postal code</div>
        <input
          style={inputStyle}
          value={address.postal_code}
          onChange={(e) => onChange({ ...address, postal_code: e.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <div style={labelStyle}>Country</div>
        <input
          style={inputStyle}
          value={address.country}
          onChange={(e) => onChange({ ...address, country: e.target.value })}
          disabled={disabled}
        />
      </label>
    </>
  );
}

function normalizeAddress(input?: Partial<AddressFormState> | null): AddressFormState {
  if (!input) return { ...emptyAddress };
  return {
    line1: input.line1 ?? "",
    line2: input.line2 ?? "",
    city: input.city ?? "",
    state: input.state ?? "",
    postal_code: input.postal_code ?? "",
    country: input.country ?? "",
  };
}

const pageStyle: React.CSSProperties = {
  padding: "32px 32px 80px",
  background: "#f8fafc",
  minHeight: "100vh",
};

const headerStyle: React.CSSProperties = {
  marginTop: 8,
  marginBottom: 20,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 16,
};

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 600,
};

const alertStyle: React.CSSProperties = {
  border: "1px solid",
  borderRadius: 12,
  padding: 12,
  marginTop: 16,
};

const sectionPanelStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: 16,
  background: "#f9fafb",
};

const emptyStateStyle: React.CSSProperties = {
  border: "1px dashed #e5e7eb",
  borderRadius: 12,
  padding: 18,
  color: "#6b7280",
  background: "#f9fafb",
};
