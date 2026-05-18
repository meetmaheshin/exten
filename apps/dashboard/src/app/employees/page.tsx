"use client";

import { useEffect, useState, useRef } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface Employee {
  externalUserId: number;
  employeeName: string;
  email: string;
  department: string | null;
  jobPosition: string | null;
  managerName: string | null;
  company: string | null;
  active: boolean;
}

interface UserMapping {
  userId: string;
  externalUserId: number;
  externalUserName: string;
  matchType: string;
  email: string | null;
  fullName: string | null;
  updatedAt: string;
}

export default function EmployeesPage() {
  const { accessToken } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mappings, setMappings] = useState<UserMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formUserId, setFormUserId] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formPosition, setFormPosition] = useState("");
  const [formManager, setFormManager] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  // Edit modal state — null when closed. Same field set as the add form
  // (minus externalUserId, which is the PK and not editable).
  const [editing, setEditing] = useState<Employee | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchData = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [empRes, mapRes] = await Promise.all([
        apiFetch<{ data: Employee[] }>("/api/admin/employees", { token: accessToken }),
        apiFetch<{ data: UserMapping[] }>("/api/admin/user-mappings", { token: accessToken }),
      ]);
      setEmployees(empRes.data);
      setMappings(mapRes.data);
    } catch (err) {
      console.error("Failed to load employees:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [accessToken]);

  const filtered = employees.filter(
    (e) =>
      e.employeeName.toLowerCase().includes(search.toLowerCase()) ||
      e.email.toLowerCase().includes(search.toLowerCase()) ||
      (e.department || "").toLowerCase().includes(search.toLowerCase())
  );

  // Check if an employee is mapped to an Ailancers user
  const getMappingForEmployee = (extUserId: number) =>
    mappings.find((m) => m.externalUserId === extUserId);

  const handleAddEmployee = async () => {
    if (!accessToken || !formName || !formEmail || !formUserId) return;
    setFormSaving(true);
    try {
      await apiFetch("/api/admin/employees/import", {
        token: accessToken,
        method: "POST",
        body: JSON.stringify({
          employees: [{
            externalUserId: parseInt(formUserId, 10),
            employeeName: formName,
            email: formEmail,
            department: formDept || undefined,
            jobPosition: formPosition || undefined,
            managerName: formManager || undefined,
            company: formCompany || undefined,
            active: true,
          }],
        }),
      });
      setShowAddForm(false);
      setFormName(""); setFormEmail(""); setFormUserId("");
      setFormDept(""); setFormPosition(""); setFormManager(""); setFormCompany("");
      await fetchData();
    } catch (err) {
      alert("Failed to add employee: " + (err instanceof Error ? err.message : err));
    } finally {
      setFormSaving(false);
    }
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;

    setImporting(true);
    setImportResult(null);
    try {
      const csv = await file.text();
      const result = await apiFetch<{
        imported: number;
        skipped: number;
        totalRows: number;
        parsedRows: number;
        link?: { directoryRows: number; matchedRows: number; updatedRows: number; unmappedRows: number };
      }>(
        "/api/admin/employees/import-csv",
        {
          token: accessToken,
          method: "POST",
          body: JSON.stringify({ csv }),
        }
      );
      const linkPart = result.link
        ? ` · Linked ${result.link.matchedRows} / ${result.link.directoryRows} to Ailancers users (${result.link.updatedRows} team field updated)`
        : "";
      setImportResult(`Imported ${result.imported} employees (${result.skipped} skipped, ${result.totalRows} total rows)${linkPart}`);
      await fetchData();
    } catch (err) {
      setImportResult("Import failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveEdit = async () => {
    if (!accessToken || !editing) return;
    setEditSaving(true);
    try {
      // Only send fields that are non-empty strings, except active which is
      // always a boolean. Nulls explicitly clear the column.
      await apiFetch(`/api/admin/employees/${editing.externalUserId}`, {
        token: accessToken,
        method: "PATCH",
        body: JSON.stringify({
          employeeName: editing.employeeName,
          email: editing.email,
          department: editing.department || null,
          jobPosition: editing.jobPosition || null,
          managerName: editing.managerName || null,
          company: editing.company || null,
          active: editing.active,
        }),
      });
      setEditing(null);
      await fetchData();
    } catch (err) {
      alert("Failed to save: " + (err instanceof Error ? err.message : err));
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (emp: Employee) => {
    if (!accessToken) return;
    const mapping = getMappingForEmployee(emp.externalUserId);
    const warning = mapping
      ? `\n\nThis employee is linked to an Ailancers user (${mapping.email ?? mapping.fullName}). Their historical screenshots/time logs stay attributed to them, but they will no longer appear in payroll views.`
      : "";
    if (!confirm(`Remove ${emp.employeeName} from the employee directory?${warning}\n\nThis cannot be undone.`)) return;
    setDeletingId(emp.externalUserId);
    try {
      await apiFetch(`/api/admin/employees/${emp.externalUserId}`, {
        token: accessToken,
        method: "DELETE",
      });
      await fetchData();
    } catch (err) {
      alert("Failed to delete: " + (err instanceof Error ? err.message : err));
    } finally {
      setDeletingId(null);
    }
  };

  const handleAutoLink = async () => {
    if (!accessToken) return;
    setLinking(true);
    setImportResult(null);
    try {
      const result = await apiFetch<{ directoryRows: number; matchedRows: number; updatedRows: number; unmappedRows: number }>(
        "/api/admin/employees/auto-link",
        { token: accessToken, method: "POST", body: JSON.stringify({}) }
      );
      setImportResult(
        `Auto-link complete · ${result.matchedRows} of ${result.directoryRows} directory entries match an Ailancers login · ` +
        `${result.updatedRows} user team fields updated · ${result.unmappedRows} directory entries have no matching Ailancers user (they will once those people log in)`
      );
      await fetchData();
    } catch (err) {
      setImportResult("Auto-link failed: " + (err instanceof Error ? err.message : err));
    } finally {
      setLinking(false);
    }
  };

  return (
    <DashboardShell>
      <div className="page-header">
        <div>
          <div className="page-title">Employee Directory</div>
          <div className="page-subtitle">
            Platform users mapped to Ailancers accounts &middot; {employees.length} employees, {mappings.length} mapped
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? "Cancel" : "+ Add Employee"}
          </button>
          <label className="btn btn-secondary" style={{ cursor: "pointer", margin: 0 }}>
            {importing ? "Importing..." : "Import CSV"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleCsvImport}
              style={{ display: "none" }}
              disabled={importing}
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={handleAutoLink}
            disabled={linking}
            title="Match directory emails to Ailancers logins and copy each employee's manager into their users.team field. Required before Team Snapshot can group people correctly."
          >
            {linking ? "Linking…" : "🔗 Auto-link to Ailancers users"}
          </button>
        </div>
      </div>

      {importResult && (
        <div className="card" style={{
          marginBottom: 16,
          background: importResult.startsWith("Import failed") ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
          borderColor: importResult.startsWith("Import failed") ? "var(--danger)" : "var(--success)",
          borderWidth: 1,
          borderStyle: "solid",
        }}>
          {importResult}
          <button onClick={() => setImportResult(null)} style={{ marginLeft: 12, cursor: "pointer", background: "none", border: "none", color: "var(--text-muted)" }}>✕</button>
        </div>
      )}

      {showAddForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Add New Employee</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Platform User ID *</label>
              <input className="form-input" placeholder="e.g. 172" value={formUserId} onChange={(e) => setFormUserId(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Full Name *</label>
              <input className="form-input" placeholder="Mahesh Kumar" value={formName} onChange={(e) => setFormName(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Work Email *</label>
              <input className="form-input" placeholder="mahesh@company.com" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Department</label>
              <input className="form-input" placeholder="Engineering" value={formDept} onChange={(e) => setFormDept(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Job Position</label>
              <input className="form-input" placeholder="Senior Developer" value={formPosition} onChange={(e) => setFormPosition(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Manager</label>
              <input className="form-input" placeholder="Manager Name" value={formManager} onChange={(e) => setFormManager(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Company</label>
              <input className="form-input" placeholder="OnGraph Technologies" value={formCompany} onChange={(e) => setFormCompany(e.target.value)} style={{ width: "100%" }} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleAddEmployee} disabled={formSaving || !formName || !formEmail || !formUserId}>
              {formSaving ? "Saving..." : "Add Employee"}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <input
          className="form-input"
          placeholder="Search by name, email, or department..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>

      {loading ? (
        <div className="loading">Loading employees...</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Manager</th>
                <th>Company</th>
                <th>Ailancers Mapping</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => {
                const mapping = getMappingForEmployee(emp.externalUserId);
                return (
                  <tr key={emp.externalUserId}>
                    <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>
                      {emp.externalUserId}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 32, height: 32, borderRadius: "50%",
                            background: mapping ? "var(--primary)" : "var(--border)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 600, color: "#fff",
                          }}
                        >
                          {emp.employeeName[0]?.toUpperCase() || "?"}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{emp.employeeName}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ color: emp.department ? "var(--text)" : "var(--text-muted)" }}>
                      {emp.department || "—"}
                    </td>
                    <td style={{ fontSize: 13 }}>{emp.managerName || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{emp.company || "—"}</td>
                    <td>
                      {mapping ? (
                        <div>
                          <span className="badge badge-primary" style={{ marginRight: 4 }}>{mapping.matchType}</span>
                          <span style={{ fontSize: 12 }}>{mapping.fullName || mapping.email}</span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Not mapped</span>
                      )}
                    </td>
                    <td>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        color: emp.active ? "var(--success)" : "var(--danger)",
                      }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: emp.active ? "var(--success)" : "var(--danger)",
                          display: "inline-block",
                        }} />
                        {emp.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => setEditing({ ...emp })}
                          disabled={deletingId === emp.externalUserId}
                        >
                          Edit
                        </button>
                        <button
                          style={{ padding: "4px 10px", fontSize: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#f87171", cursor: "pointer" }}
                          onClick={() => handleDelete(emp)}
                          disabled={deletingId === emp.externalUserId}
                          title="Remove from directory. User's historical data stays in the database."
                        >
                          {deletingId === emp.externalUserId ? "..." : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                    {employees.length === 0
                      ? "No employees imported yet. Import a CSV or add employees manually."
                      : "No employees match your search"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal — same field set as the add form, minus the externalUserId
          (which is the PK and not editable). Click outside or Cancel to close.
          Saving PATCHes the row and refreshes the table. */}
      {editing && (
        <div
          onClick={() => !editSaving && setEditing(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--bg-card)", borderRadius: 10, padding: 24, width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", border: "1px solid var(--border)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Edit Employee</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Platform User ID: {editing.externalUserId}</div>
              </div>
              <button onClick={() => !editSaving && setEditing(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", padding: 4 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Full Name *</label>
                <input className="form-input" value={editing.employeeName} onChange={(e) => setEditing({ ...editing, employeeName: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Work Email *</label>
                <input className="form-input" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Department</label>
                <input className="form-input" value={editing.department || ""} onChange={(e) => setEditing({ ...editing, department: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Job Position</label>
                <input className="form-input" value={editing.jobPosition || ""} onChange={(e) => setEditing({ ...editing, jobPosition: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Manager</label>
                <input className="form-input" value={editing.managerName || ""} onChange={(e) => setEditing({ ...editing, managerName: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Company</label>
                <input className="form-input" value={editing.company || ""} onChange={(e) => setEditing({ ...editing, company: e.target.value })} style={{ width: "100%" }} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                  Active (uncheck to mark as inactive without removing)
                </label>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={editSaving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={editSaving || !editing.employeeName || !editing.email}>
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
