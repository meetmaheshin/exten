import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailableModel, ImageAttachment, EditorContextSnapshot, FileMatch } from "../types";
import { getVsCodeApi } from "../vscodeApi";
import { SlashCommandPicker } from "./SlashCommandPicker";
import { filterCommands, parseSlashCommand, type SlashCommandDef } from "./SlashCommands";
import { AtFilePicker } from "./AtFilePicker";

/**
 * Detect whether the textarea has an active `@<query>` token. A token is active
 * when an `@` sits at word-start (preceded by start-of-input or whitespace) and
 * the caret is somewhere in the same word — i.e. no whitespace between the `@`
 * and the caret.
 */
function detectAtTrigger(
  value: string,
  caretPos: number,
): { active: boolean; query: string; start: number } {
  if (caretPos === 0) return { active: false, query: "", start: -1 };
  for (let i = caretPos - 1; i >= 0; i--) {
    const c = value[i];
    if (c === "@") {
      const prev = i > 0 ? value[i - 1] : "";
      if (i === 0 || /\s/.test(prev)) {
        return { active: true, query: value.slice(i + 1, caretPos), start: i };
      }
      return { active: false, query: "", start: -1 };
    }
    if (/\s/.test(c)) {
      return { active: false, query: "", start: -1 };
    }
  }
  return { active: false, query: "", start: -1 };
}

