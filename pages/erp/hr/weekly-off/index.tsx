import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties, FormEvent } from "react";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { listEmployees, type HrEmployee } from "../../../../lib/hrEmployeesApi";
import { listLocations, type LocationRow } from "../../../../lib/hrMastersApi";
import { supabase } from "../../../../lib/supabaseClient";

type WeeklyOffRule = {
  id: string;
  scope_type: "location" | "employee";
  location_id: string | null;
  employee_id: string | null;
  weekday: number;
  week_of_month: number | null;
  is_off: boolean;
  effective_from: string;
  effective_to: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const weekdayOptions = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const weekOfMonthOptions = [
  { value: "", label: "Every week" },
  { value: "1", label: "Week 1" },
  { value: "2", label: "Week 2" },
  { value: "3", label: "Week 3" },
  { value: "4", label: "Week 4" },
  { value: "5", label: "Week 5" },
];

export default function HrWeeklyOffRulesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [activeTab, setActiveTab] = useState<"location" | "employee">("location");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [locationRules, setLocationRules] = useState<WeeklyOffRule[]>([]);
  const [employeeRules, setEmployeeRules] = useState<WeeklyOffRule[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [locationForm, setLocationForm] = useState({
    weekday: "0",
    weekOfMonth: "",
    isOff: true,
    effectiveFrom: "",
    effectiveTo: "",
  });
  const [employeeForm, setEmployeeForm] = useState({
    weekday: "0",
    weekOfMonth: "",
    isOff: true,
    effectiveFrom: "",
    effectiveTo: "",
  });

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    const list = employees.slice(0);
    if (!query) {
      return list.slice(0, 50);
    }
    return list.filter((employee) => {
      const name = employee.full_name?.toLowerCase() ?? "";
      const code = employee.employee_code?.toLowerCase() ?? "";
      return name.includes(query) || code.includes(query);
    });
  }, [employeeSearch, employees]);

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
      setCtx(context);

      if (!context.companyId) {
        setLoading(false);
        return;
      }

      await loadMasters();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!selectedLocationId) {
      setLocationRules([]);
      return;
    }
    void loadLocationRules(selectedLocationId);
  }, [selectedLocationId]);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setEmployeeRules([]);
      return;
    }
    void loadEmployeeRules(selectedEmployeeId);
  }, [selectedEmployeeId]);

  async function loadMasters() {
    try {
      const [locationData, employeeResult] = await Promise.all([
        listLocations(),
        listEmployees(),
      ]);

      const sortedLocations = locationData
        .slice(0)
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setLocations(sortedLocations);
      if (sortedLocations[0]?.id) {
        setSelectedLocationId(sortedLocations[0].id);
      }

      if (employeeResult.error) {
        throw employeeResult.error;
      }

      const sortedEmployees = employeeResult.data
        .slice(0)
        .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
      setEmployees(sortedEmployees);
      if (sortedEmployees[0]?.id) {
        setSelectedEmployeeId(sortedEmployees[0].id ?? "");
      }
    } catch (error: any) {
      setToast({
        type: "error",
        message: error?.message || "Unable to load weekly off settings.",
      });
    }
  }

  async function loadLocationRules(locationId: string) {
    const { data, error } = await supabase
      .from("erp_weekly_off_rules")
      .select(
        "id, scope_type, location_id, employee_id, weekday, week_of_month, is_off, effective_from, effective_to"
      )
      .eq("scope_type", "location")
      .eq("location_id", locationId)
      .order("effective_from", { ascending: false })
      .order("weekday", { ascending: true })
      .order("week_of_month", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load rules." });
      return;
    }

    setLocationRules((data as WeeklyOffRule[]) || []);
  }

  async function loadEmployeeRules(employeeId: string) {
    const { data, error } = await supabase
      .from("erp_weekly_off_rules")
      .select(
        "id, scope_type, location_id, employee_id, weekday, week_of_month, is_off, effective_from, effective_to"
      )
      .eq("scope_type", "employee")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false })
      .order("weekday", { ascending: true })
      .order("week_of_month", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load rules." });
      return;
    }

    setEmployeeRules((data as WeeklyOffRule[]) || []);
  }

  function formatDbError(error: { message?: string; code?: string } | null, fallback: string) {
    if (!error) return fallback;
    const message = error.message || fallback;
    if (error.code === "23514" || message.toLowerCase().includes("check constraint")) {
      return "Rule violates validation constraints. Check weekday, week-of-month, and effective dates.";
    }
    return message;
  }

  async function handleAddLocationRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLocationId) {
      setToast({ type: "error", message: "Select a location before adding a rule." });
      return;
    }

    const { error } = await supabase.from("erp_weekly_off_rules").insert({
      scope_type: "location",
      location_id: selectedLocationId,
      weekday: Number(locationForm.weekday),
      week_of_month: locationForm.weekOfMonth ? Number(locationForm.weekOfMonth) : null,
      is_off: locationForm.isOff,
      effective_from: locationForm.effectiveFrom,
      effective_to: locationForm.effectiveTo || null,
    });

    if (error) {
      setToast({ type: "error", message: formatDbError(error, "Unable to add rule.") });
      return;
    }

    setToast({ type: "success", message: "Weekly off rule added for location." });
    await loadLocationRules(selectedLocationId);
  }

  async function handleAddEmployeeRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployeeId) {
      setToast({ type: "error", message: "Select an employee before adding an override." });
      return;
    }

    const { error } = await supabase.from("erp_weekly_off_rules").insert({
      scope_type: "employee",
      employee_id: selectedEmployeeId,
      weekday: Number(employeeForm.weekday),
      week_of_month: employeeForm.weekOfMonth ? Number(employeeForm.weekOfMonth) : null,
      is_off: employeeForm.isOff,
      effective_from: employeeForm.effectiveFrom,
      effective_to: employeeForm.effectiveTo || null,
    });

    if (error) {
      setToast({ type: "error", message: formatDbError(error, "Unable to add override.") });
      return;
    }

    setToast({ type: "success", message: "Employee override added." });
    await loadEmployeeRules(selectedEmployeeId);
  }

  async function handleDeleteRule(ruleId: string, scope: "location" | "employee") {
    const { error } = await supabase.from("erp_weekly_off_rules").delete().eq("id", ruleId);
    if (error) {
      setToast({ type: "error", message: error.message || "Unable to delete rule." });
      return;
    }
    setToast({ type: "success", message: "Weekly off rule deleted." });
    if (scope === "location") {
      await loadLocationRules(selectedLocationId);
    } else {
      await loadEmployeeRules(selectedEmployeeId);
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading weekly off rules…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Weekly Off Rules</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>HR · Weekly Off</p>
        <h1 style={titleStyle}>Weekly Off Rules</h1>
        <div style={errorBoxStyle}>Not authorized. HR access is required.</div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/erp/hr" style={linkStyle}>
            Back to HR Home
          </Link>
          <button onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Attendance</p>
          <h1 style={titleStyle}>Weekly Off Rules</h1>
          <p style={subtitleStyle}>
            Maintain default weekly offs by location and employee-level overrides.
          </p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role:{" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Link href="/erp/hr" style={linkStyle}>
            ← Back to HR Home
          </Link>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>
          {toast.message}
        </div>
      ) : null}

      <div style={tabRowStyle}>
        <button
          type="button"
          onClick={() => setActiveTab("location")}
          style={{
            ...tabStyle,
            ...(activeTab === "location" ? activeTabStyle : {}),
          }}
        >
          Location Weekly Off Rules
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("employee")}
          style={{
            ...tabStyle,
            ...(activeTab === "employee" ? activeTabStyle : {}),
          }}
        >
          Employee Overrides
        </button>
      </div>

      {activeTab === "location" ? (
        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Location Weekly Off Rules</h2>
              <p style={sectionDescriptionStyle}>
                Rules apply to all employees mapped to the location unless overridden.
              </p>
            </div>
          </div>

          <div style={formGridStyle}>
            <label style={labelStyle}>
              Location
              <select
                style={inputStyle}
                value={selectedLocationId}
                onChange={(event) => setSelectedLocationId(event.target.value)}
              >
                <option value="">Select a location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name || "Unnamed location"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Weekday</th>
                  <th style={thStyle}>Week of Month</th>
                  <th style={thStyle}>Is Off</th>
                  <th style={thStyle}>Effective From</th>
                  <th style={thStyle}>Effective To</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {locationRules.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle, textAlign: "center" }}>
                      No rules for this location yet.
                    </td>
                  </tr>
                ) : (
                  locationRules.map((rule) => (
                    <tr key={rule.id}>
                      <td style={tdStyle}>{weekdayOptions[rule.weekday]?.label || rule.weekday}</td>
                      <td style={tdStyle}>
                        {rule.week_of_month ? `Week ${rule.week_of_month}` : "Every week"}
                      </td>
                      <td style={tdStyle}>{rule.is_off ? "Yes" : "No"}</td>
                      <td style={tdStyle}>{rule.effective_from}</td>
                      <td style={tdStyle}>{rule.effective_to || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          style={smallButtonStyle}
                          onClick={() => handleDeleteRule(rule.id, "location")}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <form style={formCardStyle} onSubmit={handleAddLocationRule}>
            <h3 style={formTitleStyle}>Add Location Rule</h3>
            <div style={formGridStyle}>
              <label style={labelStyle}>
                Weekday
                <select
                  style={inputStyle}
                  value={locationForm.weekday}
                  onChange={(event) =>
                    setLocationForm((prev) => ({ ...prev, weekday: event.target.value }))
                  }
                  required
                >
                  {weekdayOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Week of Month
                <select
                  style={inputStyle}
                  value={locationForm.weekOfMonth}
                  onChange={(event) =>
                    setLocationForm((prev) => ({ ...prev, weekOfMonth: event.target.value }))
                  }
                >
                  {weekOfMonthOptions.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Is Off
                <select
                  style={inputStyle}
                  value={locationForm.isOff ? "true" : "false"}
                  onChange={(event) =>
                    setLocationForm((prev) => ({
                      ...prev,
                      isOff: event.target.value === "true",
                    }))
                  }
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label style={labelStyle}>
                Effective From
                <input
                  type="date"
                  required
                  style={inputStyle}
                  value={locationForm.effectiveFrom}
                  onChange={(event) =>
                    setLocationForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))
                  }
                />
              </label>
              <label style={labelStyle}>
                Effective To
                <input
                  type="date"
                  style={inputStyle}
                  value={locationForm.effectiveTo}
                  onChange={(event) =>
                    setLocationForm((prev) => ({ ...prev, effectiveTo: event.target.value }))
                  }
                />
              </label>
            </div>
            <button type="submit" style={primaryButtonStyle}>
              Add Rule
            </button>
          </form>
        </section>
      ) : (
        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Employee Overrides</h2>
              <p style={sectionDescriptionStyle}>
                Override location weekly offs for specific employees.
              </p>
            </div>
          </div>

          <div style={formGridStyle}>
            <label style={labelStyle}>
              Search Employee
              <input
                type="text"
                placeholder="Search by name or code"
                style={inputStyle}
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
              />
            </label>
            <label style={labelStyle}>
              Employee
              <select
                style={inputStyle}
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
              >
                <option value="">Select an employee</option>
                {filteredEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name || "Unnamed"}{" "}
                    {employee.employee_code ? `(${employee.employee_code})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Weekday</th>
                  <th style={thStyle}>Week of Month</th>
                  <th style={thStyle}>Is Off</th>
                  <th style={thStyle}>Effective From</th>
                  <th style={thStyle}>Effective To</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {employeeRules.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle, textAlign: "center" }}>
                      No overrides for this employee yet.
                    </td>
                  </tr>
                ) : (
                  employeeRules.map((rule) => (
                    <tr key={rule.id}>
                      <td style={tdStyle}>{weekdayOptions[rule.weekday]?.label || rule.weekday}</td>
                      <td style={tdStyle}>
                        {rule.week_of_month ? `Week ${rule.week_of_month}` : "Every week"}
                      </td>
                      <td style={tdStyle}>{rule.is_off ? "Yes" : "No"}</td>
                      <td style={tdStyle}>{rule.effective_from}</td>
                      <td style={tdStyle}>{rule.effective_to || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          style={smallButtonStyle}
                          onClick={() => handleDeleteRule(rule.id, "employee")}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <form style={formCardStyle} onSubmit={handleAddEmployeeRule}>
            <h3 style={formTitleStyle}>Add Employee Override</h3>
            <div style={formGridStyle}>
              <label style={labelStyle}>
                Weekday
                <select
                  style={inputStyle}
                  value={employeeForm.weekday}
                  onChange={(event) =>
                    setEmployeeForm((prev) => ({ ...prev, weekday: event.target.value }))
                  }
                  required
                >
                  {weekdayOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Week of Month
                <select
                  style={inputStyle}
                  value={employeeForm.weekOfMonth}
                  onChange={(event) =>
                    setEmployeeForm((prev) => ({ ...prev, weekOfMonth: event.target.value }))
                  }
                >
                  {weekOfMonthOptions.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Is Off
                <select
                  style={inputStyle}
                  value={employeeForm.isOff ? "true" : "false"}
                  onChange={(event) =>
                    setEmployeeForm((prev) => ({
                      ...prev,
                      isOff: event.target.value === "true",
                    }))
                  }
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label style={labelStyle}>
                Effective From
                <input
                  type="date"
                  required
                  style={inputStyle}
                  value={employeeForm.effectiveFrom}
                  onChange={(event) =>
                    setEmployeeForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))
                  }
                />
              </label>
              <label style={labelStyle}>
                Effective To
                <input
                  type="date"
                  style={inputStyle}
                  value={employeeForm.effectiveTo}
                  onChange={(event) =>
                    setEmployeeForm((prev) => ({ ...prev, effectiveTo: event.target.value }))
                  }
                />
              </label>
            </div>
            <button type="submit" style={primaryButtonStyle}>
              Add Override
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "32px 36px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
  alignItems: "flex-start",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 20,
  marginBottom: 20,
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = { margin: "6px 0 8px", fontSize: 30, color: "#111827" };

const subtitleStyle: CSSProperties = { margin: 0, color: "#4b5563", fontSize: 15 };

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none" };

const tabRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  marginBottom: 20,
  flexWrap: "wrap",
};

const tabStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 999,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
  fontSize: 14,
  color: "#111827",
};

const activeTabStyle: CSSProperties = {
  backgroundColor: "#2563eb",
  borderColor: "#2563eb",
  color: "#fff",
};

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 12,
};

const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: 20, color: "#111827" };

const sectionDescriptionStyle: CSSProperties = { margin: "6px 0 0", color: "#6b7280" };

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#6b7280",
  fontWeight: 600,
  backgroundColor: "#f9fafb",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
};

const formCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  backgroundColor: "#f9fafb",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const formTitleStyle: CSSProperties = { margin: 0, fontSize: 18, color: "#111827" };

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  color: "#374151",
  fontSize: 13,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 14,
};

const buttonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#dc2626",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const smallButtonStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
  color: "#111827",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#2563eb",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
  alignSelf: "flex-start",
};

const successBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#ecfdf3",
  color: "#166534",
  border: "1px solid #bbf7d0",
  marginBottom: 16,
};

const errorBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  backgroundColor: "#fef2f2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
  marginBottom: 16,
};
