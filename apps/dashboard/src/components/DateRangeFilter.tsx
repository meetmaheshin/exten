"use client";

import { useEffect, useRef, useState } from "react";

export interface DateRange {
  /** ISO date string YYYY-MM-DD, or empty to mean "no lower bound" */
  from: string;
  /** ISO date string YYYY-MM-DD, or empty to mean "no upper bound" */
  to: string;
}

interface Props {
  value: DateRange;
  onChange: (next: DateRange) => void;
  /** Hide the "All time" preset (some pages always want a bounded range) */
  showAllTime?: boolean;
}

type PresetKey = "today" | "7d" | "30d" | "month" | "all" | "custom";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeForPreset(key: PresetKey): DateRange {
  const today = new Date();
  switch (key) {
    case "today":
      return { from: ymd(today), to: ymd(today) };
    case "7d": {
      const f = new Date();
      f.setDate(f.getDate() - 6);
      return { from: ymd(f), to: ymd(today) };
    }
    case "30d": {
      const f = new Date();
      f.setDate(f.getDate() - 29);
      return { from: ymd(f), to: ymd(today) };
    }
    case "month": {
      const f = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: ymd(f), to: ymd(today) };
    }
    case "all":
      return { from: "", to: "" };
    case "custom":
    default:
      return { from: "", to: "" };
  }
}

/** Identify which preset (if any) matches the given range, so the right
 *  button can be highlighted when a parent passes a value back in. */
function matchPreset(range: DateRange): PresetKey {
  if (!range.from && !range.to) return "all";
  for (const k of ["today", "7d", "30d", "month"] as const) {
    const r = rangeForPreset(k);
    if (r.from === range.from && r.to === range.to) return k;
  }
  return "custom";
}

export function DateRangeFilter({ value, onChange, showAllTime = false }: Props) {
  const activePreset = matchPreset(value);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const presetButton = (key: Exclude<PresetKey, "custom">, label: string) => {
    const isActive = activePreset === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(rangeForPreset(key))}
        className="btn"
        style={{
          fontSize: 12,
          padding: "5px 10px",
          background: isActive ? "var(--primary)" : "var(--bg-card)",
          color: isActive ? "#fff" : "var(--text)",
          border: "1px solid " + (isActive ? "var(--primary)" : "var(--border)"),
        }}
      >
        {label}
      </button>
    );
  };

  const customLabel = (() => {
    if (!value.from && !value.to) return "Pick dates";
    if (value.from && value.to && value.from === value.to) {
      return new Date(value.from).toLocaleDateString();
    }
    const f = value.from ? new Date(value.from).toLocaleDateString() : "—";
    const t = value.to ? new Date(value.to).toLocaleDateString() : "—";
    return `${f} → ${t}`;
  })();

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", position: "relative" }}>
      {presetButton("today", "Today")}
      {presetButton("7d", "Last 7 days")}
      {presetButton("30d", "Last 30 days")}
      {presetButton("month", "This month")}
      {showAllTime && presetButton("all", "All time")}

      {/* Custom range trigger */}
      <div ref={popoverRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="btn"
          style={{
            fontSize: 12,
            padding: "5px 10px",
            background: activePreset === "custom" ? "var(--primary)" : "var(--bg-card)",
            color: activePreset === "custom" ? "#fff" : "var(--text)",
            border: "1px solid " + (activePreset === "custom" ? "var(--primary)" : "var(--border)"),
          }}
        >
          📅 {activePreset === "custom" ? customLabel : "Custom"}
        </button>

        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 50,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              minWidth: 260,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>From</div>
            <input
              type="date"
              className="form-input"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ from: e.target.value, to: value.to })}
              style={{ width: "100%", marginBottom: 10 }}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>To</div>
            <input
              type="date"
              className="form-input"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ from: value.from, to: e.target.value })}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: "5px 10px" }}
                onClick={() => onChange({ from: "", to: "" })}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn"
                style={{ fontSize: 12, padding: "5px 10px", background: "var(--primary)", color: "#fff", border: "none" }}
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const dateRangePresets = {
  today: () => rangeForPreset("today"),
  last7Days: () => rangeForPreset("7d"),
  last30Days: () => rangeForPreset("30d"),
  thisMonth: () => rangeForPreset("month"),
};

/**
 * Convert a DateRange to ISO timestamps suitable for backend `from`/`to`
 * query params. `from` becomes start-of-day UTC and `to` becomes end-of-day UTC.
 * Empty values map to undefined so callers can spread them straight into URLSearchParams logic.
 */
export function dateRangeToISO(r: DateRange): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  if (r.from) out.from = `${r.from}T00:00:00.000Z`;
  if (r.to) out.to = `${r.to}T23:59:59.999Z`;
  return out;
}
