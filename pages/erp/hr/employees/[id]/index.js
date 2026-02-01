import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ContactsTab from "../../../../../components/erp/hr/employee-tabs/ContactsTab";
import AddressTab from "../../../../../components/erp/hr/employee-tabs/AddressTab";
import StatutoryTab from "../../../../../components/erp/hr/employee-tabs/StatutoryTab";
import BankTab from "../../../../../components/erp/hr/employee-tabs/BankTab";
import EmergencyTab from "../../../../../components/erp/hr/employee-tabs/EmergencyTab";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../../lib/erp/nav";
import { supabase } from "../../../../../lib/supabaseClient";

const lifecycleOptions = [
  { value: "preboarding", label: "Preboarding" },
  { value: "active", label: "Active" },
  { value: "on_notice", label: "On Notice" },
  { value: "exited", label: "Exited" },
  { value: "inactive", label: "Inactive" },
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
  const [jobHistory, setJobHistory] = useState([]);
  const [salaryCurrent, setSalaryCurrent] = useState(null);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [salaryStructures, setSalaryStructures] = useState([]);
  const [salaryForm, setSalaryForm] = useState({
    structureId: "",
    effectiveFrom: "",
    ctcMonthly: "",
    notes: "",
  });
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salaryError, setSalaryError] = useState("");
  const [masters, setMasters] = useState({
    departments: [],
    designations: [],
    locations: [],
    employmentTypes: [],
    employeeTitles: [],
    employeeGenders: [],
  });
  const [exitTypes, setExitTypes] = useState([]);
  const [exitReasons, setExitReasons] = useState([]);
  const [exitRequest, setExitRequest] = useState(null);
  const [exitCompleted, setExitCompleted] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [exitForm, setExitForm] = useState({
    exit_type_id: "",
    exit_reason_id: "",
    last_working_day: "",
    notes: "",
  });
  const [exitLoading, setExitLoading] = useState(false);
  const [exitError, setExitError] = useState("");
  const [exitSaving, setExitSaving] = useState(false);
  const [jobForm, setJobForm] = useState({
    department_id: "",
    designation_id: "",
    location_id: "",
    employment_type_id: "",
    manager_employee_id: "",
    lifecycle_status: "preboarding",
    exit_date: "",
    effective_from: "",
  });
  const [docForm, setDocForm] = useState({ doc_type: "other", notes: "" });
  const [uploadFile, setUploadFile] = useState(null);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activating, setActivating] = useState(false);

  const canManage = useMemo(() => {
    const rk = (ctx?.roleKey ?? access.roleKey ?? "").toLowerCase();
    return access.isManager || ["owner", "admin", "hr", "payroll"].includes(rk) || isHr(rk);
  }, [access.isManager, ctx?.roleKey, access.roleKey]);

  const canExit = useMemo(() => {
    const rk = (ctx?.roleKey ?? access.roleKey ?? "").toLowerCase();
    return ["owner", "admin", "hr"].includes(rk) || isHr(rk);
  }, [ctx?.roleKey, access.roleKey]);

  const headerEmail = useMemo(() => {
    const workEmail = contacts.find((contact) => contact.contact_type === "work_email" && contact.email);
    if (workEmail?.email) return workEmail.email;
    const primaryEmail = contacts.find((contact) => contact.email && contact.is_primary);
    return primaryEmail?.email || "";
  }, [contacts]);
  const headerPhone = useMemo(() => {
    const mobilePhone = contacts.find((contact) => contact.contact_type === "mobile" && contact.phone);
    if (mobilePhone?.phone) return mobilePhone.phone;
    const primaryPhone = contacts.find((contact) => contact.phone && contact.is_primary);
    return primaryPhone?.phone || "";
  }, [contacts]);
  const salaryRoleKey = ctx?.roleKey ?? access.roleKey ?? "";
  const canEditSalary = useMemo(
    () => ["owner", "admin", "hr", "payroll"].includes(salaryRoleKey),
    [salaryRoleKey]
  );
  const exitActionDisabled = useMemo(
    () => employee?.lifecycle_status === "inactive" || exitCompleted,
    [employee?.lifecycle_status, exitCompleted]
  );

  useEffect(() => {
    if (!router.isReady) return;
    const tabParam = Array.isArray(router.query.tab) ? router.query.tab[0] : router.query.tab;
    const allowedTabs = [
      "overview",
      "job",
      "contacts",
      "addresses",
      "statutory",
      "bank",
      "emergency",
      "documents",
      "exit",
      "salary",
    ];
    if (tabParam && allowedTabs.includes(tabParam)) {
      setTab(tabParam);
    }
  }, [router.isReady, router.query.tab]);

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
        loadJobHistory(session.access_token),
      ]); 
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady, employeeId, router]);

  useEffect(() => {
    if (!employeeId || !ctx?.companyId) return;
    loadSalaryData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, ctx?.companyId, canEditSalary]);

  useEffect(() => {
    if (!employeeId || !ctx?.companyId) return;
    loadExitData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, ctx?.companyId]);

  function showToast(message, type = "success") {
    setToast({ type, message });
    setTimeout(() => setToast(null), 2500);
  }

  async function loadEmployee(token = accessToken) {
    if (!employeeId || !token) return;
    const res = await fetch(`/api/hr/employees/${employeeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to load employee");
      return;
    }
    const profile = data.employee;
    const emp = profile?.employee || profile;
    setEmployee(emp);
    if (Array.isArray(profile?.contacts)) {
      setContacts(profile.contacts);
    }
  }

  async function loadSalaryData() {
    if (!employeeId || !ctx?.companyId) return;
    setSalaryLoading(true);
    setSalaryError("");
    try {
      const { data, error } = await supabase.rpc("erp_employee_salary_current", {
        p_employee_id: employeeId,
      });
      if (error) throw error;
      setSalaryCurrent(data?.current || null);
      setSalaryHistory(Array.isArray(data?.history) ? data.history : []);

      if (canEditSalary) {
        const { data: structuresData, error: structuresError } = await supabase
          .from("erp_salary_structures")
          .select("id, name, is_active, basic_pct, hra_pct_of_basic, allowances_mode")
          .eq("company_id", ctx.companyId)
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (structuresError) throw structuresError;
        setSalaryStructures(structuresData || []);
      }
    } catch (e) {
      setSalaryError(e.message || "Failed to load salary assignments");
    } finally {
      setSalaryLoading(false);
    }
  }

  async function loadExitData() {
    if (!employeeId || !ctx?.companyId) return;
    setExitLoading(true);
    setExitError("");
    try {
      const [typesRes, reasonsRes, completedRes] = await Promise.all([
        supabase
          .from("erp_hr_employee_exit_types")
          .select("id, code, name, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("erp_hr_employee_exit_reasons")
          .select("id, code, name, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("erp_hr_employee_exits")
          .select(
            "id, status, initiated_on, last_working_day, notes, exit_type:erp_hr_employee_exit_types(id, name), exit_reason:erp_hr_employee_exit_reasons(id, name)"
          )
          .eq("employee_id", employeeId)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      if (typesRes.error) throw typesRes.error;
      if (reasonsRes.error) throw reasonsRes.error;
      if (completedRes.error) throw completedRes.error;

      setExitTypes(typesRes.data || []);
      setExitReasons(reasonsRes.data || []);
      const completedExit = completedRes.data?.[0] || null;
      setExitCompleted(Boolean(completedExit));
      setExitRequest(completedExit);
    } catch (err) {
      setExitError(err?.message || "Unable to load exit details.");
    } finally {
      setExitLoading(false);
    }
  }

  async function handleSalaryAssign(e) {
    e.preventDefault();
    if (!employeeId) return;
    if (!canEditSalary) return;
    if (!salaryForm.structureId) {
      setSalaryError("Select a salary structure.");
      return;
    }
    const ctcMonthly = Number(salaryForm.ctcMonthly);
    if (!ctcMonthly || ctcMonthly <= 0) {
      setSalaryError("Monthly CTC must be greater than 0.");
      return;
    }
    const effectiveFrom = salaryForm.effectiveFrom || new Date().toISOString().slice(0, 10);
    setSalaryLoading(true);
    setSalaryError("");
    try {
      const { error } = await supabase.rpc("erp_employee_salary_assign", {
        p_employee_id: employeeId,
        p_salary_structure_id: salaryForm.structureId,
        p_effective_from: effectiveFrom,
        p_ctc_monthly: ctcMonthly,
        p_notes: salaryForm.notes.trim() || null,
      });
      if (error) throw error;
      setSalaryForm({ structureId: "", effectiveFrom: "", ctcMonthly: "", notes: "" });
      showToast("Salary structure assigned");
      await loadSalaryData();
    } catch (e) {
      setSalaryError(e.message || "Failed to assign salary structure");
    } finally {
      setSalaryLoading(false);
    }
  }

  async function handleActivate() {
    if (!employee?.id) return;
    setActivating(true);
    const { error: activateError } = await supabase.rpc("erp_hr_employee_activate", {
      p_employee_id: employee.id,
    });
    if (activateError) {
      setToast({ type: "error", message: activateError.message });
      setActivating(false);
      return;
    }
    setToast({ type: "success", message: "Employee activated successfully." });
    setActivating(false);
    await loadEmployee();
  }

  async function handleExitFinalize(event) {
    event.preventDefault();
    if (!employeeId) return;

    if (!canExit) {
      setExitError("Only owner/admin/hr can exit employees.");
      return;
    }

    if (exitActionDisabled) {
      setExitError("Employee exit already completed.");
      return;
    }

    if (!exitForm.exit_type_id) {
      setExitError("Select an exit type.");
      return;
    }

    if (!exitForm.exit_reason_id) {
      setExitError("Select an exit reason.");
      return;
    }

    if (!exitForm.last_working_day) {
      setExitError("Last working day is required.");
      return;
    }

    setExitSaving(true);
    setExitError("");

    try {
      const ensurePayload = {
        p_employee_id: employeeId,
        p_last_working_day: exitForm.last_working_day || null,
        p_reason_id: exitForm.exit_reason_id || null,
        p_notes: (exitForm.notes || "").trim() || null,
      };

      const { data: exitId, error } = await supabase.rpc(
        "erp_hr_employee_exit_ensure",
        ensurePayload
      );
      if (error) throw error;

      if (!exitId) {
        throw new Error("Unable to create exit request.");
      }

      const { error: updateError } = await supabase.rpc(
        "erp_hr_employee_exit_update_details",
        {
          p_exit_id: exitId,
          p_exit_type_id: exitForm.exit_type_id,
          p_exit_reason_id: exitForm.exit_reason_id || null,
          p_last_working_day: exitForm.last_working_day || null,
          p_notes: (exitForm.notes || "").trim() || null,
        }
      );
      if (updateError) throw updateError;

      const monthValue = exitForm.last_working_day
        ? exitForm.last_working_day.slice(0, 7)
        : new Date().toISOString().slice(0, 7);

      showToast("Exit request created.");
      setExitModalOpen(false);
      setExitForm({
        exit_type_id: "",
        exit_reason_id: "",
        last_working_day: "",
        notes: "",
      });

      await Promise.all([loadEmployee(), loadExitData()]);
      router.push(
        `/erp/hr/exits?status=draft&month=${encodeURIComponent(monthValue)}&exit_id=${exitId}`
      );
    } catch (err) {
      setExitError(err?.message || "Unable to create exit request.");
    } finally {
      setExitSaving(false);
    }
  }

  async function loadMasters(token = accessToken) {
    const types = [
      ["departments", "departments"],
      ["designations", "designations"],
      ["locations", "locations"],
      ["employmentTypes", "employment-types"],
      ["employeeTitles", "employee-titles"],
      ["employeeGenders", "employee-genders"],
    ];
    const results = await Promise.all(
      types.map(([stateKey, apiType]) =>
        fetch(`/api/hr/masters?type=${apiType}`, {
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
    const res = await fetch(`/api/hr/employees/documents?employee_id=${employeeId}`, {
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
    const res = await fetch(`/api/hr/employees/${employeeId}/contacts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to load contacts");
      return;
    }
    setContacts(data.contacts || []);
  }

  async function loadJobHistory(token = accessToken) {
    if (!employeeId || !token) return;
    const res = await fetch(`/api/hr/employees/job-history?employee_id=${employeeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      setError(data?.error || "Failed to load job history");
      return;
    }
    const jobs = Array.isArray(data.jobs) ? [...data.jobs] : [];
    jobs.sort((a, b) => {
      const dateA = new Date(a.effective_from || 0).getTime();
      const dateB = new Date(b.effective_from || 0).getTime();
      return dateB - dateA;
    });
    setJobHistory(jobs);
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
    const effectiveFrom =
      jobForm.effective_from ||
      currentJob?.effective_from ||
      employee?.joining_date ||
      new Date().toISOString().slice(0, 10);
    setSaving(true);
    setError("");
    const payload = {
      employee_id: employeeId,
      department_id: jobForm.department_id || null,
      designation_id: jobForm.designation_id || null,
      location_id: jobForm.location_id || null,
      manager_employee_id: jobForm.manager_employee_id || null,
      grade_id: currentJob?.grade_id || null,
      cost_center_id: currentJob?.cost_center_id || null,
      notes: currentJob?.notes || null,
      effective_from: effectiveFrom,
    };

    const res = await fetch("/api/hr/employees/job", {
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
    await Promise.all([loadEmployee(), loadJobHistory()]);
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

    const uploadRes = await fetch("/api/employees/documents/upload-url", {
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

    const saveRes = await fetch("/api/hr/employees/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employee_id: employeeId,
        doc_type: docForm.doc_type,
        notes: docForm.notes || null,
        storage_path: uploadData.path,
        file_name: uploadFile.name,
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
    if (!window.confirm("Delete this document?")) return;
    const res = await fetch("/api/hr/employees/documents", {
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
    const res = await fetch(`/api/employees/documents/signed-url?document_id=${docId}`, {
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
    designations: masters.designations.filter((d) => d.is_active),
    locations: masters.locations.filter((d) => d.is_active),
    employmentTypes: masters.employmentTypes.filter((d) => d.is_active),
  };

  const departmentNames = useMemo(
    () => new Map(masters.departments.map((dept) => [dept.id, dept.name])),
    [masters.departments]
  );
  const designationNames = useMemo(
    () => new Map(masters.designations.map((designation) => [designation.id, designation.name])),
    [masters.designations]
  );
  const locationNames = useMemo(
    () => new Map(masters.locations.map((location) => [location.id, location.name])),
    [masters.locations]
  );
  const titleNames = useMemo(
    () => new Map(masters.employeeTitles.map((title) => [title.id, title.name])),
    [masters.employeeTitles]
  );
  const genderNames = useMemo(
    () => new Map(masters.employeeGenders.map((gender) => [gender.id, gender.name])),
    [masters.employeeGenders]
  );
  const managerNames = useMemo(
    () => new Map(employeeList.map((emp) => [emp.id, emp.full_name || emp.employee_code || "—"])),
    [employeeList]
  );

  const currentJob = useMemo(() => {
    if (!Array.isArray(jobHistory) || jobHistory.length === 0) return null;
    const activeJob = jobHistory.find((job) => !job.effective_to);
    if (activeJob) return activeJob;
    return jobHistory.reduce((latest, job) => {
      if (!latest) return job;
      const latestDate = new Date(latest.effective_from || 0).getTime();
      const jobDate = new Date(job.effective_from || 0).getTime();
      return jobDate >= latestDate ? job : latest;
    }, null);
  }, [jobHistory]);

  const overviewDepartment = useMemo(() => {
    if (currentJob?.department_id) {
      return (
        masters.departments.find((d) => d.id === currentJob.department_id)?.name ||
        employee?.department_name ||
        employee?.department ||
        "—"
      );
    }
    return employee?.department_name || employee?.department || "—";
  }, [currentJob, masters.departments, employee]);

  const overviewDesignation = useMemo(() => {
    if (currentJob?.designation_id) {
      return (
        masters.designations.find((d) => d.id === currentJob.designation_id)?.name ||
        employee?.job_title ||
        employee?.designation ||
        "—"
      );
    }
    return employee?.job_title || employee?.designation || "—";
  }, [currentJob, masters.designations, employee]);

  const overviewLocation = useMemo(() => {
    if (currentJob?.location_id) {
      return (
        masters.locations.find((d) => d.id === currentJob.location_id)?.name ||
        employee?.location_name ||
        "—"
      );
    }
    return employee?.location_name || "—";
  }, [currentJob, masters.locations, employee]);

  const overviewEmploymentType = useMemo(() => {
    if (employee?.employment_type_id) {
      return (
        masters.employmentTypes.find((d) => d.id === employee.employment_type_id)?.name ||
        employee?.employment_type ||
        "—"
      );
    }
    return employee?.employment_type || "—";
  }, [employee, masters.employmentTypes]);

  const overviewTitle = useMemo(() => {
    if (employee?.title_id) {
      return titleNames.get(employee.title_id) || "—";
    }
    return "—";
  }, [employee, titleNames]);

  const overviewGender = useMemo(() => {
    if (employee?.gender_id) {
      return genderNames.get(employee.gender_id) || "—";
    }
    return "—";
  }, [employee, genderNames]);

  useEffect(() => {
    if (!employee) return;
    setJobForm({
      department_id: currentJob?.department_id || employee.department_id || "",
      designation_id: currentJob?.designation_id || "",
      location_id: currentJob?.location_id || employee.location_id || "",
      employment_type_id: employee.employment_type_id || "",
      manager_employee_id: currentJob?.manager_employee_id || employee.manager_employee_id || "",
      lifecycle_status: employee.lifecycle_status || "preboarding",
      exit_date: employee.exit_date ? employee.exit_date.split("T")[0] : "",
      effective_from: currentJob?.effective_from ? currentJob.effective_from.split("T")[0] : "",
    });
  }, [employee, currentJob]);

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
            {employee.lifecycle_status === "inactive" ? (
              <span style={{ marginLeft: 8 }}>
                <span style={inactiveBadgeStyle}>Inactive</span>
              </span>
            ) : null}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          {canManage && employee.lifecycle_status !== "active" ? (
            <button
              type="button"
              onClick={handleActivate}
              style={primaryButtonStyle}
              disabled={activating}
            >
              {activating ? "Activating..." : "Activate Employee"}
            </button>
          ) : null}
          {canExit ? (
            <button
              type="button"
              onClick={() => {
                setExitError("");
                setExitModalOpen(true);
              }}
              style={dangerButtonStyle}
              disabled={exitActionDisabled || exitLoading}
            >
              Exit Employee
            </button>
          ) : null}
          <a href="/erp/hr/employees" style={{ color: "#2563eb", textDecoration: "none" }}>← Back to Employees</a>
          <a href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>HR Home</a>
        </div>
      </div>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      {canExit && exitActionDisabled ? (
        <div style={infoBoxStyle}>
          {employee.lifecycle_status === "inactive"
            ? "Employee is already inactive. Exits are locked."
            : "A completed exit already exists for this employee."}
        </div>
      ) : null}

      {error ? <div style={errorBoxStyle}>{error}</div> : null}

      {exitModalOpen ? (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Exit Employee</h3>
              <button
                type="button"
                onClick={() => {
                  setExitModalOpen(false);
                  setExitError("");
                }}
                style={secondaryButtonStyle}
              >
                Close
              </button>
            </div>
            <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 13 }}>
              Create a draft exit request. The employee will be marked exited after approval and completion.
            </p>
            {exitError ? <div style={errorBoxStyle}>{exitError}</div> : null}
            <form onSubmit={handleExitFinalize} style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <label style={labelStyle}>
                Last Working Day
                <input
                  type="date"
                  value={exitForm.last_working_day}
                  onChange={(e) => setExitForm({ ...exitForm, last_working_day: e.target.value })}
                  style={inputStyle}
                  required
                />
              </label>
              <label style={labelStyle}>
                Exit Type
                <select
                  value={exitForm.exit_type_id}
                  onChange={(e) => setExitForm({ ...exitForm, exit_type_id: e.target.value })}
                  style={inputStyle}
                  required
                >
                  <option value="">Select exit type</option>
                  {exitTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Exit Reason
                <select
                  value={exitForm.exit_reason_id}
                  onChange={(e) => setExitForm({ ...exitForm, exit_reason_id: e.target.value })}
                  style={inputStyle}
                  required
                >
                  <option value="">Select reason</option>
                  {exitReasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {reason.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Notes
                <textarea
                  value={exitForm.notes}
                  onChange={(e) => setExitForm({ ...exitForm, notes: e.target.value })}
                  style={{ ...inputStyle, minHeight: 80 }}
                  placeholder="Optional notes"
                />
              </label>
              <div style={modalActionsStyle}>
                <button
                  type="button"
                  onClick={() => {
                    setExitModalOpen(false);
                    setExitError("");
                  }}
                  style={secondaryButtonStyle}
                >
                  Cancel
                </button>
                <button type="submit" style={dangerButtonStyle} disabled={exitSaving}>
                  {exitSaving ? "Saving…" : "Create Exit Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div style={tabsRowStyle}>
        {[
          ["overview", "Overview"],
          ["job", "Job"],
          ["contacts", "Contacts"],
          ["addresses", "Addresses"],
          ["statutory", "Statutory"],
          ["bank", "Bank"],
          ["emergency", "Emergency"],
          ["documents", "Documents"],
          ["exit", "Exit"],
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
            <OverviewItem label="Phone" value={headerPhone || "—"} />
            <OverviewItem label="Title" value={overviewTitle} />
            <OverviewItem label="Gender" value={overviewGender} />
            <OverviewItem label="Department" value={overviewDepartment} />
            <OverviewItem label="Job Title" value={overviewDesignation} />
            <OverviewItem label="Location" value={overviewLocation} />
            <OverviewItem label="Employment Type" value={overviewEmploymentType} />
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
              Effective From
              <input
                type="date"
                value={jobForm.effective_from || ""}
                onChange={(e) => setJobForm({ ...jobForm, effective_from: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              />
              <span style={helperTextStyle}>Defaults to today if left empty.</span>
            </label>
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
                value={jobForm.designation_id}
                onChange={(e) => setJobForm({ ...jobForm, designation_id: e.target.value })}
                style={inputStyle}
                disabled={!canManage}
              >
                <option value="">Select job title</option>
                {jobOptions.designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
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
                disabled
              >
                <option value="">Select type</option>
                {jobOptions.employmentTypes.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <span style={helperTextStyle}>Coming soon</span>
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
                disabled
              />
              <span style={helperTextStyle}>Coming soon</span>
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" style={primaryButtonStyle} disabled={!canManage || saving}>
                {saving ? "Saving…" : "Save Job"}
              </button>
            </div>
          </form>
          <div style={{ marginTop: 18 }}>
            <div style={tableHeaderStyle}>Job History ({jobHistory.length})</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Effective From</th>
                    <th style={thStyle}>Effective To</th>
                    <th style={thStyle}>Department</th>
                    <th style={thStyle}>Job Title</th>
                    <th style={thStyle}>Location</th>
                    <th style={thStyle}>Manager</th>
                  </tr>
                </thead>
                <tbody>
                  {jobHistory.length === 0 ? (
                    <tr>
                      <td style={tdStyle} colSpan={6}>
                        No job history available yet.
                      </td>
                    </tr>
                  ) : (
                    jobHistory.map((job) => (
                      <tr key={job.id || `${job.employee_id}-${job.effective_from}`}>
                        <td style={tdStyle}>{formatDate(job.effective_from)}</td>
                        <td style={tdStyle}>
                          {job.effective_to ? (
                            formatDate(job.effective_to)
                          ) : (
                            <span style={badgeStyle}>Current</span>
                          )}
                        </td>
                        <td style={tdStyle}>{departmentNames.get(job.department_id) || "—"}</td>
                        <td style={tdStyle}>{designationNames.get(job.designation_id) || "—"}</td>
                        <td style={tdStyle}>{locationNames.get(job.location_id) || "—"}</td>
                        <td style={tdStyle}>{managerNames.get(job.manager_employee_id) || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
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

      {tab === "statutory" ? (
        <div style={panelStyle}>
          <StatutoryTab employeeId={employeeId} accessToken={accessToken} canManage={canManage} />
        </div>
      ) : null}

      {tab === "bank" ? (
        <div style={panelStyle}>
          <BankTab employeeId={employeeId} accessToken={accessToken} canManage={canManage} />
        </div>
      ) : null}

      {tab === "emergency" ? (
        <div style={panelStyle}>
          <EmergencyTab employeeId={employeeId} accessToken={accessToken} canManage={canManage} />
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
                            Download
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

      {tab === "exit" ? (
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Exit</h3>
            {!canExit ? <span style={{ color: "#6b7280" }}>Read-only</span> : null}
          </div>

          {exitLoading ? <p style={{ color: "#6b7280" }}>Loading exit details…</p> : null}
          {exitError ? <div style={errorBoxStyle}>{exitError}</div> : null}

          {exitRequest ? (
            <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
              <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Completed Exit</div>
                    <div style={{ color: "#6b7280", fontSize: 13 }}>
                      Initiated on {formatIsoDate(exitRequest.initiated_on)}
                    </div>
                  </div>
                  <span style={badgeStyle}>{exitRequest.status}</span>
                </div>
                <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                  <div><strong>Exit Type:</strong> {exitRequest.exit_type?.name || "—"}</div>
                  <div><strong>Reason:</strong> {exitRequest.exit_reason?.name || "—"}</div>
                  <div><strong>Last Working Day:</strong> {formatIsoDate(exitRequest.last_working_day)}</div>
                  <div><strong>Notes:</strong> {exitRequest.notes || "—"}</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 18, color: "#6b7280" }}>
              No completed exit found for this employee.
            </div>
          )}
        </div>
      ) : null}

      {tab === "salary" ? (
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Salary</h3>
          {salaryLoading ? <p style={{ color: "#6b7280" }}>Loading salary assignments…</p> : null}
          {salaryError ? <p style={{ color: "#b91c1c" }}>{salaryError}</p> : null}

          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 10 }}>
              <h4 style={{ margin: "0 0 8px" }}>Current Assignment</h4>
              {salaryCurrent ? (
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 600 }}>{salaryCurrent.structure_name}</div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    Monthly CTC: {formatCurrency(salaryCurrent.ctc_monthly)}
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    Effective from: {formatDate(salaryCurrent.effective_from)}
                  </div>
                  {renderBreakupPreview(
                    salaryCurrent.ctc_monthly,
                    salaryCurrent.basic_pct,
                    salaryCurrent.hra_pct_of_basic
                  )}
                </div>
              ) : (
                <div style={{ color: "#6b7280" }}>No active salary structure assigned.</div>
              )}
            </div>

            {canEditSalary ? (
              <form onSubmit={handleSalaryAssign} style={{ display: "grid", gap: 12 }}>
                <h4 style={{ margin: 0 }}>Assign / Change Structure</h4>
                <label style={labelStyle}>
                  Salary Structure
                  <select
                    value={salaryForm.structureId}
                    onChange={(e) => setSalaryForm({ ...salaryForm, structureId: e.target.value })}
                    style={inputStyle}
                    disabled={salaryLoading}
                  >
                    <option value="">Select structure</option>
                    {salaryStructures.map((structure) => (
                      <option key={structure.id} value={structure.id}>
                        {structure.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Monthly CTC
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={salaryForm.ctcMonthly}
                    onChange={(e) => setSalaryForm({ ...salaryForm, ctcMonthly: e.target.value })}
                    style={inputStyle}
                    placeholder="e.g., 45000"
                    disabled={salaryLoading}
                  />
                </label>
                <label style={labelStyle}>
                  Effective From
                  <input
                    type="date"
                    value={salaryForm.effectiveFrom}
                    onChange={(e) => setSalaryForm({ ...salaryForm, effectiveFrom: e.target.value })}
                    style={inputStyle}
                    disabled={salaryLoading}
                  />
                </label>
                {renderBreakupPreview(
                  salaryForm.ctcMonthly,
                  salaryStructures.find((structure) => structure.id === salaryForm.structureId)?.basic_pct,
                  salaryStructures.find((structure) => structure.id === salaryForm.structureId)?.hra_pct_of_basic
                )}
                <label style={labelStyle}>
                  Notes
                  <input
                    value={salaryForm.notes}
                    onChange={(e) => setSalaryForm({ ...salaryForm, notes: e.target.value })}
                    style={inputStyle}
                    placeholder="Optional notes"
                    disabled={salaryLoading}
                  />
                </label>
                <div>
                  <button type="submit" style={primaryButtonStyle} disabled={salaryLoading}>
                    {salaryLoading ? "Saving…" : "Assign Structure"}
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ color: "#6b7280" }}>
                You have read-only access to salary assignments.
              </div>
            )}

            <div>
              <h4 style={{ margin: "0 0 8px" }}>Salary History</h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Structure</th>
                      <th style={thStyle}>CTC (Monthly)</th>
                      <th style={thStyle}>Effective From</th>
                      <th style={thStyle}>Effective To</th>
                      <th style={thStyle}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaryHistory.map((row) => (
                      <tr key={row.id}>
                        <td style={tdStyle}>{row.structure_name || row.salary_structure_id}</td>
                        <td style={tdStyle}>{formatCurrency(row.ctc_monthly)}</td>
                        <td style={tdStyle}>{formatDate(row.effective_from)}</td>
                        <td style={tdStyle}>{formatDate(row.effective_to)}</td>
                        <td style={tdStyle}>{row.notes || "—"}</td>
                      </tr>
                    ))}
                    {!salaryHistory.length ? (
                      <tr>
                        <td style={tdStyle} colSpan={5}>
                          <div style={{ color: "#6b7280" }}>No salary history available.</div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
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

function formatIsoDate(value) {
  if (!value) return "—";
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function computeBreakup(ctcMonthly, basicPct, hraPctOfBasic) {
  const ctc = Number(ctcMonthly);
  const basicPercent = Number(basicPct);
  const hraPercent = Number(hraPctOfBasic);
  if (!Number.isFinite(ctc) || ctc <= 0 || !Number.isFinite(basicPercent) || !Number.isFinite(hraPercent)) {
    return null;
  }
  const basic = roundCurrency((ctc * basicPercent) / 100);
  const hra = roundCurrency((basic * hraPercent) / 100);
  const allowances = roundCurrency(Math.max(ctc - basic - hra, 0));
  return { basic, hra, allowances };
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function renderBreakupPreview(ctcMonthly, basicPct, hraPctOfBasic) {
  const breakup = computeBreakup(ctcMonthly, basicPct, hraPctOfBasic);
  if (!breakup) return null;
  return (
    <div style={{ marginTop: 6, fontSize: 12, color: "#4b5563" }}>
      Breakup: Basic {formatCurrency(breakup.basic)} · HRA {formatCurrency(breakup.hra)} · Allowances{" "}
      {formatCurrency(breakup.allowances)}
    </div>
  );
}

const containerStyle = {
  maxWidth: 1100,
  margin: "0 auto",
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

const helperTextStyle = { fontSize: 12, color: "#6b7280", fontWeight: 400 };

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

const secondaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#f9fafb",
  color: "#111827",
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

const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  background: "#ecfccb",
  color: "#3f6212",
  fontSize: 12,
  fontWeight: 700,
};

const inactiveBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  background: "#fee2e2",
  color: "#991b1b",
  fontSize: 12,
  fontWeight: 700,
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

const successBoxStyle = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #a7f3d0",
  background: "#ecfdf5",
  color: "#047857",
};

const infoBoxStyle = {
  marginBottom: 12,
  padding: 12,
  borderRadius: 10,
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
  padding: 24,
};

const modalStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  width: "100%",
  maxWidth: 520,
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.2)",
};

const modalActionsStyle = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};
