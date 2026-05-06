import { useEffect, useRef } from "react";
import type { FileMatch } from "../types";

interface Props {
  matches: FileMatch[];
  selectedIndex: number;
  /** Bumped to a positive number when ChatInput wants the picker to act on
   *  the current selection (Enter or Tab). */
  commitNonce: number;
  onSelect: (match: FileMatch) => void;
  /** True while the host is fetching a fresh list — show a thin loading state
   *  so a slow filesystem doesn't make the picker feel broken. */
  isLoading?: boolean;
}

export function AtFilePicker({ matches, selectedIndex, commitNonce, onSelect, isLoading }: Props) {
  const lastNonceRef = useRef(0);

  useEffect(() => {
    if (commitNonce > 0 && commitNonce !== lastNonceRef.current && matches.length > 0) {
      lastNonceRef.current = commitNonce;
      const idx = Math.max(0, Math.min(selectedIndex, matches.length - 1));
      onSelect(matches[idx]);
    }
  }, [commitNonce, selectedIndex, matches, onSelect]);

  if (matches.length === 0) {
    return (
      <div className="slash-picker" role="listbox" aria-label="Files">
        <div className="slash-picker-empty">
          {isLoading ? "Searching files…" : "No matching files."}
        </div>
      </div>
    );
  }

  return (
    <div className="slash-picker at-file-picker" role="listbox" aria-label="Files">
      {matches.map((m, idx) => {
        const active = idx === Math.max(0, Math.min(selectedIndex, matches.length - 1));
        // Split the relative path into directory + filename so we can dim the
        // dir part — the filename is what users care about.
        const slash = m.path.lastIndexOf("/");
        const dir = slash >= 0 ? m.path.slice(0, slash) : "";
        return (
          <button
            key={m.path}
            type="button"
            className={`slash-picker-item ${active ? "active" : ""}`}
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(m);
            }}
          >
            <span className="slash-picker-name">{m.name}</span>
            {dir && <span className="slash-picker-arg">{dir}/</span>}
          </button>
        );
      })}
    </div>
  );
}