interface ChatInputProps {
  onSend: (content: string, images?: ImageAttachment[]) => void;
  onCancel: () => void;
  isStreaming: boolean;
  /** True between user clicking Stop and backend confirming the stream ended. */
  isCancelling?: boolean;
  agentMode: boolean;
  agentType: "coder" | "qa" | "design" | "supervisor";
  planMode: boolean;
  onToggleAgentMode: () => void;
  onTogglePlanMode: () => void;
  onSetAgentType: (type: "coder" | "qa" | "design" | "supervisor") => void;
  availableModels: AvailableModel[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  /** Most recent user messages, newest first. Up/Down arrow keys cycle through them. */
  inputHistory: string[];
  /** External value to load into the input (used by "edit & resend"). When set, replaces the textarea. */
  prefill?: { content: string; nonce: number } | null;
  /** When true, plain Enter inserts a newline and Ctrl/Cmd+Enter sends. */
  useCtrlEnterToSend?: boolean;
  /** Active editor snapshot for the input-footer "📎 file (N lines)" indicator. */
  editorSnapshot?: EditorContextSnapshot | null;
  /** When true, the indicator renders crossed-out and the user has opted out
   *  of auto-attaching editor context for the next send. */
  excludeEditorContext?: boolean;
  /** Toggle the above. Bound to indicator click. */
  onToggleExcludeEditorContext?: () => void;
  /** Current file-list matches for the `@` autocomplete picker. App owns the
   *  fetch wire — ChatInput just renders. */
  atFileMatches?: FileMatch[];
  /** Fires whenever the active `@<query>` query string changes (including when
   *  the trigger first activates or deactivates — empty string for inactive).
   *  App debounces this and posts `loadFileList` to the host. */
  onAtQueryChange?: (query: string) => void;
  /** Reasoning-effort selector. `null` means "use model default" — no
   *  thinking block sent. Passed to the host on send. Only renders when in
   *  agent mode. */
  effort?: "low" | "medium" | "high" | null;
  onEffortChange?: (effort: "low" | "medium" | "high" | null) => void;
  /** Unified permission mode picker. Replaces the Plan toggle's role with
   *  a four-option dropdown (default / plan / accept-edits / bypass). The
   *  legacy `planMode` flag stays in sync with this — picking `plan` flips
   *  it on, the others flip it off. */
  permissionMode?: "default" | "plan" | "accept-edits" | "bypass";
  onPermissionModeChange?: (mode: "default" | "plan" | "accept-edits" | "bypass") => void;
  /** User-authored slash commands loaded from `.ailancers/commands/*.md`,
   *  pushed by the host. Forwarded to SlashCommandPicker for merging. */
  customSlashCommands?: { name: string; description?: string; argHint?: string }[];
}

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

export function ChatInput({
  onSend, onCancel, isStreaming, isCancelling = false, agentMode, agentType, planMode,
  onToggleAgentMode, onTogglePlanMode, onSetAgentType,
  availableModels, selectedModel, onModelChange,
  inputHistory, prefill, useCtrlEnterToSend = false, editorSnapshot,
  excludeEditorContext = false, onToggleExcludeEditorContext,
  atFileMatches, onAtQueryChange,
  effort = null, onEffortChange,
  permissionMode = "default", onPermissionModeChange,
  customSlashCommands = [],
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  // -1 = composing fresh; 0..n = browsing history (0 is most recent)
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Slash-command picker state
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashCommitNonce, setSlashCommitNonce] = useState(0);
  const [slashCount, setSlashCount] = useState(0);
  // @-file picker state. `atFileMatches` is owned by the App (host fetches it),
  // so we only track the local UI bits: highlighted index + commit nonce, plus
  // the caret position so we can re-evaluate the trigger between renders even
  // when the value didn't change (caret-only moves via mouse/arrow keys).
  const [atIndex, setAtIndex] = useState(0);
  const [atCommitNonce, setAtCommitNonce] = useState(0);
  const [currentCaretPos, setCurrentCaretPos] = useState(0);
  const [editorContextPopoverOpen, setEditorContextPopoverOpen] = useState(false);
  // Overflow popover holding Permission + Effort. Both controls are
  // hidden inline when on their default value to keep the toolbar tight;
  // users reach them via the `⋯` button. We keep them inline once the
  // user selects a non-default value so the active state stays visible.
  const [overflowOpen, setOverflowOpen] = useState(false);

  // Rotating hint shown after the keyboard hint in the input footer. Cycles
  // every 5s so users discover the slash + at + prefill features without
  // having to read docs. Pauses while streaming so the "Stop" hint isn't
  // diluted. Hints are kept short — they share a single line.
  const HINTS = [
    "· /commands",
    "· @files",
    "· ↑ recall",
    "· Shift+Enter newline",
    "· 📋 plan mode",
  ];
  const [rotatingHintIdx, setRotatingHintIdx] = useState(0);
  useEffect(() => {
    if (isStreaming) return;
    const id = setInterval(() => {
      setRotatingHintIdx((i) => (i + 1) % HINTS.length);
    }, 5000);
    return () => clearInterval(id);
  }, [isStreaming]);
  const rotatingHint = isStreaming ? "" : HINTS[rotatingHintIdx];
  // Last `@`-query we reported to the parent — used to debounce no-op calls.
  const lastAtQueryRef = useRef<{ active: boolean; query: string }>({ active: false, query: "" });
  // Buffer the message-in-progress so ↑↓ doesn't lose it
  const composingBuffer = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPrefillNonce = useRef<number | null>(null);

  const showPicker = value.trim().startsWith("/") && !value.includes("\n") && !isStreaming;
  // `@`-trigger detection runs every render against the current value + caret.
  const atTrigger = detectAtTrigger(value, currentCaretPos);
  // Slash takes priority — when the slash picker is open, the `@` picker is
  // suppressed entirely, even if a literal `@` happens to sit upstream.
  const showAtPicker = atTrigger.active && !showPicker && !isStreaming;
  const atMatches = atFileMatches ?? [];

  // External "edit & resend" — when the parent triggers a prefill, replace the textarea
  useEffect(() => {
    if (prefill && prefill.nonce !== lastPrefillNonce.current) {
      lastPrefillNonce.current = prefill.nonce;
      setValue(prefill.content);
      setHistoryIndex(-1);
      // Move caret to end + focus
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(prefill.content.length, prefill.content.length);
          ta.style.height = "auto";
          ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
        }
      }, 0);
    }
  }, [prefill]);

  // Respond to the `Cmd/Ctrl+Esc` focus-input command from the host extension.
  useEffect(() => {
    const onFocusInput = () => {
      textareaRef.current?.focus();
    };
    const onInsert = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.slice(0, start) + detail.text + value.slice(end);
      setValue(newValue);
      // Move cursor to end of inserted text
      setTimeout(() => {
        ta.focus();
        const pos = start + detail.text.length;
        ta.setSelectionRange(pos, pos);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
      }, 0);
    };
    window.addEventListener("ailancers:focus-input", onFocusInput);
    window.addEventListener("ailancers:insert-at-cursor", onInsert as EventListener);
    return () => {
      window.removeEventListener("ailancers:focus-input", onFocusInput);
      window.removeEventListener("ailancers:insert-at-cursor", onInsert as EventListener);
    };
  }, [value]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachedImages.length === 0) || isStreaming) return;
    onSend(trimmed || "(see attached image)", attachedImages.length > 0 ? attachedImages : undefined);
    setValue("");
    setAttachedImages([]);
    setHistoryIndex(-1);
    composingBuffer.current = "";
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, attachedImages, isStreaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // `@`-file picker keyboard handling — mirrors the slash picker. Runs
    // first because slash takes priority via `showAtPicker`'s predicate, but
    // when the at-picker is showing it must intercept arrows/Enter/Tab/Esc
    // before the regular submit/history paths fire.
    if (showAtPicker) {
      const matchCount = atMatches.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtIndex((i) => Math.min(i + 1, Math.max(matchCount - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtIndex((i) => Math.max(i - 1, 0));
        return;
      }
      // Enter intentionally falls through to the regular send path — users
      // expect Enter to submit, even when the @-picker is open. Tab is the
      // commit key for the picker (plus mouse click). This matches GitHub's
      // and VS Code's autocomplete conventions and avoids the "I typed @foo
      // and hit Enter to send but it inserted the first file instead" trap.
      if (e.key === "Tab") {
        e.preventDefault();
        if (matchCount > 0) setAtCommitNonce((n) => n + 1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (isStreaming) {
          onCancel();
          return;
        }
        // Dismiss the picker by removing the active `@<query>` span.
        const ta = textareaRef.current;
        const caretPos = ta?.selectionStart ?? currentCaretPos;
        const trig = detectAtTrigger(value, caretPos);
        if (trig.start >= 0) {
          const before = value.slice(0, trig.start);
          const after = value.slice(caretPos);
          const next = before + after;
          setValue(next);
          setAtIndex(0);
          // Notify parent the query is gone.
          if (lastAtQueryRef.current.active || lastAtQueryRef.current.query) {
            lastAtQueryRef.current = { active: false, query: "" };
            onAtQueryChange?.("");
          }
          setTimeout(() => {
            const t = textareaRef.current;
            if (t) {
              t.focus();
              const pos = before.length;
              t.setSelectionRange(pos, pos);
              setCurrentCaretPos(pos);
              t.style.height = "auto";
              t.style.height = `${Math.min(t.scrollHeight, 150)}px`;
            }
          }, 0);
        }
        return;
      }
    }

    // Slash-command picker keyboard handling — runs BEFORE the existing
    // submit/history paths so the picker can intercept ArrowDown/ArrowUp/
    // Enter/Tab/Esc while it's open.
    if (showPicker) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashCount - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        // Respect the same submit-key shape as the regular send path: when
        // useCtrlEnterToSend is off, plain Enter (without Shift) commits the
        // selection; when it's on, only Cmd/Ctrl+Enter commits.
        const wantsCommit = useCtrlEnterToSend
          ? (e.metaKey || e.ctrlKey)
          : !e.shiftKey;
        if (wantsCommit && slashCount > 0) {
          e.preventDefault();
          setSlashCommitNonce((n) => n + 1);
          return;
        }
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (slashCount > 0) setSlashCommitNonce((n) => n + 1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (isStreaming) {
          onCancel();
        } else {
          // Dismiss the picker by clearing the in-progress slash command.
          setValue("");
          setSlashIndex(0);
          setHistoryIndex(-1);
          composingBuffer.current = "";
          const ta = textareaRef.current;
          if (ta) {
            ta.style.height = "auto";
          }
        }
        return;
      }
    }

    // Esc while the AI is generating cancels the stream. Bubble out otherwise
    // so editor Esc / popovers still close normally.
    if (e.key === "Escape" && isStreaming) {
      e.preventDefault();
      onCancel();
      return;
    }
    // Submit-key behavior:
    //  - useCtrlEnterToSend OFF (default): Enter sends, Shift+Enter newline
    //  - useCtrlEnterToSend ON:            Cmd/Ctrl+Enter sends, Enter newline
    if (e.key === "Enter") {
      if (useCtrlEnterToSend) {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          handleSend();
          return;
        }
        // Plain Enter: let the textarea insert a newline (default behavior)
      } else if (!e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }
    }

    // Up/Down arrows cycle through input history — but only when the textarea
    // is logically "single-line" so we don't hijack within multi-line edits.
    // Specifically: ArrowUp at the very start of the text, ArrowDown at the very end.
    const ta = textareaRef.current;
    if (!ta || inputHistory.length === 0) return;
    const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
    const atEnd = ta.selectionStart === value.length && ta.selectionEnd === value.length;

    if (e.key === "ArrowUp" && atStart) {
      e.preventDefault();
      // Stash the in-progress composition before browsing
      if (historyIndex === -1) composingBuffer.current = value;
      const next = Math.min(historyIndex + 1, inputHistory.length - 1);
      setHistoryIndex(next);
      const recalled = inputHistory[next];
      setValue(recalled);
      setTimeout(() => {
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
        ta.setSelectionRange(0, 0);
      }, 0);
    } else if (e.key === "ArrowDown" && atEnd && historyIndex >= 0) {
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      const recalled = next === -1 ? composingBuffer.current : inputHistory[next];
      setValue(recalled);
      setTimeout(() => {
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
        ta.setSelectionRange(recalled.length, recalled.length);
      }, 0);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const caretPos = e.target.selectionStart ?? newValue.length;
    setValue(newValue);
    setCurrentCaretPos(caretPos);
    setSlashIndex(0);
    setAtIndex(0);
    // Re-evaluate the `@` trigger and notify the parent if the (active, query)
    // tuple changed. Inactive collapses to query="" so the parent can clear
    // its match list / cancel pending fetches.
    const trig = detectAtTrigger(newValue, caretPos);
    const prev = lastAtQueryRef.current;
    if (trig.active !== prev.active || trig.query !== prev.query) {
      lastAtQueryRef.current = { active: trig.active, query: trig.query };
      onAtQueryChange?.(trig.active ? trig.query : "");
    }
    // Once the user edits, treat it as a new composition (so further ArrowUps
    // start fresh from the most recent history)
    if (historyIndex !== -1) {
      composingBuffer.current = newValue;
      setHistoryIndex(-1);
    }
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
  };

  /** Caret-only moves (arrow keys without typing, mouse clicks) need to
   *  re-evaluate the `@` trigger too — otherwise moving the cursor over an
   *  existing `@token` wouldn't reopen the picker. */
  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const caretPos = ta.selectionStart ?? 0;
    if (caretPos !== currentCaretPos) setCurrentCaretPos(caretPos);
    const trig = detectAtTrigger(ta.value, caretPos);
    const prev = lastAtQueryRef.current;
    if (trig.active !== prev.active || trig.query !== prev.query) {
      lastAtQueryRef.current = { active: trig.active, query: trig.query };
      onAtQueryChange?.(trig.active ? trig.query : "");
    }
  };

  const handleAtSelect = useCallback((match: FileMatch) => {
    // Replace the active `@<query>` span with `@<match.path> ` (trailing
    // space ends the trigger and lets the user keep typing). We re-detect
    // the trigger here against the current value+caret because the picker
    // calls back asynchronously and state may have moved.
    const ta = textareaRef.current;
    const caretPos = ta?.selectionStart ?? currentCaretPos;
    const trig = detectAtTrigger(value, caretPos);
    if (trig.start < 0) return;
    const before = value.slice(0, trig.start);
    const after = value.slice(caretPos);
    const inserted = `@${match.path} `;
    const next = before + inserted + after;
    setValue(next);
    setAtIndex(0);
    // The `@`-trigger is no longer active after insertion (trailing space).
    if (lastAtQueryRef.current.active || lastAtQueryRef.current.query) {
      lastAtQueryRef.current = { active: false, query: "" };
      onAtQueryChange?.("");
    }
    setTimeout(() => {
      const t = textareaRef.current;
      if (t) {
        t.focus();
        const pos = before.length + inserted.length;
        t.setSelectionRange(pos, pos);
        setCurrentCaretPos(pos);
        t.style.height = "auto";
        t.style.height = `${Math.min(t.scrollHeight, 150)}px`;
      }
    }, 0);
  }, [value, currentCaretPos, onAtQueryChange]);

  const handleSlashSelect = useCallback((cmd: SlashCommandDef) => {
    // Always set value to `/<name> ` (with trailing space) so the user can
    // immediately type args. The trailing space + non-empty name means the
    // picker visibility predicate still matches but `filterCommands` narrows
    // to the chosen command — which is fine; the next keystroke either
    // refines further or the user sends. If they delete back to bare `/`,
    // the full picker re-appears.
    const next = `/${cmd.name} `;
    setValue(next);
    setHistoryIndex(-1);
    composingBuffer.current = "";
    setSlashIndex(0);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(next.length, next.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
      }
    }, 0);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (!ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_IMAGE_SIZE) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        if (base64) {
          setAttachedImages((prev) => [
            ...prev,
            { data: base64, mediaType: file.type as ImageAttachment["mediaType"] },
          ]);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const ingestImageFile = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return;
    if (file.size > MAX_IMAGE_SIZE) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (base64) {
        setAttachedImages((prev) => [
          ...prev,
          { data: base64, mediaType: file.type as ImageAttachment["mediaType"] },
        ]);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) ingestImageFile(file);
      }
    }
  };

  // Drag-drop image attach. The whole input area is the drop target — we
  // surface a `.is-dragging` class so the user gets visual feedback that
  // they're hovering a valid drop zone. Non-image drops are ignored
  // silently (text drops fall through to the textarea's native behaviour).
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    if (isStreaming) return;
    // Only react to file drags. Text-selection drags don't carry `Files`.
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (isStreaming) return;
    if (!e.dataTransfer.types.includes("Files")) return;
    // Required to enable drop on the element.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    dragDepthRef.current = 0;
    setIsDragOver(false);
    if (isStreaming) return;
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    for (const file of Array.from(e.dataTransfer.files)) {
      ingestImageFile(file);
    }
  };

  const removeImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const placeholder = isStreaming
    ? (agentType === "qa" ? "QA Agent is reviewing..." : agentType === "design" ? "Design review in progress..." : agentType === "supervisor" ? "Supervisor is reviewing..." : "AI is working...")
    : agentMode
      ? (agentType === "qa" ? "Run QA review on your code..." : agentType === "design" ? "Review UI design quality..." : agentType === "supervisor" ? "Review and improve the current work..." : "Ask AI to code something...")
      : "Ask me anything...";

  return (
    <div
      className={`input-area${isDragOver ? " is-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="drop-hint" aria-hidden="true">
          Drop image to attach
        </div>
      )}
      {/* Image previews */}
      {attachedImages.length > 0 && (
        <div className="attached-images">
          {attachedImages.map((img, i) => (
            <div className="attached-image-preview" key={i}>
              <img src={`data:${img.mediaType};base64,${img.data}`} alt="Attached" />
              <button
                className="remove-image-btn"
                onClick={() => removeImage(i)}
                title="Remove"
                aria-label={`Remove attached image ${i + 1}`}
              >&times;</button>
            </div>
          ))}
        </div>
      )}
      {/* Row 1: Textarea with attach + send buttons */}
      <div style={{ position: "relative" }}>
        {showPicker && (
          <SlashCommandPicker
            prefix={value.trim().slice(1)}
            selectedIndex={slashIndex}
            commitNonce={slashCommitNonce}
            onSelect={handleSlashSelect}
            onCountChange={setSlashCount}
            customCommands={customSlashCommands}
          />
        )}
        {/* `@`-file picker. Mutually exclusive with the slash picker — the
            `showAtPicker` predicate already factors in `!showPicker`, but the
            explicit `&& !showPicker` here makes the precedence obvious. */}
        {showAtPicker && !showPicker && (
          <AtFilePicker
            matches={atMatches}
            selectedIndex={atIndex}
            commitNonce={atCommitNonce}
            onSelect={handleAtSelect}
          />
        )}
        <div className="input-wrapper">
        <button
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming}
          title="Attach screenshot (or paste from clipboard)"
          aria-label="Attach screenshot"
        >
          &#128247;
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={isStreaming}
          rows={1}
        />
        {isStreaming ? (
          <button
            className={`cancel-btn ${isCancelling ? "is-cancelling" : ""}`}
            onClick={onCancel}
            disabled={isCancelling}
            title={isCancelling ? "Cancelling…" : "Stop generation (Esc)"}
            aria-label={isCancelling ? "Cancelling" : "Stop generation"}
          >
            {isCancelling ? "…" : "■"}
          </button>
        ) : (
          <button
            className={`send-btn ${agentMode ? "agent-send" : ""}`}
            onClick={handleSend}
            disabled={!value.trim() && attachedImages.length === 0}
            title={agentMode ? "Send as agent (Enter)" : "Send message (Enter)"}
            aria-label={agentMode ? "Send as agent" : "Send message"}
          >
            {agentMode ? "\u26A1" : "\u2191"}
          </button>
        )}
        </div>
      </div>
      {/* Editor-context indicator — surfaces auto-attach so it isn't silent.
          Clicking opens a popover with the toggle + "Open file" affordance. */}
      {editorSnapshot && (
        <div className="editor-context-wrapper">
          <button
            type="button"
            className={`editor-context-indicator ${excludeEditorContext ? "excluded" : ""}`}
            onClick={() => setEditorContextPopoverOpen((v) => !v)}
            title={excludeEditorContext
              ? "The agent will NOT see this file on the next send. Click to manage."
              : "The agent automatically sees your active file and selection. Click to manage."}
            aria-label={`${excludeEditorContext ? "Editor context hidden — click to manage" : "Editor context active — click to manage"}: ${editorSnapshot.activeFile}${editorSnapshot.selectionLines ? `, ${editorSnapshot.selectionLines} lines selected` : ""}`}
            aria-haspopup="dialog"
            aria-expanded={editorContextPopoverOpen}
          >
            {excludeEditorContext ? "🚫" : "📎"} <span className="ec-path">{editorSnapshot.activeFile}</span>
            {editorSnapshot.selectionLines ? (
              <span className="ec-sel">
                ({editorSnapshot.selectionLines} {editorSnapshot.selectionLines === 1 ? "line" : "lines"} selected)
              </span>
            ) : null}
          </button>
          {editorContextPopoverOpen && (
            <div className="editor-context-popover" role="dialog" aria-label="Editor context options">
              <div className="ec-popover-row">
                <label className="ec-popover-toggle">
                  <input
                    type="checkbox"
                    checked={!excludeEditorContext}
                    onChange={onToggleExcludeEditorContext}
                  />
                  <span>Send active file & selection to the agent</span>
                </label>
                <div className="ec-popover-hint">
                  When off, the agent only sees what you type. Useful for sensitive
                  files or when you want to ask a general question.
                </div>
              </div>
              <div className="ec-popover-actions">
                <button
                  type="button"
                  className="ec-popover-link"
                  onClick={() => {
                    if (editorSnapshot) {
                      // Reuse existing openFile message — host already handles
                      // workspace-relative resolution.
                      getVsCodeApi().postMessage({ type: "openFile", path: editorSnapshot.activeFile });
                    }
                    setEditorContextPopoverOpen(false);
                  }}
                >
                  Open this file
                </button>
                <button
                  type="button"
                  className="ec-popover-link"
                  onClick={() => setEditorContextPopoverOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Row 2: Controls below textarea
          Single segmented control collapses Agent/Chat + agent-type into
          one row of four equal-weight tabs. Picking Chat exits agent
          mode; the three agent types implicitly enable agent mode.
          Right-aligned: a permission-mode dropdown (subsumes the legacy
          Plan toggle), the model picker, optional effort selector. All
          controls share the flat `mode-tab` / `mode-select` look so the
          row reads as configuration, not a row of competing buttons. */}
      <div className="input-controls">
        <div className="mode-segment" role="tablist" aria-label="Mode">
          {([
            { key: "coder" as const, label: "Code", title: "Coding agent: writes and edits code" },
            { key: "qa" as const, label: "QA", title: "QA agent: reviews code for bugs and improvements" },
            { key: "design" as const, label: "Design", title: "Design reviewer: audits UI quality and suggests improvements" },
          ]).map((m) => {
            const active = agentMode && agentType === m.key;
            return (
              <button
                key={m.key}
                role="tab"
                aria-selected={active}
                className={`mode-tab ${active ? "active" : ""}`}
                onClick={() => {
                  if (!agentMode) onToggleAgentMode();
                  onSetAgentType(m.key);
                }}
                disabled={isStreaming}
                title={m.title}
              >
                {m.label}
              </button>
            );
          })}
          <button
            role="tab"
            aria-selected={!agentMode}
            className={`mode-tab ${!agentMode ? "active" : ""}`}
            onClick={() => { if (agentMode) onToggleAgentMode(); }}
            disabled={isStreaming}
            title="Chat mode — conversation only, no tool use"
          >
            Chat
          </button>
        </div>

        <span className="input-controls-spacer" />

        {/* Hidden hooks for backwards compatibility — the old single-button
            Agent/Chat toggle and the standalone agent-type buttons live
            on as no-op JSX so existing prop wiring stays intact. They
            never render. */}
        <button
          style={{ display: "none" }}
          className={`mode-toggle ${agentMode ? "mode-agent" : "mode-chat"}`}
          onClick={onToggleAgentMode}
          disabled={isStreaming}
          title={agentMode ? "Agent mode: AI can edit files and run commands" : "Chat mode: conversation only"}
        >
          {agentMode ? "\u26A1 Agent" : "\u{1F4AC} Chat"}
        </button>
        {/* Old standalone agent-type buttons replaced by the mode-segment
            tablist above. Block intentionally removed. */}
        {/* Permission-mode dropdown subsumes the legacy Plan toggle. Hidden
            inline while on Default — reachable via the `⋯` overflow button
            below. Once the user picks Plan / Accept-edits / Bypass it
            stays visible inline so the active state isn't hidden. */}
        {onPermissionModeChange && permissionMode !== "default" && (
          <select
            className={`mode-select ${permissionMode === "bypass" ? "danger" : "active"}`}
            value={permissionMode}
            onChange={(e) => {
              const m = e.target.value as "default" | "plan" | "accept-edits" | "bypass";
              if (m === "bypass") {
                const ok = window.confirm(
                  "Bypass mode auto-allows EVERY tool — including file writes and shell commands — for the rest of this conversation. Settings deny rules and hooks still apply, but you won't see approval prompts.\n\nAre you sure?",
                );
                if (!ok) return;
              }
              if (!agentMode && m !== "default") onToggleAgentMode();
              onPermissionModeChange(m);
            }}
            disabled={isStreaming}
            title={
              permissionMode === "plan"
                ? "Plan mode — agent reads and proposes, doesn't write or run."
                : permissionMode === "accept-edits"
                  ? "Accept-edits mode — file reads and writes auto-allowed; terminal commands still prompt."
                  : "Bypass mode — every tool auto-allowed (deny rules and hooks still enforced)."
            }
            aria-label="Permission mode"
          >
            <option value="default">Default</option>
            <option value="plan">Plan</option>
            <option value="accept-edits">Accept edits</option>
            <option value="bypass">Bypass</option>
          </select>
        )}
        {/* Hidden no-op fallback retains backwards-compat with hosts that
            don't wire `onPermissionModeChange`. Never visible. */}
        <button
          style={{ display: "none" }}
          className={`agent-type-btn ${planMode ? "active plan-mode-on" : ""}`}
          onClick={() => {
            if (!agentMode) onToggleAgentMode();
            onTogglePlanMode();
          }}
          disabled={isStreaming}
          tabIndex={-1}
          aria-hidden="true"
        >
          {planMode ? "Plan ON" : "Plan OFF"}
        </button>
        {availableModels.length > 0 && (
          <select
            className="mode-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isStreaming}
            title="Select AI model"
            aria-label="Model"
          >
            {(() => {
              const codeModels = availableModels.filter((m) => m.category === "code");
              const chatModels = availableModels.filter((m) => m.category === "chat");
              const reasoningModels = availableModels.filter((m) => m.category === "reasoning");
              const uncategorized = availableModels.filter((m) => !m.category);
              return (
                <>
                  {codeModels.length > 0 && (
                    <optgroup label="Code">
                      {codeModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  )}
                  {chatModels.length > 0 && (
                    <optgroup label="Chat">
                      {chatModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  )}
                  {reasoningModels.length > 0 && (
                    <optgroup label="Reasoning">
                      {reasoningModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  )}
                  {uncategorized.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </>
              );
            })()}
          </select>
        )}
        {/* Effort hidden inline while default; reachable via ⋯ overflow.
            Once picked, stays inline so the active state is visible. */}
        {agentMode && onEffortChange && effort && (
          <select
            className="mode-select active"
            value={effort}
            onChange={(e) => {
              const v = e.target.value;
              onEffortChange(v === "" ? null : (v as "low" | "medium" | "high"));
            }}
            disabled={isStreaming}
            title="Reasoning effort: how much the model thinks before answering. Higher = slower + more tokens but better on hard problems."
            aria-label="Effort"
          >
            <option value="">Effort</option>
            <option value="low">Effort: Low</option>
            <option value="medium">Effort: Medium</option>
            <option value="high">Effort: High</option>
          </select>
        )}
        {/* Overflow button \u2014 opens a small popover with Permission + Effort
            so users can reach them when they're hidden inline. Reuses the
            same select widgets, so picking a non-default value flips them
            inline next render. */}
        {(onPermissionModeChange || (agentMode && onEffortChange)) && (
          <div className="overflow-wrapper">
            <button
              type="button"
              className="overflow-btn"
              onClick={() => setOverflowOpen((v) => !v)}
              disabled={isStreaming}
              aria-label="More options"
              aria-haspopup="dialog"
              aria-expanded={overflowOpen}
              title="More options \u2014 Permission, Effort"
            >
              {"\u22ef"}
            </button>
            {overflowOpen && (
              <div className="overflow-popover" role="dialog" aria-label="More options">
                {onPermissionModeChange && (
                  <label className="overflow-row">
                    <span className="overflow-row-label">Permission</span>
                    <select
                      className="mode-select"
                      value={permissionMode}
                      onChange={(e) => {
                        const m = e.target.value as "default" | "plan" | "accept-edits" | "bypass";
                        if (m === "bypass") {
                          const ok = window.confirm(
                            "Bypass mode auto-allows EVERY tool \u2014 including file writes and shell commands \u2014 for the rest of this conversation. Settings deny rules and hooks still apply, but you won't see approval prompts.\n\nAre you sure?",
                          );
                          if (!ok) return;
                        }
                        if (!agentMode && m !== "default") onToggleAgentMode();
                        onPermissionModeChange(m);
                      }}
                      disabled={isStreaming}
                    >
                      <option value="default">Default</option>
                      <option value="plan">Plan</option>
                      <option value="accept-edits">Accept edits</option>
                      <option value="bypass">Bypass</option>
                    </select>
                  </label>
                )}
                {agentMode && onEffortChange && (
                  <label className="overflow-row">
                    <span className="overflow-row-label">Effort</span>
                    <select
                      className="mode-select"
                      value={effort ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        onEffortChange(v === "" ? null : (v as "low" | "medium" | "high"));
                      }}
                      disabled={isStreaming}
                    >
                      <option value="">Default</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="overflow-close"
                  onClick={() => setOverflowOpen(false)}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}

        <span className="input-hint" title="Tips rotate every 5 seconds. Use \u2191 to recall the last message.">
          {isStreaming
            ? "Stop"
            : useCtrlEnterToSend
              ? `\u2318+Enter \u2191 ${rotatingHint}`.trim()
              : `Enter \u2191 ${rotatingHint}`.trim()}
        </span>
      </div>
    </div>
  );
}
