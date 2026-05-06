import { useEffect, useMemo, useRef } from "react";
import { filterCommands, type SlashCommandDef } from "./SlashCommands";

interface Props {
  /** Current input value. The picker reads everything after the leading `/`. */
  prefix: string;
  /** Currently highlighted index (controlled by ChatInput's keyboard handler). */
  selectedIndex: number;
  /** Bumped to a positive number when ChatInput wants the picker to act on
   *  the current selection (Enter or Tab). The picker fires `onSelect` on
   *  the next render and ignores stale values. */
  commitNonce: number;
  onSelect: (cmd: SlashCommandDef) => void;
  /** Bumped to a positive number when ChatInput wants the picker dismissed
   *  (Esc). Dismiss is handled by parent — this is just a hint. */
  dismissNonce?: number;
  /** Called whenever the filtered-result count changes. ChatInput uses this
   *  to clamp `selectedIndex`. */
  onCountChange?: (count: number) => void;
  /** User-authored commands from `.ailancers/commands/*.md`. Merged into the
   *  picker under a "Custom" group. */
  customCommands?: { name: string; description?: string; argHint?: string }[];
}

export function SlashCommandPicker({ prefix, selectedIndex, commitNonce, onSelect, onCountChange, customCommands = [] }: Props) {
  const filtered = useMemo(() => filterCommands(prefix, customCommands), [prefix, customCommands]);
  // Init to current commitNonce so a remount doesn't auto-commit on a stale value.
  const lastNonceRef = useRef(commitNonce);

  useEffect(() => { onCountChange?.(filtered.length); }, [filtered.length, onCountChange]);

  // Commit the selected item when the parent bumps `commitNonce`. This is the
  // pattern that lets ChatInput own keyboard navigation without coupling.
  useEffect(() => {
    if (commitNonce > 0 && commitNonce !== lastNonceRef.current && filtered.length > 0) {
      lastNonceRef.current = commitNonce;
      const idx = Math.max(0, Math.min(selectedIndex, filtered.length - 1));
      onSelect(filtered[idx]);
    }
  }, [commitNonce, selectedIndex, filtered, onSelect]);

  if (filtered.length === 0) {
    return (
      <div className="slash-picker" role="listbox" aria-label="Slash commands">
        <div className="slash-picker-empty">No matching commands.</div>
      </div>
    );
  }

  // Group rendering — keep the existing order from the registry within each group
  const groups: Record<string, SlashCommandDef[]> = {};
  for (const cmd of filtered) {
    (groups[cmd.group] ??= []).push(cmd);
  }

  let runningIndex = 0;
  return (
    <div className="slash-picker" role="listbox" aria-label="Slash commands">
      {Object.entries(groups).map(([group, cmds]) => (
        <div key={group} className="slash-picker-group">
          <div className="slash-picker-group-label">{group}</div>
          {cmds.map((cmd) => {
            const idx = runningIndex++;
            const active = idx === Math.max(0, Math.min(selectedIndex, filtered.length - 1));
            return (
              <button
                key={cmd.name}
                type="button"
                className={`slash-picker-item ${active ? "active" : ""}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mouseDown so the click fires before the textarea blurs +
                  // collapses the picker.
                  e.preventDefault();
                  onSelect(cmd);
                }}
              >
                <span className="slash-picker-name">/{cmd.name}</span>
                {cmd.argHint && <span className="slash-picker-arg">{cmd.argHint}</span>}
                <span className="slash-picker-desc">{cmd.description}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
