import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { listLocations, type LocationRow } from "../../../lib/hrMastersApi";
import { supabase } from "../../../lib/supabaseClient";

type ShiftOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type LocationShiftRow = {
  id: string;
  location_id: string;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
  is_default: boolean;
  erp_hr_shifts?: { code?: string | null; name?: string | null } | null;
};

type MappingFormState = {
  location_id: string;
  shift_id: string;
  effective_from: string;
  effective_to: string;
  is_default: boolean;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const emptyForm: MappingFormState = {
  location_id: "",
  shift_id: "",
  effective_from: "",
  effective_to: "",
  is_default: true,
};

export default function HrLocationShiftsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [mappings, setMappings] = useState<LocationShiftRow[]>([]);
  const [form, setForm] = useState<MappingFormState>({ ...emptyForm });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

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

      const [locationRows, shiftRows] = await Promise.all([loadLocations(), loadShifts()]);
      if (!active) return;

      if (locationRows.length > 0) {
        const firstLocation = locationRows[0];
        setSelectedLocation(firstLocation.id || "");
        setForm((prev) => ({ ...prev, location_id: firstLocation.id || "" }));
        await loadMappings(firstLocation.id || "");
      }

      if (shiftRows.length > 0 && !form.shift_id) {
        setForm((prev) => ({ ...prev, shift_id: shiftRows[0].id }));
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!selectedLocation) return;
    loadMappings(selectedLocation);
  }, [selectedLocation]);

  async function loadLocations() {
    try {
      const data = await listLocations();
      const rows = Array.isArray(data) ? data : [];
      setLocations(rows);
      return rows;
    } catch (error: any) {
      setToast({ type: "error", message: error?.message || "Unable to load locations." });
      return [];
    }
  }

  async function loadShifts() {
    const { data, error } = await supabase
      .from("erp_hr_shifts")
      .select("id, code, name, is_active")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load shifts." });
      return [];
    }

    const rows = (data as ShiftOption[]) || [];
    setShifts(rows);
    return rows;
  }

  async function loadMappings(locationId: string) {
    if (!locationId) return;
    const { data, error } = await supabase
      .from("erp_hr_location_shifts")
      .select(
        "id, location_id, shift_id, effective_from, effective_to, is_default, erp_hr_shifts(code, name)"
      )
      .eq("location_id", locationId)
      .order("effective_from", { ascending: false });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load mappings." });
      return;
    }

    setMappings((data as LocationShiftRow[]) || []);
  }

  function normalizeDate(value: string) {
    return value.trim();
  }

  function dateInRange(date: string, start: string, end?: string | null) {
    if (!date) return false;
    if (date < start) return false;
    if (end && date > end) return false;
    return true;
  }

  function hasDefaultConflict() {
    if (!form.is_default) return false;
    if (!form.location_id || !form.effective_from) return false;
    const candidateEnd = form.effective_to ? form.effective_to : null;
    for (let i = 0; i < mappings.length; i += 1) {
      const row = mappings[i];
      if (!row.is_default) continue;
      const rowStart = row.effective_from;
      const rowEnd = row.effective_to || null;
      const candidateStart = form.effective_from;
      const candidateRangeHasRowStart = dateInRange(rowStart, candidateStart, candidateEnd);
      const candidateRangeHasRowEnd =
        rowEnd && dateInRange(rowEnd, candidateStart, candidateEnd);
      const rowRangeHasCandidateStart = dateInRange(candidateStart, rowStart, rowEnd);
      if (candidateRangeHasRowStart || candidateRangeHasRowEnd || rowRangeHasCandidateStart) {
        return true;
      }
    }
    return false;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setToast(null);
    if (!canManage) {
      setFormError("Only HR/admin users can manage location shifts.");
      return;
    }
    if (!form.location_id || !form.shift_id || !form.effective_from) {
      setFormError("Location, shift, and effective date are required.");
      return;
    }

    if (form.effective_to && form.effective_to < form.effective_from) {
      setFormError("Effective to date must be after effective from.");
      return;
    }

    if (hasDefaultConflict()) {
      setFormError(
        "Only one default mapping can be active for a location within the same effective date range."
      );
      return;
    }

    setSaving(true);
    setFormError("");

    const { error } = await supabase.rpc("erp_hr_location_shift_create", {
      p_location_id: form.location_id,
      p_shift_id: form.shift_id,
      p_effective_from: normalizeDate(form.effective_from),
      p_effective_to: form.effective_to ? normalizeDate(form.effective_to) : null,
      p_is_default: form.is_default,
    });

    if (error) {
      if (error.code === "23505") {
        setFormError("This shift mapping already exists for the selected effective date.");
      } else {
        setFormError(error.message || "Unable to save mapping.");
      }
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Location shift mapping saved." });
    setSaving(false);
    setForm((prev) => ({
      ...prev,
      shift_id: prev.shift_id,
      effective_from: "",
      effective_to: "",
      is_default: true,
    }));
    await loadMappings(form.location_id);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading location shift mappings…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Location Shift Mapping</h1>
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
        <p style={eyebrowStyle}>HR · Location Shifts</p>
        <h1 style={titleStyle}>Location Shift Mapping</h1>
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

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Location Shifts</p>
          <h1 style={titleStyle}>Location Shift Mapping</h1>
          <p style={subtitleStyle}>Assign shifts to locations with effective date ranges.</p>
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
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <label style={{ ...labelStyle, maxWidth: 320 }}>
          Location
          <select
            value={selectedLocation}
            onChange={(e) => {
              setSelectedLocation(e.target.value);
              setForm((prev) => ({ ...prev, location_id: e.target.value }));
            }}
            style={inputStyle}
          >
            {locations.length === 0 ? (
              <option value="">No locations available</option>
            ) : (
              locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))
            )}
          </select>
        </label>
      </section>

      <section style={sectionStyle}>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Shift</th>
                <th style={thStyle}>Effective From</th>
                <th style={thStyle}>Effective To</th>
                <th style={thStyle}>Default</th>
              </tr>
            </thead>
            <tbody>
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ ...tdStyle, textAlign: "center" }}>
                    No shift mappings yet.
                  </td>
                </tr>
              ) : (
                mappings.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>
                      {row.erp_hr_shifts?.code || "Shift"} · {row.erp_hr_shifts?.name || "—"}
                    </td>
                    <td style={tdStyle}>{row.effective_from}</td>
                    <td style={tdStyle}>{row.effective_to || "—"}</td>
                    <td style={tdStyle}>{row.is_default ? "Yes" : "No"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ ...sectionStyle, marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>Add Mapping</h2>
        <form onSubmit={handleSubmit} style={{ ...formStyle, marginTop: 12 }}>
          <div style={formGridStyle}>
            <label style={labelStyle}>
              Location *
              <select
                value={form.location_id}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, location_id: e.target.value }));
                  setSelectedLocation(e.target.value);
                }}
                style={inputStyle}
                required
              >
                <option value="" disabled>
                  Select a location
                </option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Shift *
              <select
                value={form.shift_id}
                onChange={(e) => setForm((prev) => ({ ...prev, shift_id: e.target.value }))}
                style={inputStyle}
                required
              >
                <option value="" disabled>
                  Select a shift
                </option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.code} · {shift.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Effective From *
              <input
                type="date"
                value={form.effective_from}
                onChange={(e) => setForm((prev) => ({ ...prev, effective_from: e.target.value }))}
                style={inputStyle}
                required
              />
            </label>
            <label style={labelStyle}>
              Effective To
              <input
                type="date"
                value={form.effective_to}
                onChange={(e) => setForm((prev) => ({ ...prev, effective_to: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Default Mapping
              <div style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                />
                <span style={{ color: "#4b5563" }}>Use as default shift for the date range</span>
              </div>
            </label>
          </div>

          {formError ? <div style={errorBoxStyle}>{formError}</div> : null}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setForm({ ...emptyForm, location_id: selectedLocation })}
              style={buttonStyleLink}
            >
              Clear
            </button>
            <button type="submit" style={primaryButtonStyle} disabled={saving}>
              {saving ? "Saving..." : "Save Mapping"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
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

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };

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

const formStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  backgroundColor: "#f9fafb",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  fontSize: 14,
  color: "#374151",
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  fontSize: 14,
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
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

const buttonStyleLink: CSSProperties = {
  padding: "10px 16px",
  border: "1px solid #d1d5db",
  color: "#111827",
  borderRadius: 6,
  textDecoration: "none",
  backgroundColor: "#fff",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#2563eb",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
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
