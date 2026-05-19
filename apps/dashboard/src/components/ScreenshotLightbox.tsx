"use client";

import { useEffect } from "react";

/**
 * Full-screen image viewer for screenshot galleries. Click any thumbnail
 * anywhere → mount this component with the list of all screenshots in that
 * gallery and the initial index. User gets:
 *   - dark backdrop with the image centered, scaled to fit viewport
 *   - left / right arrows + keyboard ← / → to flip between shots
 *   - ESC closes, click on backdrop also closes
 *   - timestamp + position (3 of 24) in a footer
 *
 * Items must already have URLs the viewer can fetch (i.e. include the auth
 * token in the query string the same way the thumbnail did). The component
 * doesn't know how to authenticate; it just renders <img src={url} />.
 */
export interface LightboxItem {
  id: string;
  url: string;
  capturedAt: string;
  label?: string; // optional caption (e.g. employee name on admin gallery)
}

interface Props {
  items: LightboxItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}

export function ScreenshotLightbox({ items, index, onIndexChange, onClose }: Props) {
  // Keyboard nav — left / right cycle, escape closes. Wired on every open so
  // the latest props get captured. Removed on unmount.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onIndexChange(Math.max(0, index - 1));
      else if (e.key === "ArrowRight") onIndexChange(Math.min(items.length - 1, index + 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, items.length, onIndexChange, onClose]);

  if (index < 0 || index >= items.length) return null;
  const current = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 24,
      }}
    >
      {/* Close button — top right */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title="Close (Esc)"
        style={{
          position: "absolute", top: 16, right: 24,
          background: "rgba(255,255,255,0.1)", border: "none", color: "#fff",
          fontSize: 24, cursor: "pointer", padding: "4px 14px", borderRadius: 6,
        }}
      >✕</button>

      {/* Previous arrow */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
          title="Previous (←)"
          style={{
            position: "absolute", left: 24, top: "50%", transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.1)", border: "none", color: "#fff",
            fontSize: 32, cursor: "pointer", padding: "8px 20px", borderRadius: 8,
          }}
        >‹</button>
      )}

      {/* Image — clicking on it does NOT close (only backdrop does) */}
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "82vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <img
          src={current.url}
          alt={current.label ?? current.capturedAt}
          style={{ maxWidth: "92vw", maxHeight: "78vh", objectFit: "contain", borderRadius: 4, boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}
        />
        <div style={{ color: "#ccc", fontSize: 13, textAlign: "center" }}>
          {current.label && <div style={{ fontWeight: 600, color: "#fff", marginBottom: 4 }}>{current.label}</div>}
          <div>{new Date(current.capturedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
          <div style={{ color: "#888", fontSize: 11, marginTop: 4 }}>{index + 1} of {items.length}</div>
        </div>
      </div>

      {/* Next arrow */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
          title="Next (→)"
          style={{
            position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.1)", border: "none", color: "#fff",
            fontSize: 32, cursor: "pointer", padding: "8px 20px", borderRadius: 8,
          }}
        >›</button>
      )}
    </div>
  );
}
