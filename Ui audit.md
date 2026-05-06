# UI Audit — Claude Code VS Code extension vs ours

Comparing our chat webview (`apps/extension/webview/`) against Claude Code's VS Code extension. Scope: **VS Code extension only**, not the CLI. Format: checklist first per area, deep dives only on weak spots.

Legend: ✓ done · ✗ missing · ⚠️ buggy / partial · gap = they have it, we don't · we're better = we have it, they don't.

---

## Audit plan

**Section 1 — Core chat surface**
1.1 Chat input — multiline, paste, image paste, drag-drop, @-mention, slash autocomplete, queued msgs, escape
1.2 Message rendering — markdown, syntax hl, copy buttons, collapsible blocks, streaming cursor, token/cost, retry/edit
1.3 File references — clickable links, line ranges, hover preview, open in editor / open as diff
1.4 Tool calls display — collapsed by default, expandable, streaming output, status, permission prompts
1.5 Diff/edit display — inline vs side-by-side, accept/reject per hunk, "open in diff editor" handoff

**Section 2 — Agent control**
2.1 Slash commands — autocomplete, built-ins (`/clear`, `/help`, `/init`, `/compact`, `/resume`, `/agents`, `/memory`, `/model`, `/cost`), custom command UI
2.2 Subagents — visibility when one is running, interrupt, results surfacing
2.3 Plan mode / Edit mode — entry, indicator, exit flow
2.4 Memory / CLAUDE.md — view/edit UI, "remembered this" indicators
2.5 Model picker — mid-session switch, current model display, fast mode

**Section 3 — Session management**
3.1 History/resume — list past sessions, search, resume, branch from a point
3.2 Cost & usage — running cost, `/cost`, budget warnings
3.3 Context window indicator — fullness, auto-compact warning
3.4 Cancel / interrupt — Esc behavior, partial-result handling

**Section 4 — Editor integration**
4.1 Selection context — auto-attach editor selection, current file
4.2 Inline assistance — quick-fix, code actions, right-click "Ask Claude"
4.3 Status bar / activity bar — presence, badges, click-to-open
4.4 Notifications — task complete, permission needed, opt-out
4.5 Workspace trust / multi-root

**Section 5 — Permissions & safety**
5.1 Permission modes — UI switch (default / accept-edits / plan / bypass), per-tool overrides, allow/deny lists
5.2 Hooks — discoverability, settings UI, debugging

**Section 6 — Settings & onboarding**
6.1 Settings UI — model, key, MCP, hooks, keybindings in one place
6.2 MCP servers — add/remove/status, log viewing
6.3 Onboarding — first-run, sample prompts, capability discovery
6.4 Keybindings — defaults, customization, in-UI shortcut display

**Section 7 — Polish**
7.1 Themes — dark/light, VS Code theme match
7.2 Accessibility — keyboard nav, screen reader, focus
7.3 Performance — startup, long scrollback, image-heavy
7.4 Telemetry/feedback — feedback button, error reporting

---

## 1.1 Chat input

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Enter to send, Shift+Enter newline | ✓ | ✓ | match |
| 1b | Auto-resize textarea (capped) | ✓ 150px cap | ✗ panel resize only | we're better |
| 1c | Configurable submit key (Ctrl+Enter) | ✗ | ✓ `useCtrlEnterToSend` | gap |
| 2 | Text paste | ✓ | ✓ | match |
| 2b | Image paste from clipboard | ✓ PNG/JPEG/GIF/WebP, 5MB | unspecified | we're better |
| 3 | Drag-drop files/folders into input | ✗ | ✓ Shift+drag adds as attachment | gap |
| 4 | @-mention file autocomplete | ✗ | ✓ fuzzy match files + folders | **major gap** |
| 4b | @-mention page ranges (PDFs) | ✗ | ✓ `@file.pdf` page 1-10 | gap |
| 4c | `@terminal:name` reference | ✗ | ✓ | gap |
| 4d | Hotkey to insert `@file#L5-10` from selection | ✗ | ✓ Alt+K / Opt+K | **major gap** |
| 5 | Slash command autocomplete (typing `/` opens menu) | ✗ | ✓ | **major gap** (we have no slash commands at all) |
| 6 | Queued messages while busy | ✗ disabled | unspecified | unclear, worth considering |
| 7 | Esc to cancel generation | ✗ | unclear | gap |
| 8 | Up/Down to recall input history | ✓ with composing buffer | ✗ not documented | we're better |
| 9 | Image thumbnails before send + remove button | ✓ | ✓ X to remove | match |
| 10a | Permission mode indicator inside input | ✗ | ✓ click to switch modes | gap |
| 10b | Context window fullness indicator | ✗ | ✓ | gap (also section 3) |
| 10c | Extended thinking toggle | ✗ | ✓ | gap |
| 10d | Selection tracking ("3 lines selected, click to hide") | ✗ | ✓ eye-slash icon | **major gap** |
| 11 | Mode toggle Chat/Agent + Plan/Agent type | ✓ | ✓ via slash menu | match (different UX) |
| 12 | Model picker | ✓ inline `<select>` | ✓ via slash menu | match |
| 13 | Edit & resend (prefill from earlier message) | ✓ | ✗ | we're better |

**Top misses ranked by impact**

1. **No `@` file autocomplete** — biggest single gap. Claude Code users learn this in week one and use it constantly. Without it, our users paste paths or rely on the editor selection.
2. **No `/` slash commands** — even bigger because it gates *everything else* (model switching, mode switching, MCP, etc., all flow through `/` in Claude Code). Belongs to section 2.1 too.
3. **No selection-aware indicator** — Claude Code shows "X lines selected" + an eye-slash to opt out. Ours implicitly captures editor selection without surfacing it. Cheap to add visibility.
4. **No Alt-K / quick-insert-file-ref hotkey** from the editor.
5. **No drag-drop into input** — image paste covers most of it.

**Things we do better**

- Image clipboard paste with mime/size validation, preview, remove
- Up/down input history with composing buffer
- Edit & resend a previous user message
- Auto-resize textarea capped at 150px

**Code references**: [ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx)

---

## 1.2 Message rendering

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Markdown (headings/lists/blockquotes) | ✓ via marked + GFM | ✓ basic | match |
| 1b | Tables | ✓ (GFM) | unclear | likely match |
| 2 | Inline vs fenced code styling | ✓ | ✓ | match |
| 3 | Syntax highlighting in code blocks | ✓ highlight.js, theme follows our CSS | ⚠️ hardcoded dark theme (issue #8879, closed "not planned") | **we're better** |
| 4 | Copy button on code blocks | ✓ "Copy" → "Copied!" 2s feedback | ✗ doesn't exist (issues #12413, #24993) | **we're better** |
| 5 | Long code block collapse / max-height | ✗ | ✗ | match (both miss) |
| 6 | Streaming cursor on last block | ✓ | ✓ progressive | match |
| 6b | Streaming elapsed timer | ✓ "12s" / "2:05" next to AI label | ✗ | we're better |
| 7 | Token counts per message | ⚠️ written but unrendered (MessageBubble unused) | ✗ (issue #33819) | tied — and we have a fixable bug |
| 7b | Cost per message ($) | ✓ in MessageList | ✗ | **we're better** |
| 8 | Retry / regenerate assistant message | ✗ | ✗ | match |
| 9 | Edit & resend user message | ✓ ✎ Edit button | ✗ | **we're better** |
| 10 | Timestamps on messages | ⚠️ in MessageBubble (unused), ✗ in MessageList | ✗ (issue #37929) | tied — fixable |
| 11 | Role labels | ✓ YOU/AI | ✓ | match |
| 12 | Image rendering inside messages | ⚠️ in MessageBubble (unused), ✗ in MessageList | ✓ via `@file` | **gap (and a bug)** |
| 13 | Extended thinking blocks | ✗ — we don't render reasoning at all | ✓ collapsible (Ctrl+O) | **gap** |
| 14 | Auto-scroll respecting manual scrollback | ✓ | unclear | likely match |
| 14b | Jump-to-bottom button when scrolled away | ✓ "↓ New" | unclear | likely we're better |
| 15 | Empty state with sample prompts | ✓ | unclear | likely we're better |
| 16 | Billing/error special card | ✓ inline card for suspended/cap-reached | ✗ | we're better |
| 17 | Agent completion banner | ✓ "Completed · X turns · Y tools · $Z" | ✗ | we're better |
| 18 | Hover checkpoint/rewind | ✗ | ✓ fork or rewind code on hover | **gap** |

**Top misses ranked by impact**

1. **Orphaned `MessageBubble` component** — has timestamps, image rendering, and per-message token counts that the live `MessageList` rendering path doesn't use. Most painful symptom: **uploaded images aren't shown back to the user in the conversation**, which is a real bug. Fix = either delete `MessageBubble` or merge its features into the `MessageList` render path.
2. **Extended thinking / reasoning blocks** — when we use a reasoning model, we have nowhere to render the thought content. Claude Code shows it as collapsible blocks. Worth adding once we wire reasoning models.
3. **No long-code-block collapse** — both extensions miss this, but Claude Code users actively complain about it. Easy win for us.
4. **No checkpoint/rewind** — Claude Code lets you click "fork from here" on hover. Bigger feature; mostly belongs to section 3.

**Things we do better**

- Theme-respecting syntax highlighting (Claude Code's is hardcoded dark, actively complained about)
- Copy button on code blocks (Claude Code doesn't have one)
- Per-message cost display
- Edit & resend
- Streaming elapsed timer
- Billing/error inline card
- Agent completion banner

**Code references**: [MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx) · [MessageBubble.tsx](apps/extension/webview/src/components/MessageBubble.tsx) (orphaned) · [markdown.ts](apps/extension/webview/src/utils/markdown.ts)

---

## 1.3 File references

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Markdown `[file](path)` links rendered as visual links | ✓ default marked behavior | ✓ styled blue/underlined | match |
| 2 | Click opens file in editor | ✗ no handler | ✗ broken (issue #51015) | match (both broken) |
| 3 | Bare paths (`src/foo.ts:42`) auto-detected as links | ✗ | ✗ | match |
| 4 | Line numbers honored on open | ✗ | ✗ (links don't work at all) | match |
| 5 | Line ranges (`:42-51`) honored | ✗ | ✗ | match |
| 6 | Hover preview / peek of file content | ✗ | ✗ | match |
| 7 | "Open as diff" vs "open in editor" | ✗ | ✗ | match |
| 8 | Folder references clickable | ✗ | ✗ | match |
| 9 | URL handling — open in browser | ⚠️ default `<a href>` works but no `target="_blank"`, may be CSP-blocked | ⚠️ similar | likely match |
| 10 | Right-click context (copy path, reveal in OS) | ✗ | ✗ | match |
| 11 | File-existence indicator (broken-link feedback) | ✗ | ✗ | match |
| 12 | Workspace-relative vs absolute path distinction | ✗ | ✗ | match |
| 13 | Postmessage channel for "open file" requests | ✗ no channel exists | ✗ broken | match |

**Top opportunities ranked by impact**

1. **Make file links actually work** — biggest user-facing improvement; Claude Code is publicly broken here (issue #51015), so we can be measurably better with a few hours of work. Implementation sketch:
   - Override `marked` link renderer to emit `<a class="file-link" data-path="..." data-line="..." data-end-line="...">` when the URL matches a path-with-optional-line pattern.
   - Click handler in `MessageList` delegates to `vscode.postMessage({ type: "openFile", path, line, endLine })`.
   - New case in `ChatViewProvider.onDidReceiveMessage`: resolve relative to workspace root, call `vscode.window.showTextDocument(uri, { selection: new Range(line-1, 0, endLine-1, Infinity) })`.
2. **Auto-detect bare paths** — without `[text](url)` markdown wrapping. The model often emits `src/foo.ts:42` in plain prose. Post-process rendered HTML text nodes against the path regex and rewrite into anchors.
3. **Distinguish diff vs editor** — once edits appear in the conversation, a "View diff" affordance next to the file name. Mostly belongs to 1.5.
4. **Hover preview** — read first ~20 lines on hover, show in a tooltip. Bigger effort, nice-to-have.

**Things we do better**: nothing yet — both extensions are about equally weak here.

**Things they do (slightly) better**: visual styling — Claude Code's broken links at least *look* like links; ours aren't visually distinct from regular text.

**Code references**: [markdown.ts](apps/extension/webview/src/utils/markdown.ts) (no link customization) · [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts) (no `openFile` message handler) · [MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx) (no link click delegation)

---

## 1.4 Tool calls display

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Default state — collapsed | ✓ | ✓ | match |
| 1b | Auto-expand running tool (latest only) | ✓ when latest stream item | ✗ stays collapsed | we're better |
| 2 | Header — tool label + one-line summary | ✓ per-tool descriptions | ✓ tool name + status | match |
| 2b | Edit diffstats (+X/-Y lines) in collapsed header | ✗ | ✓ | **gap** |
| 3 | Status visuals — running/done/failed | ✓ 3-color dot | ✓ spinner / ✓ / ✗ | match |
| 3b | "Denied" status | ✓ distinct error color | ✗ unclear | we're better |
| 4 | Live streaming output during tool run | ✗ result swaps in at end | ✗ also waits for completion | match (both miss) |
| 5 | Expand/collapse interaction | ✓ click header (tabIndex) | ✓ click header | match |
| 5b | Keyboard shortcut to expand/collapse all | ✗ | ✓ Ctrl+O (transcript mode) | gap |
| 6a | Read tool — content with line numbers | ✗ raw text in OUT block | ✓ inline numbered | gap |
| 6b | Edit tool — diff view post-completion | ⚠️ approval card has find/replace; tool item shows raw IN/OUT | ✓ native VS Code side-by-side diff viewer | **major gap** |
| 6c | Bash — terminal-like rendering | ⚠️ plain `<pre>` | ✓ command output | likely match |
| 6d | Grep / search — results as clickable list | ✗ raw text dump | ✓ summary + expand | gap |
| 6e | Glob / list — file-tree style | ✗ raw text | unclear | likely match |
| 7 | Permission prompts — inline cards (not modal) | ✓ ApprovalCard inline in stream | ✓ inline cards | match |
| 8 | Approve / deny buttons | ✓ Allow / Allow-all-this-chat / Deny | ✓ Approve / Reject | match |
| 8b | "Always allow this tool / path" in UI | ✗ | ✗ in UI (settings.json only) | match |
| 8c | Deny with reason | ✗ | ✗ | match |
| 9 | Tool error display | ✓ red OUT block, copyable | ✓ result block, copyable | match |
| 10 | Tool arguments — full / truncated | ✓ formatted IN block; raw fallback at 500 chars | ✓ shown in approval; hidden after | match |
| 11 | Long output truncation w/ "Show all" | ✓ at 1500 chars, char count, toggle | ✗ not truncated | **we're better** |
| 12a | Elapsed timer per tool | ✓ "12s" while running | ✗ | we're better |
| 12b | Tab indicators (blue=pending, orange=finished hidden) | ✗ | ✓ | gap (section 4.3) |
| 12c | Rewind / fork on hover (per tool) | ✗ | ✓ | gap (1.2 / 3.1) |
| 12d | "X of Y tools" batch grouping for parallel calls | ✗ | ✗ | match |
| 13 | Approval has rich edit/find-replace/command rendering | ✓ + / − blocks | ✓ proposed action | match — but ours shows only on approval, not post-completion |

**Top misses ranked by impact**

1. **Edit / write tools should render as diffs after completion**, not just raw text. Today the `ApprovalCard` has nice find/replace coloring, but once the tool completes, `ToolCallDisplay` collapses back to plain IN/OUT text. Claude Code uses VS Code's native side-by-side diff viewer. Fix sketch: when `toolName === "edit_file"` or `"write_file"` and status is completed, render the same find/replace blocks as the approval card, or hand off to VS Code's diff viewer via `vscode.diff` URI scheme. (Strong tie-in to 1.5.)
2. **Diffstat in collapsed header** — e.g. "Edit src/foo.ts +12 −3". Small change, big information density gain.
3. **Per-tool custom rendering for Read / Grep**:
   - `read_file`: render content with `1│ 2│ 3│` line gutter so users can scroll the OUT block as if it were a code editor
   - `search_files`: parse tool result into `path:line: match` rows, render as a clickable list (ties to 1.3)
4. **Keyboard shortcut to collapse/expand all tool calls** in the conversation.
5. **Tab/badge indicators** when chat is hidden and a tool awaits permission or finishes (section 4.3).

**Things we do better**

- Auto-expand the latest running tool — lower friction watching what's happening
- Per-tool elapsed timer
- Long-output truncation with explicit char count and "Show all" toggle
- "Allow all (this chat)" button — Claude Code only configures always-allow via `settings.json`
- "Denied" as a distinct visual state

**Code references**: [ToolCallDisplay.tsx](apps/extension/webview/src/components/ToolCallDisplay.tsx) · [ApprovalCard.tsx](apps/extension/webview/src/components/ApprovalCard.tsx) · [MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx)

---

## 1.5 Diff / edit display

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Inline-in-chat preview of proposed edits | ✓ ApprovalCard with +/− blocks | ✓ small edits inline | match |
| 1b | Side-by-side native diff editor for proposed edits | ✗ | ✓ for larger edits | **major gap** |
| 2 | Uses `vscode.diff` URI scheme | ✗ | ✓ | gap |
| 3 | Accept / reject per hunk | ✗ all-or-nothing per tool call | ✗ all-or-nothing per file | match |
| 3b | Edit proposed content in diff before accepting (Claude rechecks) | ✗ | ✓ | **gap** |
| 4 | Multi-file edits — list view | ✗ shown sequentially in stream | ✗ one diff at a time | match |
| 5 | Pre-approved (proposed first) by default | ✓ via ApprovalCard / ApprovalService | ✓ | match |
| 5b | Auto-accept mode | ✓ "Allow All This Session" | ✓ permission mode | match |
| 6 | Diff color/styling | custom CSS | VS Code native theme colors | gap (low priority) |
| 7 | Undo applied edits | ⚠️ relies on `WorkspaceEdit` so VS Code Cmd+Z works | ✓ checkpoints + rewind UI | gap (3.1) |
| 8 | Click file ref in chat → jump to diff | ✗ (no link handlers — see 1.3) | ⚠️ `@file:#L5-10` | gap (1.3) |
| 9 | Visual cue while editing in progress | ✗ | ✓ tab dot (blue=pending, orange=done hidden) | gap (4.3) |
| 10 | Streaming edits into file | ✗ full swap at end | ✗ full swap at end | match |
| 11 | Line numbers / +/− markers in diffs | ⚠️ +/− tinting only, no line numbers | ✓ native VS Code gutter, syntax-highlighted | **gap** |
| 12a | Plan mode opens markdown plan as document | ⚠️ Plan toggle exists; no plan-as-document UI | ✓ | gap (2.3) |
| 12b | Drag-wider sidebar for diff preview | ✓ standard VS Code panel resize | ✓ | match |
| 12c | Accept-all button across multi-file edits | ✗ | ✗ | match |
| 13 | **Two parallel approval surfaces — ApprovalCard (rich inline) AND ApprovalService (OS modal)** | ⚠️ inconsistency bug | n/a | **bug** |
| 14 | "Edited X (+12 −3 lines)" summary after apply | ⚠️ ToolExecutor returns it as text; UI doesn't surface stats | unclear | gap (1.4) |
| 15 | After-apply view in editor | ✓ `showTextDocument` opens file in preview after edit | ✓ in diff view | partial gap — we use file preview, they use diff |

**Top misses ranked by impact**

1. **No native side-by-side diff viewer for proposed edits.** Biggest single gap and the most reachable — VS Code's `vscode.diff` does the heavy lifting. Sketch:
   - On approval for `edit_file` / `write_file`, render an "Open in diff" button on `ApprovalCard`
   - Button posts `{type: "showProposedDiff", path, oldText, newText}` to the host
   - Host writes proposed content to a `untitled:` virtual doc, then `vscode.commands.executeCommand("vscode.diff", origUri, proposedUri, "Proposed: <path>")`
   - User can edit the right side; on Allow, host re-reads the right side instead of trusting original `new_text`
2. **Two approval surfaces — pick one.** `ApprovalService` (OS modal) and `ApprovalCard` (rich inline) both exist; depending on code path, users see different UIs. Recommend deleting `ApprovalService.requestApproval` and routing everything through `ApprovalCard`.
3. **Show diffstats post-apply** — both in the collapsed tool header (1.4) and in conversation flow ("Edited foo.ts +12 −3"). Already computed in [ToolExecutor.ts:177-178](apps/extension/src/services/ToolExecutor.ts#L177-L178), just stop discarding it.
4. **Plan mode should produce a plan document, not just a toggle**. Today `Plan: ON` only changes the system prompt; Claude Code opens a markdown plan you can comment on inline. Section 2.3 issue too.
5. **Allow editing the proposed content before accepting** — once we have the diff viewer, this is almost free: read the right-hand side when Allow is clicked.

**Things we do better**

- Inline find/replace card with copy buttons on each block — denser than Claude Code's inline diff
- "Allow All This Session" button — Claude Code only does this via permission mode setting
- Inline status visual on the completed tool call (1.4) — Claude Code only shows tab dot

**Code references**: [ApprovalCard.tsx](apps/extension/webview/src/components/ApprovalCard.tsx) (rich inline path) · [ApprovalService.ts](apps/extension/src/services/ApprovalService.ts) (OS modal — duplicate path) · [ToolExecutor.ts:130-180](apps/extension/src/services/ToolExecutor.ts#L130-L180) (edit_file uses WorkspaceEdit, no diff view)

---

## 2.1 Slash commands

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Typing `/` opens a command picker | ✗ | ✓ inline command menu | **major gap** |
| 2 | Fuzzy match as you type | ✗ | ✓ | gap |
| 3 | `/clear` (new conversation) | ⚠️ via Cmd Palette `ailancers.newConversation` | ✓ | gap (function exists, no slash) |
| 3a | `/compact` (summarize, free context) | ✗ | ✓ | **gap** |
| 3b | `/model` (pick model) | ⚠️ inline `<select>` instead | ✓ | match (different UI) |
| 3c | `/usage` / `/cost` (session cost) | ⚠️ shown per-message and in completion banner, no on-demand cmd | ✓ | gap |
| 3d | `/memory` (edit CLAUDE.md) | ✗ | ✓ | gap (also 2.4) |
| 3e | `/mcp` (manage MCP servers) | ✗ MCP not supported | ✓ | major gap (also 6.2) |
| 3f | `/config` (open settings) | ⚠️ via VS Code settings UI | ✓ | gap |
| 3g | `/copy` (copy last response) | ⚠️ per-codeblock copy, not whole response | ✓ | gap |
| 3h | `/export` (export conversation) | ✓ via Cmd Palette | ✓ | match (no slash entry) |
| 3i | `/help` | ✗ | ✓ | gap |
| 3j | `/plugins` (manage plugins) | ✗ no plugin system | ✓ graphical UI | major gap |
| 3k | `/review` (review PR locally) | ✗ | ✓ | gap |
| 3l | `/focus` (fullscreen quiet view) | ✗ | ✓ | nice-to-have |
| 3m | `/resume` / `/continue` | ⚠️ via conversation list sidebar | ✓ | match (different UI) |
| 3n | `/init` (create CLAUDE.md) | ✗ | ✓ | gap (also 2.4) |
| 3o | `/agents` (manage agents) | ⚠️ inline Code/QA/Design buttons, no config | ✓ | gap (also 2.2) |
| 4 | Argument hints in picker (`/model <name>`) | ✗ | ✓ | gap |
| 5 | Where results render — inline in chat | ✗ | ✓ inline + occasional modal | gap |
| 6 | Custom user-defined commands / skills | ✗ | ✓ via skills system | gap |
| 7 | Project-level vs user-level scopes | ✗ | ✓ for plugins/skills | gap |
| 8 | Templating with `$ARGUMENTS` etc. | ✗ | ⚠️ via skills prompts | gap |
| 9 | Plugin/MCP commands appear in same picker | ✗ | ✓ as `/mcp__server__prompt` | gap |
| 10 | Categorization in picker | ✗ | ✓ groups built-in / skills / MCP | gap |

**Top misses ranked by impact**

1. **No slash-command system at all** — the single biggest behavioral gap of the audit so far. Every Claude Code user types `/` constantly. Also gates a lot of section 2/3/6 features (`/model`, `/cost`, `/memory`, `/agents`, `/mcp`, `/config`, `/plugins`). Build this as a foundation before adding individual features.

2. **Suggested incremental build order**:
   - **Phase 1** — `ChatInput` detects leading `/`, opens a popover listing commands; arrow keys + Enter to select. Basic registry of built-ins; intercepted send dispatches the command instead of posting to AI.
   - **Phase 2** — Wire built-ins where we already have the behavior, just not a slash entry: `/clear` → newConversation, `/export` → exportConversation, `/cost` → render usage card, `/copy` → copy last assistant message, `/model <name>` → switch model, `/agent <code|qa|design>` → switch agent type, `/plan` → toggle plan mode.
   - **Phase 3** — `/help`, `/compact` (needs server-side context summarization), `/memory` (depends on 2.4), `/init`.
   - **Phase 4** — `/mcp` (depends on MCP support — 6.2), `/agents` config UI (2.2), custom user commands as `.claude/commands/*.md` with `$ARGUMENTS` templating.

3. **Argument hints in picker** — once it exists, `/model ‹pick a model›` with completion of available model names is high leverage.

**Things we do better**

- Inline UI buttons for **agent type, plan mode, model select** — discoverable without typing `/`. Treat slash as a power-user accelerator, not a replacement.
- Completion banner already shows `Completed · X turns · Y tools · $Z`.

**Code references**: [ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx) (no `/` parsing) · [ChatViewProvider.ts:39-117](apps/extension/src/providers/ChatViewProvider.ts#L39-L117) (host message switch — no command dispatch) · [package.json:69-118](apps/extension/package.json#L69-L118) (Cmd Palette commands — closest equivalent)

---

## 2.2 Subagents

> **Concept gap**: Claude Code subagents are a fundamentally different idea from our "agent types". Theirs are *named, configurable, individually-scoped workers* that the main conversation can spawn as nested forks running in parallel with their own transcripts. Ours are system-prompt swaps that change the *whole* conversation's persona — no nesting, no parallelism, no separate transcript.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Concept — named, configurable workers | ⚠️ "agent type" — fixed enum (`coder`/`qa`/`design`/`supervisor`), changes system prompt only | ✓ named, configurable subagents | **fundamental gap** |
| 1b | Subagents nest under a parent conversation | ✗ flat conversation only | ✓ forked sub-conversations | **major gap** |
| 2 | User-defined subagents via `.md` files | ✗ | ✓ `.claude/agents/*.md` + YAML frontmatter | **major gap** |
| 2b | Rich frontmatter (`tools`, `model`, `permissionMode`, `maxTurns`, `memory`) | ✗ | ✓ | gap |
| 3 | Built-in agents | ⚠️ ours: Code/QA/Design/Supervisor (prompt-only) | ✓ Explore / Plan / General / etc. | difference of kind |
| 4 | Trigger by natural-language naming | ⚠️ click button before send | ✓ | gap |
| 4b | Trigger by `@agent-name` typeahead | ✗ | ✓ | **gap** |
| 4c | `/agents` command (manage + spawn) | ✗ | ✓ | gap (also 2.1) |
| 4d | Session-wide default agent (settings) | unclear | ✓ | likely gap |
| 5 | Live "Agent X is working" indicator | ✓ `AgentStatusBar` (label / turn / tools / cost / timer / Stop) | ✓ Running tab | match (different UX) |
| 5b | Separate panel/tab for running subagents | ✗ | ✓ tabbed (Running / Library) | gap |
| 5c | Multiple visible running agents simultaneously | ✗ one bar | ✓ multi-row panel | gap |
| 6 | Interrupt running subagent without killing parent | ✗ Stop kills the only conversation | ✓ press `x` on a row | **major gap** |
| 6b | Background a foreground subagent (Ctrl+B) | ✗ | ✓ | gap |
| 7 | Subagent full transcript viewable | ✗ no separate transcript | ✓ Running tab → click | **major gap** |
| 7b | Subagent summary returned to main chat | ⚠️ supervisor result appears, but not as a sub-thread | ✓ | gap |
| 7c | Persistent transcript on disk | ✗ | ✓ `~/.claude/projects/.../subagents/*.jsonl` | gap |
| 8 | Parallel subagents | ✗ | ✓ background concurrent | **major gap** |
| 8b | Pre-launch single permission prompt covering whole subagent | ✗ | ✓ | gap |
| 9 | Tool allowlist/denylist per agent | ⚠️ all 4 always have all tools | ✓ `tools` / `disallowedTools` | gap |
| 10 | Model per agent | ⚠️ all use the conversation's model | ✓ `sonnet/opus/haiku/inherit` | gap |
| 11 | Project-level vs user-level scopes | ✗ | ✓ + priority order | gap |
| 12a | Color coding per agent | ⚠️ CSS classes per type, no per-agent color | ✓ user-pickable | minor gap |
| 12b | Memory badge per agent | ✗ | ✓ | gap (also 2.4) |
| 12c | Permission-pending / finished-hidden indicators | ✗ | ✓ blue/orange dots | gap (also 4.3) |
| 12d | Auto-compaction at ~95% capacity | ✗ | ✓ | gap (also 3.3) |

**Top misses ranked by impact**

1. **The whole subagent concept is missing.** Our "agent type" is a single-conversation persona switch; Claude Code's subagent is a *spawnable nested worker* with its own tools, model, and transcript. To close: new `Subagent` backend entity (`name`, `description`, `tools`, `model`, `systemPrompt`, source) → `.claude/agents/*.md` + `~/.claude/agents/*.md` parsing → spawn protocol where the main conversation calls an `Agent`-style tool that forks a child stream and returns a summary → UI Running panel with per-row status / Stop / View transcript. **Large feature, high competitive impact.**
2. **Cheap intermediate: `@agent-name` triggering** — once `@` autocomplete from 1.1 lands, route `@code`/`@qa`/`@design` mentions to our system-prompt swap. Feels close to Claude Code's `@`-trigger.
3. **Per-agent model & tool restrictions even in today's enum** — server-side change in `ClaudeProxyService`:
   - QA: read-only (Read/Grep/Glob), block Write/Edit/Bash
   - Design: same as QA
   - Coder: full tool set
   - Supervisor: full set
4. **Stop one subagent without stopping the parent** — essential once we have nested agents. Today Stop = kill everything.
5. **Built-in `Explore`/`general-purpose` analogue** — read-only research subagent for "find where X is defined" without polluting the main Coder context.

**Things we do better**

- `AgentStatusBar` is information-dense (turn / tool count / $ cost / elapsed timer in one bar)
- Inline pre-pick agent buttons (Code/QA/Design) — discoverable without typing `@`
- Auto-supervisor pass after coder — Claude Code requires explicit subagent invocation

**Code references**: [AgentStatusBar.tsx](apps/extension/webview/src/components/AgentStatusBar.tsx) · [ChatInput.tsx:252-279](apps/extension/webview/src/components/ChatInput.tsx#L252-L279) (agent type buttons) · [ClaudeProxyService.ts:102-110](apps/backend/src/services/ClaudeProxyService.ts#L102-L110) (system-prompt swap is the entire mechanism)

---

## 2.3 Plan mode / Edit mode

> Significant overlap with **5.1 (permission modes)** — Claude Code unifies "plan" / "edit" / etc. into a single permission-mode picker. Ours splits them: Plan is its own toggle, and the closest "accept edits" analogue is the "Allow All This Session" button on the approval card.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | Default mode (ask before each action) | ✓ | ✓ | match |
| 1b | Plan mode | ✓ | ✓ | match |
| 1c | Accept Edits mode | ⚠️ closest = "Allow All This Session" per-tool | ✓ dedicated mode, auto-approves edits + safe fs cmds | gap |
| 1d | Auto mode (classifier-reviewed) | ✗ | ✓ | gap |
| 1e | Bypass Permissions mode | ✗ | ✓ for isolated environments | gap |
| 2 | Plan entered via picker at bottom of input | ⚠️ button only visible in agent mode | ✓ click mode indicator → menu | partial gap |
| 2b | Initial mode setting (`claudeCode.initialPermissionMode`) | ✗ | ✓ | gap |
| 3 | Mode indicator visible in input | ⚠️ only when agent mode is on | ✓ always | gap |
| 4 | Plan mode disables write tools | ✓ enforced in `ClaudeProxyService` (filtered tool list, not just prompt) | ✓ | match — ours is robustly enforced |
| 5 | Plan output rendering — inline markdown in chat | ✓ free-form markdown in assistant message | ✓ | match |
| 5b | Plan auto-opens as full markdown document for editing | ✗ | ✓ | **major gap** |
| 5c | Inline comments / direct edits on the plan doc | ✗ | ✓ | gap |
| 5d | `Ctrl+G` opens plan in default text editor | ✗ | ✓ | gap |
| 6 | Approval dialog after plan completes | ✗ user manually toggles plan off and re-asks | ✓ "Approve and start in auto / accept edits / review each / Keep planning / Refine with Ultraplan" | **major gap** |
| 6b | "Approve plan" hands off back to execution mode | ✗ | ✓ chooses next mode automatically | gap |
| 7 | Accept-Edits behavior — auto-approve writes + safe fs commands | ⚠️ "Allow All This Session" is per-tool, not category | ✓ | gap |
| 7b | Protected paths (`.git`, `.claude`) still prompt in accept-edits | ✗ no concept of protected paths | ✓ | gap |
| 8 | Mode persistence — sticky for the session | ⚠️ plan resets when leaving agent mode ([App.tsx:169](apps/extension/webview/src/App.tsx#L169)) | ✓ session-persistent | gap (subtle bug) |
| 9 | Switch modes mid-conversation | ✓ toggle is live | ✓ | match |
| 10 | Mode selector includes brief descriptions | ✓ tooltip on toggle | ✓ | match |

**Top misses ranked by impact**

1. **No "approve plan → execute" handoff.** Today, after the model emits a plan, the user has to: (1) read the plan, (2) click `📋 Plan: ON` to turn it off, (3) type "now do it". Friction-laden. Claude Code shows a one-click "Approve and start in auto / accept-edits / review each" picker that flips the mode and starts executing automatically. **Recommended fix**: when plan mode is on and a turn ends with a numbered plan, render an "Approve plan" card at the end of the stream with three buttons (*Execute with approvals*, *Execute auto-accepting edits*, *Keep planning*). First two send a synthetic user turn ("Now execute the plan above") with plan mode off and the chosen mode active.
2. **No plan-as-document workflow.** Claude Code opens the plan in a real markdown editor for edits/annotations before approval. Ours leaves the plan trapped inside a chat message. **Fix**: plan-output detection → "Open plan in editor" button → write to `untitled:plan.md`, on close re-inject edited content as next user turn. Smaller version: a "Copy plan" button on a detected plan message.
3. **Unify "Allow All This Session" into a real Accept-Edits mode.** Per-tool today; Claude Code's mode applies to a *category* (writes + `mkdir`/`touch`/`rm`/`mv`/`cp`/`sed`) with `.git`/`.claude` still gated. **Fix**: permission-mode picker (default / plan / accept-edits / bypass) replacing the current ad-hoc toggles. Tied to **5.1**.
4. **Plan toggle resets when leaving agent mode.** [App.tsx:169](apps/extension/webview/src/App.tsx#L169) clears `planMode` whenever `agentMode` flips off — silent reset on a momentary toggle. **Fix**: keep `planMode` independent of `agentMode`.
5. **Mode indicator visible always.** Currently Plan toggle only shows when agent mode is on. Claude Code shows the mode regardless. Move our mode indicator to the input footer permanently.
6. **`initialPermissionMode` setting** — small, useful for cautious workflows where teams want "always start in plan mode".

**Things we do better**

- **Plan mode actually filters the tool list** (read-only set) rather than relying solely on the prompt. Robustness win.
- **The `<plan_mode>` system prompt instruction** is explicit about what's banned and what to produce — clearer than just "don't edit".
- Tooltip on the toggle explains what plan mode does — discoverable for first-time users.

**Code references**: [ChatInput.tsx:281-293](apps/extension/webview/src/components/ChatInput.tsx#L281-L293) (toggle UI) · [App.tsx:169](apps/extension/webview/src/App.tsx#L169) (plan resets on agent toggle — possible bug) · [ClaudeProxyService.ts:111-125](apps/backend/src/services/ClaudeProxyService.ts#L111-L125) (system prompt + tool filter)

---

## 2.4 Memory / CLAUDE.md

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | Project-level shared rules | ⚠️ `.ailancers/instructions.md` (or `AILANCERS.md` fallback) | ✓ `./CLAUDE.md` or `./.claude/CLAUDE.md` | match (different filename) |
| 1b | Project-local personal rules (gitignored) | ✗ | ✓ `./CLAUDE.local.md` | gap |
| 1c | User-level rules across projects | ✗ | ✓ `~/.claude/CLAUDE.md` | **gap** |
| 1d | Enterprise/managed rules path | ✗ | ✓ | low priority |
| 2a | Auto-load on session start | ✓ injected per agent message | ✓ once at session start | match |
| 2b | Hot-reload mid-session | ✓ mtime-cached | ✗ next session only | **we're better** |
| 2c | Walk dir tree from cwd to repo/home root concatenating | ✗ 2 candidate paths only | ✓ | gap |
| 2d | Nested CLAUDE.md loaded on-demand when reading subdir files | ✗ | ✓ | gap |
| 2e | `@path` imports inside CLAUDE.md | ✗ | ✓ (max 5-hop) | gap |
| 3 | `/init` command — generate project rules from codebase | ✗ | ✓ | **major gap** |
| 4 | `/memory` command — open memory management UI | ✗ | ✓ | **major gap** |
| 5a | Auto-memory (Claude-managed, machine-local) | ✗ | ✓ `~/.claude/projects/<proj>/memory/MEMORY.md` | **gap** |
| 5b | "Remember X" → save to auto-memory | ✗ | ✓ natural-language ask | gap |
| 6 | Quick "save fact" button/shortcut in chat | ✗ | ✗ | match |
| 7 | Visual badge "remembered this" / "from memory" | ✗ | ⚠️ subtle "Writing/Recalled memory" log | gap |
| 8a | Hierarchy / precedence (closer-to-cwd wins) | ✗ only one file loaded | ✓ | gap |
| 8b | `claudeMdExcludes` glob pattern in settings | ✗ | ✓ | gap |
| 9 | Open rules file in editor | ✗ no UI to open it | ✓ via `/memory` UI | **gap** |
| 9b | HTML comments stripped before injection (token-saving) | ✗ | ✓ | minor gap |
| 10 | Pick up edits mid-session | ✓ mtime cache invalidates per turn | ⚠️ next session only | **we're better** |
| 11 | Subagent-scoped memory | ✗ no subagents | ✓ `enablePersistentMemory` | gap (also 2.2) |
| 12a | Path-scoped rules (`.claude/rules/*.md` with YAML `paths:` frontmatter) | ✗ | ✓ loaded on demand by glob | gap |
| 12b | User-level rules folder | ✗ | ✓ `~/.claude/rules/` | gap |
| 12c | Symlink support for shared rule sets | ✗ | ✓ | nice-to-have |
| 12d | Size cap | ✓ truncate at 16K | ⚠️ guidance "<200 lines" no hard cap | match (different approach) |

**Top misses ranked by impact**

1. **No `/memory` UI to view/edit rules.** Users today have to know about `.ailancers/instructions.md` and find or create it manually. Even a basic "Open project rules" Cmd Palette command would be a big lift; full version is a slash command + small webview listing all loaded rule files with "Open" / "Create" actions. Depends on slash system (2.1).
2. **No user-level rules.** Single most-asked feature once a user has more than one project. Pure additive: read `~/.ailancers/instructions.md` and concatenate it before the project rules. Gitignore-safe by definition.
3. **No `/init` command.** Scan `package.json`/`pyproject.toml`/`Cargo.toml`/`README.md` → ask the model to draft `instructions.md` → open it for review. Bigger project but high-impact for new users.
4. **No "remember this" via natural language.** Today if a user says "remember we always use Yarn", the model can't persist it. Auto-memory needs an `add_memory` server-side tool writing to `~/.ailancers/memory/<repo>/MEMORY.md`. MVP: model emits a `<memory_suggestion>` block, webview shows an "Add to project rules" button.
5. **Missing `instructions.local.md` equivalent.** Gitignored personal file alongside the team one, concatenated after. Trivially easy: add `.ailancers/instructions.local.md` to candidate list and `.gitignore` template.
6. **Path-scoped rules.** Solves "rules file is huge and only half is relevant". Larger feature; pair with subagents (2.2) and slash commands (2.1).

**Things we do better**

- **Mid-session hot-reload of rules** via mtime cache — matches user intuition ("I just edited the rules, the agent should see it now"). Claude Code requires a new conversation.
- **Single canonical rules file** with predictable behavior — Claude Code's hierarchy is powerful but a known source of confusion.

**Code references**: [WorkspaceContextService.ts](apps/extension/src/services/WorkspaceContextService.ts) (entire memory mechanism — rules-only, project-only) · [ClaudeProxyService.ts:117-119](apps/backend/src/services/ClaudeProxyService.ts#L117-L119) (where rules get injected) · No `/init` or `/memory` commands · No user-level path

---

## 2.5 Model picker

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Picker UI location | ✓ inline `<select>` in input footer | ⚠️ behind `/model` slash command + picker dialog | **we're better** |
| 2 | Switch via slash command | ✗ no slash system | ✓ `/model <name>` | gap (also 2.1) |
| 2b | Switch via picker UI | ✓ always-visible dropdown | ✓ on slash | match |
| 3 | Current model visible at all times | ✓ shown in select control | ⚠️ next to spinner; need `/status` or status line | **we're better** |
| 4a | Available models | ✓ Sonnet 4.6, Opus 4.6, Haiku 4.5, GPT-4o family, o3/o4-mini | ⚠️ Sonnet/Opus/Haiku + 1m + opusplan | match (different lineup; we have OpenAI fallbacks) |
| 4b | Grouping by category | ✓ Code / Chat / Reasoning optgroups | ✗ flat | **we're better** |
| 4c | "default" / "best" dynamic aliases | ✗ | ✓ | gap |
| 4d | 1M context variants (`sonnet[1m]`, `opus[1m]`) | ✗ | ✓ | gap |
| 4e | `opusplan` hybrid (Opus plans, Sonnet executes) | ✗ | ✓ | **gap** — interesting feature |
| 5 | Mid-session switch instant | ✓ next message uses new model | ⚠️ instant + warns about cache loss | match |
| 5b | Confirmation dialog on switch with prior output | ✗ silent | ✓ | minor gap |
| 6 | Per-message model override | ✗ | ✗ undocumented | match |
| 7a | Default model setting | ✓ separate chat-default and code-default | ⚠️ single `model` setting | **we're better** |
| 7b | Auto-switch model when entering agent mode | ✓ ([App.tsx:169](apps/extension/webview/src/App.tsx#L169)) | ✗ | we're better |
| 8a | "Fast mode" / effort control | ✗ | ✓ `/effort` with levels low/medium/high/xhigh/max | **gap** |
| 8b | Effort settable via slider | ✗ | ✓ | gap |
| 8c | Effort persists in settings | ✗ | ✓ `effortLevel` | gap |
| 9 | Quota implications shown in picker | ✗ | ✗ | match |
| 10a | Extended-thinking toggle | ✗ | ✓ `Alt+T` / `Option+T` | gap (also 1.1, 1.2) |
| 10b | Reasoning blocks rendered as collapsible | ✗ | ✓ `Ctrl+O` to expand | gap (1.2) |
| 11 | Availability filtering | ✓ filtered by configured API keys | ✓ via `availableModels` policy | match (different mechanism) |
| 12a | Custom model option for gateway testing | ✗ | ✓ `ANTHROPIC_CUSTOM_MODEL_OPTION` | gap (low priority) |
| 12b | Provider model-ID override mapping | ✗ | ✓ `modelOverrides` setting | gap (low priority) |
| 12c | Per-agent model | ✗ | ✓ via subagent config | gap (also 2.2) |
| 12d | Auto-fallback on error (Claude → OpenAI) | ✓ | ✗ | **we're better** |
| 12e | Recently-used models | ✗ | ✗ | match |

**Top misses ranked by impact**

1. **No "effort"/"fast mode" control.** Claude Code dials reasoning depth from `low` (fast/cheap) to `max` (slow/deep). Often more useful than picking a different model. **Fix**: effort selector next to model select. For Anthropic models supporting extended thinking, wire to `thinking: { type: "enabled", budget_tokens: ... }`. For OpenAI reasoning models, map to `reasoning_effort`.
2. **No `opusplan`-style hybrid.** Use Opus during plan mode, swap to Sonnet for execution. Pairs cleanly with our existing Plan toggle (2.3) — when plan mode is on, override `model` to Opus regardless of selected; off → revert. Cheap to ship, real value.
3. **No "best"/"default" aliases.** Users shouldn't have to know version numbers. A dynamic entry resolved server-side would survive Anthropic releases without code changes.
4. **No 1M context variants.** Sonnet 4.6 has a 1M variant. For users hitting context limits, this is huge.
5. **No confirmation on mid-conversation model switch.** Silent today; users don't realise the next request loses prompt caching. Small inline note would prevent surprise. Borderline noise — defer.
6. **No reasoning/extended-thinking display** in chat. Already in 1.1 / 1.2 list; ties to model picker because it should appear when a reasoning-capable model is selected.

**Things we do better**

- **Inline always-visible picker** with current model on screen. Claude Code hides theirs behind a slash command. Big UX win for casual users.
- **Code/Chat/Reasoning grouping** in the dropdown. Claude Code's flat list mixes everything.
- **Separate chat vs code defaults** with auto-switch on agent-mode toggle. Claude Code has a single `model` setting and no chat/code distinction.
- **Auto-fallback Claude → OpenAI on error** ([AIService.ts:32-38](apps/backend/src/services/AIService.ts#L32-L38)). Claude Code can't do this.

**Code references**: [ChatInput.tsx:295-330](apps/extension/webview/src/components/ChatInput.tsx#L295-L330) (picker UI) · [AIService.ts:17-29](apps/backend/src/services/AIService.ts#L17-L29) (catalogue) · [AIService.ts:67-72](apps/backend/src/services/AIService.ts#L67-L72) (defaults) · [App.tsx:169](apps/extension/webview/src/App.tsx#L169) (agent-mode auto-swap)

---

## 3.1 History / resume

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Past conversations entry point | ✓ webview sidebar (always visible) | ⚠️ button at top opens dedicated dialog | match (different UX) |
| 1b | Local vs Remote tabs (claude.ai web sessions) | ✗ | ✓ | gap (low priority) |
| 2a | Auto-generated title from first message | ⚠️ "Untitled" fallback — backend generation unclear | ✓ | likely gap |
| 2b | Manual rename | ✗ | ✓ hover → rename | gap |
| 2c | Timestamp | ✓ relative ("3m ago", "2d ago", date) | ✓ Today / Yesterday / Last 7 days | match |
| 3 | Title search | ✓ client-side filter | ✓ | match |
| 3b | Content search (inside messages) | ✗ | ✗ | match |
| 3c | Date range filter | ✗ | ✗ | match |
| 4 | Resume preserves full message history | ✓ via `loadMessages` | ✓ | match |
| 4b | Resume preserves tool-call state | ✗ replays history but tool calls aren't re-runnable | ✗ same — re-runs permissions | match |
| 5 | `/resume` slash | ✗ no slash system | ✓ | gap (also 2.1) |
| 5b | `/continue` (auto-resume most recent) | ✗ | ✓ | gap |
| 6 | Fork from a specific message | ✗ | ✓ "Fork conversation from here" | **major gap** |
| 7a | Rewind code to checkpoint | ✗ | ✓ "Rewind code to here" | **major gap** |
| 7b | Fork + rewind code | ✗ | ✓ | major gap |
| 7c | Rewind tracks Bash commands | ✗ | ✗ same — code edits only | match |
| 8 | Storage location | server-side via backend | ✓ local `~/.claude/projects/<proj>/<id>.jsonl` | match (different mechanism) |
| 8b | Retention | unclear (server-controlled) | ✓ 30 days default | unclear |
| 9 | Per-project scope | ⚠️ user-global, not workspace-scoped | ✓ tied to directory | **gap** |
| 10a | `/clear` (empties context, keeps history) | ⚠️ via `newConversation` Cmd Palette | ✓ | gap |
| 10b | `/compact` (summarize mid-session) | ✗ | ✓ | **gap** |
| 11 | Export single conversation | ✓ markdown / JSON via Cmd Palette | ✓ `/export` to clipboard or file (plaintext) | match (we have JSON option) |
| 11b | Bulk export | ✗ | ✗ | match |
| 12a | Auto-resume on relaunch | ✗ | ✗ | match |
| 12b | Archive / pin / delete from UI | ✗ | ✗ | match |
| 12c | Tab status dots (blue=pending, orange=hidden-finished) | ✗ | ✓ | gap (also 4.3) |

**Top misses ranked by impact**

1. **No fork-from-here / rewind-here.** Claude Code's killer history feature: hover over any message → "Fork from here" branches into a new session with that prefix; "Rewind code to here" reverts file edits made after. Today our users have no recovery if a long conversation goes off the rails — they have to start over and lose the good early context. Multi-week feature but high impact.
   - Per-message hover button on user/assistant rows
   - "Fork from here" → backend endpoint creating a new conversation seeded with first N messages
   - "Rewind code" → checkpoint each agent turn's file mutations, replay-undo via stored old/new text
2. **No `/compact` (mid-session summarization).** Long conversations eventually fill the context window. Today we have nothing — the agent runs into a hard error. **Fix**: `compactConversation` route asking the model for a tight bullet summary + last 2-3 turns verbatim, replacing the history with `[<system_summary>{summary}</system_summary>, ...lastTurns]`. Tied to 3.3 — show context fullness % and a "Compact" button when nearing limit.
3. **No per-project conversation scoping.** User-global today; conversations from one repo bleed into the picker for another. **Fix**: store `workspaceFingerprint` (first git remote URL or folder hash) on each conversation, filter list by current workspace with a "Show all" toggle.
4. **No manual rename / probably no AI-generated title.** Conversations show "Untitled" until given a title; backend title generation is unconfirmed. **Fix**: backend generates title from first user message after first AI turn completes (one Haiku call). Inline rename UI (double-click title).
5. **Missing `/resume` and `/continue` slash entries.** Cosmetic until 2.1; both map to existing functionality.
6. **No tab status dots.** Users miss completion of older conversations when not in chat tab. (Also 4.3.)

**Things we do better**

- **Persistent searchable sidebar** vs Claude Code's modal dialog — current conversation always visible
- **JSON export option** in addition to markdown — useful for automation
- **Server-side storage** means cross-device resume (laptop swap = conversations still there); Claude Code's local JSONL doesn't sync

**Code references**: [ConversationList.tsx](apps/extension/webview/src/components/ConversationList.tsx) · [ChatViewProvider.ts:83-101](apps/extension/src/providers/ChatViewProvider.ts#L83-L101) (load/new/export handlers — no rename, fork, rewind, delete, compact)

---

## 3.2 Cost & usage

> Framing: **one of our strongest areas**. Claude Code's built-in cost UX is famously thin — community extensions exist precisely to fill the gap.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Running session cost visible in real time | ✓ `AgentStatusBar` shows live `$0.0042` during agent runs | ✗ not visible in real time | **we're better** |
| 2 | Per-message cost next to assistant messages | ✓ on each assistant row | ✗ | **we're better** |
| 3 | Per-tool cost on each tool call | ✗ | ✗ | match |
| 4a | `/cost` / `/usage` slash command | ✗ (cost is shown by default instead) | ✓ session total + token breakdown + cache reads | gap (also 2.1) |
| 4b | Token breakdown (input/output) shown per message | ⚠️ written in `MessageBubble` (orphaned, not rendered) | ✓ via `/usage` | gap — we have the data, fixable bug |
| 4c | Cache reads / writes column | ✗ | ✓ reads only | gap |
| 5 | `/status` (environment / session config) | ✗ | ⚠️ not a usage command | match |
| 6 | Session summary on conversation end | ✓ `Completed · X turns · Y tools · $Z` banner | ✗ | **we're better** |
| 7 | Plan / quota indicators | ⚠️ only via post-event `BillingCard` (suspended/cap-reached) | ✓ Pro/Max progress bars via `/usage` | partial match (different mechanism) |
| 8 | Budget warning before hitting ceiling | ✓ `budget_warning` wire event from backend at thresholds | ✗ no pre-ceiling alerts | **we're better** |
| 9 | Per-project cost rollup (lifetime) | ⚠️ schema has `monthlyBudgetUsd`; UI exposure unclear | ✗ requires Console | likely we're better — needs UI verification |
| 10 | Token counts — input / output / cache | ⚠️ data captured, only rendered in orphan `MessageBubble` | ✓ via `/usage` | tied — fixable |
| 11 | Cache savings highlighted | ✗ no cache token surface | ⚠️ in `/usage` text | gap |
| 12a | Prompt caching markers on system prompt + tools | ⚠️ unverified; likely missing | ✓ aggressive | **likely gap** (single biggest cost lever) |
| 12b | `/context` — what's consuming context | ✗ | ✓ | gap (also 3.3) |
| 12c | Continuous status-line context % | ✗ | ✓ optional | gap (also 4.3) |
| 12d | Hourly rate / "$/hr while coding" | ✗ | ✗ | match |
| 12e | Export usage logs | ✓ via dashboard (web billing) | ⚠️ via local JSONL | match (different mechanism) |

**Top misses ranked by impact**

1. **Token-breakdown rendering bug.** We already capture `inputTokens` / `outputTokens` per message — but the only place they're rendered is `MessageBubble`, the orphan from 1.2. Live `MessageList` shows `$cost` but no token split. Same fix as 1.2: merge `MessageBubble`'s "X in / Y out" into `MessageList`. Tiny change, real value.
2. **No prompt-caching markers (server-side).** Anthropic's blog says prompt caching is "everything" — for our agent flows where the same system prompt + tool definitions repeat every turn, this is a **50–80% cost reduction** left on the floor. Server-side change in `ClaudeProxyService`: add `cache_control: { type: "ephemeral" }` markers on system prompt block and tool definitions. No UI work, single biggest cost lever.
3. **No `/context` view.** Users today have no way to know how full the context is until the conversation hard-fails. Claude Code's `/context` shows breakdown by source (system prompt, tools, project rules, history). Pairs with `/compact` (3.1) and the context indicator (3.3).
4. **Cache token / savings not surfaced.** Once caching is enabled (#2), surface "saved $X via cache" on the completion banner. Anthropic returns `cache_creation_input_tokens` / `cache_read_input_tokens` for free.
5. **Session summary card could be richer.** Today: `Completed · X turns · Y tools · $Z`. Easy adds: `(X in / Y out / Z cached) · 4.2s/turn · model-name`. Pure presentation, data already on hand.
6. **No `/cost` slash entry.** Cosmetic until 2.1 — when slash lands, `/cost` should render an on-demand session summary card.

**Things we do better**

- **Real-time per-message cost display** — biggest single win versus Claude Code here. Users see `$0.0042` on every assistant message, not after-the-fact via a slash command.
- **Live running cost in the agent status bar** during streaming. Claude Code requires `/usage` to see anything during a session.
- **Pre-ceiling budget warnings** via `budget_warning` event. Claude Code has nothing — users hit the wall at 100%.
- **Inline `BillingCard` for suspended / cap-reached** with a "Top Up Wallet" link. Claude Code shows a generic error.
- **Server-side per-project budgets** (`monthlyBudgetUsd` schema). Need to verify UI surface, data layer is there.
- **Agent completion banner** = a free session summary on every agentic turn. Claude Code has no equivalent.

**Code references**: [MessageList.tsx:109](apps/extension/webview/src/components/MessageList.tsx#L109) (per-message $) · [AgentStatusBar.tsx:47](apps/extension/webview/src/components/AgentStatusBar.tsx#L47) (live $) · [MessageBubble.tsx:67-75](apps/extension/webview/src/components/MessageBubble.tsx#L67-L75) (orphan token breakdown — fix as part of 1.2) · [MessageList.tsx:147-151](apps/extension/webview/src/components/MessageList.tsx#L147-L151) (completion banner) · [types.ts:39-40](apps/extension/webview/src/types.ts#L39-L40) (budget_warning / billing_suspended wire events) · BillingCard inline at [MessageList.tsx:167-217](apps/extension/webview/src/components/MessageList.tsx#L167-L217)

---

## 3.3 Context window indicator

> Lopsided: we have **nothing** here. Claude Code has a fairly mature surface.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Real-time fullness indicator | ✗ | ✓ colored bar (green/yellow/red at 50/75% thresholds) | **major gap** |
| 2 | Where shown | ✗ | ✓ inside prompt box | gap |
| 3a | `/context` command | ✗ no slash, no view | ✓ colored grid + per-block token breakdown | **major gap** |
| 3b | Breakdown by source (system / rules / tools / history / files / hooks / images) | ✗ | ✓ | gap |
| 3c | Optimization hints in `/context` output | ✗ | ✓ flags context-heavy tools and memory bloat | gap |
| 4 | Auto-compact at threshold | ✗ — long conversations hard-fail | ✓ approaches limit, summarises | **major gap** |
| 5 | Warning before compaction | ✗ | ⚠️ colour-bar threshold; no toast | partial gap |
| 6 | Manual `/compact` with optional focus instructions | ✗ | ✓ `/compact focus on API changes` | gap |
| 6b | What `/compact` preserves vs drops (documented) | n/a | ✓ user reqs / key snippets / errors / pending kept; tool outputs / intermediate reasoning dropped | gap |
| 7 | Indicator accounts for active model (200K vs 1M) | n/a | ✓ | gap (also 2.5) |
| 8 | "Recent file content" pinned visualisation | n/a | ✗ — loads on demand | match |
| 9 | Compaction summary visible (`X → Y tokens · freed Z`) | n/a | ✓ | gap |
| 10 | Per-subagent context window | ✗ no subagents | ✓ fresh window per subagent | gap (also 2.2) |
| 11 | Context contributors visible | ✗ | ✓ via `/context` | gap |
| 12a | Hover tooltip on context blocks | ✗ | ✓ token count + details | gap |
| 12b | Configurable warning threshold | ✗ | ✗ | match |

**Top misses ranked by impact**

1. **No fullness indicator at all.** Today users have zero visibility into how close they are to the context limit and hit a hard error mid-task. Most actionable fix in this section. **Sketch**:
   - Backend already knows `inputTokens` per turn (we capture for cost). Track cumulative `historyTokens` per conversation.
   - Send a `context_state` wire event after each turn: `{ used, limit }`. Limit comes from active model (`200_000` for Sonnet/Opus, `1_000_000` for `[1m]` variants).
   - Webview: 6px bar at top of input area. Green <60%, yellow 60-85%, red >85%.
   - Tooltip: "120k / 200k used · click to compact".
2. **No `/compact` to recover.** Tied to the indicator. Without it, users hit a wall once the bar turns red. **Sketch**: backend `compactConversation(id)` produces a tight bullet summary of all turns except last 2-3, replaces history with `[<system_summary>{summary}</system_summary>, ...lastTurns]`. UI: button on the bar tooltip + inline suggestion when above 85%. Same fix as 3.1 item #2.
3. **No `/context` breakdown.** Less urgent than #1/#2; high-value once the bar exists. Tells users "why is it full?" — system prompt 4k, project rules 12k, conversation 110k, tool outputs 38k, files read 26k. Also exposes the value of subagents (2.2) by surfacing how much tool-output bloat they avoid.
4. **Auto-compact at threshold.** Belt-and-braces for users who don't read the bar. Fire `compactConversation` at 95% (configurable) with a non-modal banner: "Conversation compacted — freed 80k tokens."
5. **Per-subagent context isolation messaging.** Once subagents (2.2) exist, the indicator should distinguish parent vs subagent context.

**Things we do better**

- Nothing here. The closest is per-message token counts (3.2), which is a different lens.

**Code references**: Clean greenfield. Backend turn tokens live in [ClaudeProxyService.ts](apps/backend/src/services/ClaudeProxyService.ts); the bar would live in [ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx).

---

## 3.4 Cancel / interrupt

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Visible stop button | ✓ ■ button replaces send button while streaming + "Stop" on `AgentStatusBar` | ✗ no dedicated button (issue #39381) | **we're better** |
| 2a | Esc to cancel current generation | ✗ no key handler | ⚠️ primary mechanism, flaky on Windows / regressed (issues #38766, #11803) | gap (theirs is unreliable) |
| 2b | Esc focus requirements | n/a | ✓ in input box | gap |
| 3a | Ctrl+C SIGINT path | ✗ extension doesn't expose | ⚠️ terminal mode only | match (different surface) |
| 3b | Ctrl+B background a long task | ✗ | ✗ undocumented | match |
| 4a | Stream-loop interrupt mid-turn | ✓ `abortSignal.aborted` checked between turns + inside SDK stream | ✓ | match |
| 4b | Mid-tool-call interrupt of in-progress local tool | ✗ — `ToolExecutor` doesn't honor abort | ⚠️ Esc tries to cancel pending tool | **bug** — process keeps running |
| 4c | Bash process killed on cancel | ✗ — `exec` runs to natural exit / 60s timeout | ⚠️ Ctrl+C in terminal | gap |
| 4d | In-flight `write_file` aborted | ✗ — write completes | ✗ same | match (both write fully) |
| 5 | Partial-result preservation | unclear; partial text may be discarded | ✗ partial discarded (issue #49619) | likely match |
| 6 | Tool-call rollback after cancel | ✗ — relies on `WorkspaceEdit` undo (Cmd+Z) | ✗ no auto rollback; `git reset` or `/rewind` | match |
| 7 | Visual feedback during cancellation | ⚠️ button swaps back instantly; no "Cancelling…" state | ✗ minimal feedback | match (both weak) |
| 8 | Resume after cancel — type "continue" picks up | ⚠️ no auto-continuation cue | ⚠️ same | match |
| 9 | Cancel during permission prompt | ⚠️ have Deny button; Stop-while-approval behaviour unverified | ✓ Esc → tool denied | partial gap |
| 10 | Background a long-running agent | ✗ | ✗ | match |
| 11 | Cancel subagent vs parent independently | ✗ no subagents | ✗ also lacks | match (also 2.2) |
| 12a | Network-disconnect handling during stream | unclear — likely WS reconnect drops in-flight stream | ⚠️ 5-min idle, partial discarded | likely match |
| 12b | Cancel + retry-with-new-message | ✓ Edit & resend lets you fork the prompt | ✗ | **we're better** |
| 12c | "Stopped by user" indicator on partial message | ✗ | ✗ | match |

**Top misses ranked by impact**

1. **Mid-tool-call cancel doesn't kill local processes — real bug.** Click Stop while `run_terminal` is mid-`exec` and the spawned process runs to completion (or its 60s timeout). Same for `write_file`. The streaming side respects abort; `ToolExecutor` ignores it. **Fix sketch**:
   - Add `abortSignal?: AbortSignal` parameter to `ToolExecutor.execute()`
   - For `run_terminal`: keep a reference to the spawned `child`, call `child.kill('SIGTERM')` on `signal.aborted`
   - For `write_file`/`edit_file`: check `signal.aborted` before `applyEdit` / `writeFile`
   - Wire from `agentTurn` loop where the abort signal already exists down through tool dispatch — straightforward plumbing
2. **No Esc keyboard shortcut.** Users mouse-aim at a small ■ button. Add `keydown` handler in `ChatInput` and `AgentStatusBar` that calls `handleCancel()` on Esc when streaming. Bigger win: a global VS Code command (`ailancers.stopGeneration`) bound to Esc that works from the editor too.
3. **No "Cancelling…" intermediate state.** Button flips instantly between sending and idle, even if abort is mid-flight. Add a `cancelling` state in App reducer; show "Cancelling…" on the button + greyed status bar until backend confirms stream closed.
4. **Verify Stop-while-approval-pending state**. Likely safe; worth confirming the assistant's pending tool-call doesn't dangle in `stream` items.
5. **No "Stopped by user" label** on the cancelled assistant message. Tiny presentation change: small `(stopped)` tag in message header for any assistant message that ended without `STREAM_END`.

**Things we do better**

- **Always-visible stop button** in two places (input + agent status bar) — Claude Code has neither
- **Edit & resend** is effectively cancel-and-fork (1.2 / 1.1) — way friendlier than typing "no actually do it differently"
- **End-to-end `AbortSignal` plumbing** for the stream itself — clean architecture; the bug above is a missing leaf, not structural

**Code references**: [ChatInput.tsx:228-230](apps/extension/webview/src/components/ChatInput.tsx#L228-L230) (■ button) · [AgentStatusBar.tsx:50-52](apps/extension/webview/src/components/AgentStatusBar.tsx#L50-L52) (Stop button) · [ChatService.ts:101](apps/extension/src/services/ChatService.ts#L101) (cancelStream) · [ClaudeProxyService.ts:76,133,155,187](apps/backend/src/services/ClaudeProxyService.ts#L76) (abort checks) · [ToolExecutor.ts](apps/extension/src/services/ToolExecutor.ts) (no AbortSignal — the bug)

---

## 4.1 Selection context

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Auto-attach editor context per message | ✓ on every send | ✓ | match |
| 2a | What's sent — file path | ✓ workspace-relative | ✓ | match |
| 2b | What's sent — language | ✓ `languageId` | ⚠️ implicit from extension | match |
| 2c | What's sent — selection text | ✓ when selection non-empty | ✓ | match |
| 2d | What's sent — selection line numbers | ✓ start + end | ✓ via `@file#5-10` | match |
| 2e | Full file content via `@filename` | ✗ never (selection only) | ✓ | gap (also 1.1) |
| 3 | Selection size cap | ✓ 4KB with `…(truncated)` marker | ✗ no documented cap | match (we're more conservative) |
| 4a | Footer indicator ("3 lines selected") | ✗ | ✓ | **major gap** |
| 4b | Eye-slash toggle to opt out | ✗ — always on | ✓ click to hide | **major gap** |
| 4c | Visibility of *what* will be sent | ✗ silent | ✓ via indicator | gap |
| 5 | Multi-cursor / multiple selections | ✗ uses `editor.selection` (single) | ✗ undocumented | match |
| 6 | Multiple open editors / visible tabs | ✗ active only | ✗ active only | match |
| 7 | Editor groups / split view | ✗ active focus only | ✗ active focus only | match |
| 8 | Diff editor / read-only views | ⚠️ standard `activeTextEditor` picks these up | ⚠️ same | likely match |
| 9 | Notebooks `.ipynb` | ✗ no special handling | ⚠️ separate IDE MCP for execution | likely match |
| 10 | Webview / preview tab | ✗ | ✗ | match |
| 11 | Workspace root info attached | ✗ | ✗ | match |
| 12a | Cursor position (without selection) | ✗ | ✗ undocumented | match |
| 12b | Recently focused tabs (history) | ✗ | ✗ | match |
| 12c | "@" insertion of current selection (Alt-K hotkey) | ✗ | ✓ Alt-K / Option-K | gap (also 1.1) |
| 12d | Stripped from displayed user message after sending | ✓ webview strips `<editor_context>` block | unclear | likely we're better |

**Top misses ranked by impact**

1. **No footer indicator showing what will be sent.** The single most-cited Claude Code touch in their docs/demos. Auto-attach is silent today — users don't know *what* the agent sees, and have no way to suppress it for a quick non-code question. **Fix sketch**:
   - Host emits an `editorContext` snapshot to webview whenever active editor / selection changes
   - `ChatInput` footer displays: `📎 src/foo.ts (3 lines selected)` or `📎 src/foo.ts`, hidden when no editor
   - Click → popover with "Send file path", "Send selection", "Disable for next message" toggles
   - Default: send (matches today); state per-conversation
   - **Ship the indicator first; the popover second** — the indicator alone closes most of the gap by making the implicit explicit
2. **No eye-slash opt-out.** Real cases where users want to ask something *not* about the open file ("how do I write a regex for IPv6?") — auto-attach pollutes the prompt. Today the only escape is closing the file. Fix as part of #1's popover.
3. **Alt-K to insert `@file#L5-L10` from selection** — covered in 1.1; worth noting because it's the natural complement to the indicator. Indicator shows what's *auto*-attached; Alt-K lets you *explicitly* include something else.
4. **No full-file-content mention.** Selection context only sends the selection snippet. Once `@` autocomplete (1.1) lands, `@filename` should map to "inline this file's content".
5. **Workspace root path isn't sent.** Minor; the agent sometimes asks "what's the project root?" — including it in `<editor_context>` is one line, no real token cost.

**Things we do better**

- **4KB selection cap with truncation marker** — Claude Code has no documented cap; ours protects the context window when a user pastes 50KB into the editor and asks "explain this".
- **Webview strips `<editor_context>` from displayed user content** — chat stays readable. Claude Code's display behavior here is undocumented.
- **Server-side wrapping into `<editor_context>` XML** — clean separation between user prose and IDE state; the model can reliably tell them apart.

**Code references**: [WorkspaceContextService.ts:53-86](apps/extension/src/services/WorkspaceContextService.ts#L53-L86) (snapshot logic) · [ChatService.ts:84-97](apps/extension/src/services/ChatService.ts#L84-L97) (auto-attach on every send) · [chat.ws.ts:440-452](apps/backend/src/routes/chat.ws.ts#L440-L452) (XML wrapping) · [MessageList.tsx:80-86](apps/extension/webview/src/components/MessageList.tsx#L80-L86) (display strip)

---

## 4.2 Inline assistance

> Framing: this whole category is **largely empty for both extensions**. Claude Code is "chat-panel-centric with minimal non-chat surface" by design — no `CodeActionProvider`, `HoverProvider`, `InlineCompletion`, or `CodeLens` from them. Ours has the same.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Right-click "Ask Claude / Explain / Refactor" in editor | ✗ | ✗ | match |
| 2 | Code Actions / lightbulb — "Fix with Claude" on diagnostics | ✗ | ✗ | match |
| 3 | Inline ghost-text / Copilot-style autocomplete | ✗ | ✗ | match |
| 4 | Cursor-style Cmd+K inline edit-in-place | ✗ | ✗ panel-centric | match |
| 5 | CodeLens — "Explain / Test / Refactor" on functions | ✗ | ✗ | match |
| 6 | Hover tooltips with AI-generated docs | ✗ | ✗ | match |
| 7a | Custom diagnostics (Claude flags code) | ✗ | ✗ | match |
| 7b | Read existing diagnostics into agent context | ✗ | ✓ via `mcp__ide__getDiagnostics` MCP tool | gap |
| 8 | Terminal right-click — "Explain output" / "Fix error" | ✗ | ✗ | match |
| 9 | tasks.json / launch.json AI assist | ✗ | ✗ | match |
| 10 | Doc generation shortcut (JSDoc / docstring) | ✗ | ✗ | match |
| 11a | Commit message generation in SCM | ✗ no SCM hook | ⚠️ via "ask Claude in chat" — no SCM button | match (no real UI integration on either side) |
| 11b | PR description generation | ✗ | ⚠️ chat-only | match |
| 12a | Jupyter notebook execution via `mcp__ide__executeCode` with Quick Pick approval | ✗ | ✓ | gap |
| 12b | Cmd Palette command coverage | ✓ open chat / toggle agent / new conversation / capture screen / select project / open dashboard / toggle auto-start / refresh projects | ⚠️ smaller set | **we're better** |
| 12c | Non-chat dashboard view in activity bar | ✓ activity dashboard | ✗ | **we're better** |

**Top opportunities ranked by impact**

1. **Read VS Code Problems panel into agent context.** Claude Code does this through their IDE MCP; we don't. Strong agent-quality lever: when the user says "fix the failing test" or "address the type errors", auto-attach `vscode.languages.getDiagnostics()` for the active file inside `<editor_context>`. ~10 lines in `WorkspaceContextService.getEditorContext()`. Format e.g.
   ```
   <diagnostics file="src/foo.ts">
   line 42: TS2322: Type 'string' is not assignable to type 'number'
   line 87: ESLint: 'unused-var' is defined but never used
   </diagnostics>
   ```
   Improves agent on-task accuracy without a single piece of UI.
2. **Right-click "Ask Ailancers about this"** in editor context menu. Cheap win that *neither* extension has. Register one entry in `editor/context` menu via `package.json`, command sends current selection (or whole file) into chat with preset prompt "Explain this code:". Two-line manifest change + one handler. Discovery boost — users learn the chat exists while mid-action in the editor.
3. **Right-click on diagnostic squiggle → "Fix with Ailancers".** `CodeActionProvider` registered for all languages with `vscode.CodeActionKind.QuickFix`. Sends diagnostic + surrounding code to chat with "Fix this error:" prompt. Higher leverage than #2 because users naturally hit Cmd+. on a red squiggle. Requires #1 to be most useful.
4. **Inline ghost-text completion** — *deliberately* skipped by Claude Code. Doing it well needs <300ms latency, debounced low-cost calls (Haiku), aggressive caching, file-aware context. Effectively a separate product; flag as future "Cursor-competitor" not for this audit.
5. **SCM commit message generation.** "Generate with Ailancers" button in SCM commit message input. Reads `git diff --cached`, sends with template "Write a short commit message". Common ask, both extensions skip it; small competitive win.
6. **Terminal "Explain last command output"** — Terminal context menu entry sending last ~200 lines into chat. Reading output is platform-dependent. Defer.
7. **Quick Pick approval pattern for `executeCode`-style flows.** Once we wire a Jupyter or sandboxed-shell tool, copy Claude Code's pattern — `vscode.window.showQuickPick` with explicit allow/deny instead of the chat-panel approval card for high-frequency low-stakes ops.

**Things we do better**

- **Cmd Palette command coverage** — we register: open chat, toggle agent, new conversation, capture screen, select project, open dashboard, toggle auto-start, refresh projects. Claude Code's set is smaller.
- **Activity dashboard view** in the activity bar — a non-chat surface Claude Code doesn't have.

**Code references**: [package.json:69-117](apps/extension/package.json#L69-L117) (Cmd Palette commands — only inline surface today) · No `CodeActionProvider`, `HoverProvider`, `InlineCompletionItemProvider`, or `editor/context` menu contributions · [WorkspaceContextService.ts](apps/extension/src/services/WorkspaceContextService.ts) is where diagnostics-in-context would slot in

---

## 4.3 Status bar / activity bar

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Activity bar icon | ✓ `ailancers-sidebar` container with custom icon | ✓ Spark icon | match |
| 2a | Badge on activity bar icon | ✗ no `setBadge` calls | ✓ blue=permission pending / orange=finished hidden | **major gap** |
| 2b | Pending-permission count exposed | ✗ | ✓ via dot | gap |
| 3 | View container — custom or default sidebar | ✓ custom container | ⚠️ native draggable webview | we're better (rooted home) |
| 4 | Multiple views in the container | ✗ chat only | ✗ chat only | match |
| 5a | Status bar — chat-state item | ⚠️ shows time + AI request count, not generation state | ✓ "✱ Claude Code" item | partial gap (no streaming-state surface) |
| 5b | Status bar — generation in-progress indicator | ✗ | ⚠️ progress indicator for long commands | gap |
| 5c | Status bar — model / context % / cost | ✗ | ✗ extension (CLI status line yes) | match |
| 5d | Status bar — sign-in warning pill | ✓ yellow pill when unauthenticated | ✗ | **we're better** |
| 5e | Status bar — active project picker | ✓ project / sub-project, click to switch | ✗ | **we're better** |
| 5f | Status bar — hourly billing tracker | ✓ tracking/idle/limit-reached/suspended states | ✗ | **we're better** |
| 6 | Click behavior on status bar items | ✓ each item routes to different command | ✓ opens chat | we're better |
| 7a | Tab/activity-bar dot indicators | ✗ | ✓ on activity bar icon | **major gap** |
| 7b | Editor tab dots (per-file) | ✗ | ✗ confirmed not on tabs | match |
| 8 | Configurable status line | ✗ | ✗ extension only | match |
| 9 | Editor title bar button | ✗ | ✓ Spark icon top-right when file open | gap |
| 10 | Notifications panel integration | ✗ | ✗ undocumented | match |
| 11 | Source Control panel UI | ✗ | ✗ | match |
| 12a | Welcome view (`viewsWelcome`) | ✓ Sign in + walkthrough link | unclear | likely we're better |
| 12b | Onboarding checklist persistent panel | ⚠️ have walkthrough (one-shot), no persistent panel | ✓ collapsible graduation-cap panel on first use | gap |
| 12c | Status-bar progress for long-running tool | ✗ | ⚠️ progress indicator | gap |

**Top misses ranked by impact**

1. **No tab/activity-bar dot for "Claude needs you" / "Claude finished while you were away".** Single most important non-panel UX cue. When the chat is hidden, users can't tell that a tool needs approval or that the agent finished. **Fix sketch**:
   - In `ChatViewProvider`, observe `webviewView.visible`. When approval pending or stream completes while not visible → set a context key + flash a dedicated status-bar item with `$(circle-filled)` in a coloured background.
   - Add `viewBadge` on the webviewView when API supports it (newer VS Code versions do).
   - Cheapest MVP: a 5th `statusBarItem` that shows a coloured pill while the chat is hidden and there's pending state.
2. **No streaming-state surface in the status bar.** Users in agent mode glance at the panel; if hidden, they don't know Claude is still working. **Fix**: while `isStreaming`, repurpose `statusBarItem` to show `$(sync~spin) Ailancers — running…` with elapsed timer. Cheap, leverages the existing item.
3. **No editor-toolbar "Open chat" button.** Claude Code's spark icon in the top-right of the editor is a discovery booster. Add an `editor/title` menu entry firing `ailancers.openChat`.
4. **No persistent onboarding checklist panel.** We have a walkthrough (one-shot), Claude Code has a collapsible checklist surface that survives sessions. Lower priority.
5. **`projectBarItem` empty state** could be more pointed — today it's a yellow "Select Project" pill; a richer tooltip ("No project selected — time will not be tracked") aids new-user discovery.

**Things we do better**

- **4 distinct status bar items**, each with its own click target. We surface time tracking, AI request count, active project, hourly tracker, sign-in. Real productivity win for our specific user (developer who also tracks billable hours).
- **Yellow auth-warning pill** is a much stronger discoverability cue than Claude Code's silent unauthenticated state.
- **Custom activity bar container** with semantic identity vs Claude Code's draggable panel.
- **Hourly billing tracker** — orthogonal to Claude Code, meaningful surface for our product. Differentiator.

**Code references**: [StatusBarProvider.ts](apps/extension/src/providers/StatusBarProvider.ts) (4-item rich surface) · [package.json:44-67](apps/extension/package.json#L44-L67) (activity bar container + welcome view) · No `webviewView.badge` / `setContext` calls for pending or hidden state · No `editor/title` menu contribution

---

## 4.4 Notifications

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | VS Code toast — info | ✓ many call sites (login, tracking on/off, screenshot, auto-start, billing) | ✗ undocumented | **we're better** |
| 1b | VS Code toast — warning | ✓ tracking-paused, hourly limit warnings, screenshot fail | ✗ | we're better |
| 1c | VS Code toast — error | ✓ login fail, export fail, auto-start fail, screenshot delete fail | ✗ | we're better |
| 1d | Modal info message for approval | ⚠️ duplicate of `ApprovalCard` (the 1.5 bug) | ✓ inline only | bug |
| 2 | Native OS notification when VS Code unfocused | ✗ | ⚠️ only in some terminals; extension uses dot | match |
| 3 | Sound / audio cues | ✗ | ✗ in extension | match |
| 4 | Tab / icon animation when chat hidden | ✗ no badge | ✓ blue/orange dot on spark icon | **major gap** (cross-ref 4.3) |
| 5 | Long-task completion alert when chat unfocused | ✗ silent | ⚠️ status dot only | **gap** (we don't even have the dot) |
| 6 | Permission-needed alert when chat unfocused | ✗ silent | ✓ blue dot | **major gap** |
| 7a | Error notification for billing | ⚠️ inline `BillingCard`, not OS toast | ⚠️ chat transcript text | match (different style) |
| 7b | Error notification for model / network failures | ⚠️ stream errors land in chat | ⚠️ same | match |
| 8 | Global opt-out setting | ✗ | ✗ extension; CLI yes | match |
| 9 | Per-event opt-in | ✗ | ⚠️ via Notification hooks in CLI | gap |
| 10 | Bell-sound preference | ✗ | ⚠️ CLI only | match |
| 11 | Notification grouping / dedup | ✗ default stack | ✗ undocumented | match |
| 12a | "Click notification to focus chat" | ⚠️ approval-modal action buttons; no toast→focus path | ⚠️ via dot click | match |
| 12b | `withProgress` for long-running tools | ✗ | ✗ | match |

**Top misses ranked by impact**

1. **No "Claude needs you" alert when the chat is hidden.** Same root cause as 4.3 #1 / #7 — different UI surface. Two complementary fixes:
   - **Activity-bar/status-bar dot** (covered in 4.3) for passive awareness
   - **OS-level toast** for alt-tabbed users: fire `vscode.window.showInformationMessage("Ailancers: tool needs approval", "Open chat")` when an approval arrives while the webview is hidden. Native VS Code surface, no special permissions. Pair with `ailancers.notifications.permissionRequest = "auto" | "always" | "never"`.
2. **Duplicate approval surface** — `ApprovalService.requestApproval` (modal) vs `ApprovalCard` (inline). Already on the fix list (1.5). From this item's lens: when the modal *does* fire it's our closest thing to a "Claude needs you" alert — but it's silent when the webview is focused, then loud when not, with no consistency. Replace with "ping-when-hidden" toast routed to the inline card.
3. **No `withProgress` / status-bar progress for long-running tools.** When a tool takes 30+ seconds, only the chat panel shows anything. **Sketch**: in `ToolExecutor.runTerminal` for commands above some threshold, wrap with `vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Ailancers: running …" })`.
4. **No per-event opt-out.** Once we add toasts (#1) we need at least: `ailancers.notifications.toolCompletion`, `ailancers.notifications.permissionRequest`, `ailancers.notifications.budgetWarning`. Otherwise toast fatigue.
5. **No sound cue option.** Low priority; some users genuinely want it (build-watch patterns). Rely on OS notification sound first.

**Things we do better**

- **Far broader use of native VS Code toasts** for state transitions (sign-in, sign-out, tracking on/off, screenshot capture, auto-start success, billing warnings, hourly-tracker alerts). Claude Code is silent on most of these. For a product that *also* tracks billable hours, our toast surface is a genuine differentiator.
- **Inline `BillingCard`** for suspended/cap-reached — actionable "Top Up Wallet" button. Claude Code dumps billing errors into transcript text.
- **Modal action buttons** (`showInformationMessage("...", "Allow", "Deny")`) — when used, give a useful native shortcut.

**Code references**: ~26 toast call sites across [extension.ts](apps/extension/src/extension.ts), [ActivityTracker.ts](apps/extension/src/services/ActivityTracker.ts), [HourlyBillingTracker.ts](apps/extension/src/services/HourlyBillingTracker.ts) (most surface), [ScreenCaptureService.ts](apps/extension/src/services/ScreenCaptureService.ts), [AutoStartService.ts](apps/extension/src/services/AutoStartService.ts), [AuthService.ts](apps/extension/src/services/AuthService.ts), [ApprovalService.ts:18](apps/extension/src/services/ApprovalService.ts#L18) (the duplicate modal — cross-ref 1.5)

---

## 4.5 Workspace trust / multi-root

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | Declared untrusted-workspace support | ✗ no `capabilities.untrustedWorkspaces` (defaults to "supported in trusted only") | ✗ same | match |
| 1b | Disabled file edits in untrusted workspaces | ⚠️ extension just doesn't load there | ⚠️ relies on VS Code's Restricted Mode | match |
| 2a | Multi-root `.code-workspace` — works at all | ⚠️ uses `workspaceFolders[0]` everywhere — first root only | ⚠️ uses launch directory | match |
| 2b | Per-folder rules / CLAUDE.md | ✗ only `workspaceFolders[0]` checked | ✓ walks dir tree from cwd | gap (also 2.4) |
| 2c | Selecting active root in multi-root | ✗ | ✗ inferred from focused file | match |
| 3 | No-folder mode (single file / scratch) | ⚠️ degrades hard — `getWorkspaceRoot()` throws | ✓ chat works; file ops limited | **partial gap** |
| 4a-d | Remote-SSH / Devcontainer / WSL / Codespaces | unclear — no `extensionKind`, never tested | unclear | match |
| 5a | Per-workspace storage | ✗ all settings user-scoped | ✗ extension uses `.claude/...`, not VS Code settings | match (different mechanism) |
| 5b | Per-project storage at our equivalent (`.ailancers/`) | ✓ rules only | ✓ rules + agents + commands + settings + auto-memory | gap (also 2.2 / 2.4) |
| 5c | Global per-user storage | ⚠️ `globalStorageUri` (opaque) | ✓ `~/.claude/...` plain files | gap (also 2.4) |
| 6 | Settings precedence chain | ⚠️ inherits VS Code's folder > workspace > user > default automatically | ✓ documented (Managed → CLI → Local → Project → User) | match (different mechanism) |
| 7a | `.gitignore` awareness on tools | ✗ glob/search/list/read all descend into ignored dirs | ✓ `respectGitIgnore: true` default | **major gap** |
| 7b | Setting to control gitignore respect | ✗ | ✓ | gap |
| 8 | Symlink canonicalization | ⚠️ `resolvePath` does prefix check pre-realpath; symlinks pointing outside the workspace pass | ⚠️ allow rules require both symlink + target; deny if either | **gap (subtle security)** |
| 9 | Worktrees | ✗ | ⚠️ CLI `--worktree`; extension undocumented | match |
| 10 | Restricted networks / proxies | ⚠️ relies on VS Code's network stack | ✗ undocumented | likely match |
| 11 | Monorepo / Jupyter / .NET specifics | ✗ | ✗ | match |
| 12 | Project identity for memory / cost scoping | ⚠️ chat is user-global; auto-start uses fsPath | ✓ git root → `~/.claude/projects/<id>/...` | gap (also 3.1) |

**Top misses ranked by impact**

1. **No-folder mode crashes the agent.** Open VS Code on a single file / scratch buffer and `getWorkspaceRoot()` throws — every `read_file`/`write_file`/`edit_file` fails hard. The agent can't even read the file you're staring at. **Fix sketch**:
   - In `getWorkspaceRoot()`, fall back to `path.dirname(activeTextEditor.document.uri.fsPath)` when no workspace folder is open
   - In `WorkspaceContextService.getEditorContext()`, mark `activeFile` as absolute when no root
   - Gate `write_file`/`edit_file` on having either a folder or an active editor; allow read-side tools to run regardless
2. **No `.gitignore` awareness on tools.** Today `glob_files`, `search_files`, `list_directory`, `read_file` all descend into `node_modules`, `.git`, `dist`. Burns context tokens, time, money. Claude Code respects gitignore by default. **Fix sketch**:
   - Add `respectGitIgnore: true` setting (default true)
   - Use the [`ignore`](https://www.npmjs.com/package/ignore) npm package, parse workspace-root + per-folder `.gitignore`
   - Apply in glob/search/list; for `read_file`, refuse with a hint and a `force: true` escape
   - Single biggest agent-quality lever in this item
3. **Multi-root only sees the first folder.** Every code path uses `workspaceFolders[0]`; in `.code-workspace` setups (common in monorepos) tools silently target the wrong root. **Fix**: resolve per-operation via `vscode.workspace.getWorkspaceFolder(editor.document.uri)`. Load project rules from each folder.
4. **No symlink canonicalization in `resolvePath`.** Prefix check is pre-realpath; a workspace-internal symlink pointing outside passes. **Fix**: `fs.realpath(resolved)` before the prefix check. Low-frequency security issue.
5. **No stable project identity for chat scoping.** Re-affirms 3.1 — pattern: `git remote.origin.url` → fall back to `workspaceFolders[0].uri.fsPath` → hash.
6. **Remote-SSH / WSL / Codespaces — declare what we support.** Two actions: declare `extensionKind: "workspace"` in `package.json` (extension runs on remote, not UI host); test pass on Remote-SSH + WSL during a release.

**Things we do better**

- **Workspace-escape protection** (`resolvePath` rejects `..` traversal). Claude Code documents the rules but ours is enforced in-process at the tool boundary. Modulo the symlink edge case above, the boundary is enforceable.

**Code references**: [ToolExecutor.ts:54-71](apps/extension/src/services/ToolExecutor.ts#L54-L71) (`getWorkspaceRoot` + `resolvePath` — no fallback, no realpath) · [WorkspaceContextService.ts:18, 57](apps/extension/src/services/WorkspaceContextService.ts#L18) (always `workspaceFolders[0]`) · No `.gitignore` awareness anywhere · No `extensionKind` declared in [package.json](apps/extension/package.json) · No `capabilities.untrustedWorkspaces` declaration

---

## 5.1 Permission modes

> **Most lopsided item of the entire audit.** Claude Code's permission system is a fully-fledged engine (modes, deny/ask/allow lists with glob path patterns, scope precedence, protected paths, MCP integration, classifier-reviewed auto mode, sandboxing). Ours is six lines of hardcoded sets in [shared-types](packages/shared-types/src/agent.ts) plus an in-memory `Set<string>`.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | Modes — `default` | ✓ implicit | ✓ | match |
| 1b | `acceptEdits` (category-level) | ✗ closest = per-tool "Allow All This Session" | ✓ | **gap** (1.5, 2.3) |
| 1c | `plan` | ✓ enforced via tool-list filter | ✓ | match |
| 1d | `auto` (classifier-reviewed) | ✗ | ✓ research preview | gap |
| 1e | `dontAsk` (auto-deny unless allowed) | ✗ | ✓ CI/scripts | gap |
| 1f | `bypassPermissions` (with `rm -rf /` circuit-breaker) | ✗ | ✓ | gap |
| 2 | Mode-switch picker | ⚠️ Plan toggle only, visible only in agent mode | ✓ click indicator at bottom of input | gap (2.3) |
| 2b | Initial mode setting | ✗ | ✓ | gap (2.3) |
| 3a | "Yes, don't ask again" — Bash persists to `settings.json` | ⚠️ session-only (whole-tool) | ✓ persists | **gap** |
| 3b | "Yes, don't ask again" — Edit (session memory) | ✓ via Allow All This Session | ✓ | match |
| 4a | `permissions.allow` list with `Tool(specifier)` | ✗ | ✓ `Bash(npm run *)`, `Read(./src/**)` | **major gap** |
| 4b | `permissions.deny` list | ✗ | ✓ | **major gap** |
| 4c | `permissions.ask` (force-ask) | ✗ | ✓ | gap |
| 4d | Evaluation order deny → ask → allow | n/a | ✓ first match wins | gap |
| 5a | Glob patterns (`*`, `**`, `:*` trailing args) | ✗ | ✓ | gap |
| 5b | Path types — relative / `./` / `~/` / absolute (incl Windows `/c/`) | ✗ | ✓ | gap |
| 5c | Compound Bash commands evaluated per-subcommand | ✗ | ✓ | **gap** (also bug — see #12c) |
| 5d | Process wrappers stripped (`timeout`/`nice`/`nohup`/`time`/`stdbuf`) | ✗ | ✓ | gap |
| 5e | Symlink rule semantics (allow=both, deny=either) | ✗ no rules | ✓ | gap |
| 6a | Protected-path list (`.git`, `.env`, `.bashrc`, etc.) | ✗ | ✓ hardcoded | **gap** |
| 6b | Protected paths still prompt in `acceptEdits` | n/a | ✓ | gap |
| 6c | `rm -rf /` circuit-breaker even in bypass | ✗ | ✓ | gap |
| 7a | Scope precedence (managed > CLI > local > project > user) | ✗ | ✓ documented | gap |
| 7b | Cumulative merge of allow/deny across scopes | ✗ | ✓ | gap |
| 7c | Managed-policy override blocks user/project | ✗ | ✓ enterprise | gap |
| 8a | Settings file location + structure | ✗ no config file at all | ✓ `.claude/settings.json` + `~/.claude/settings.json` | **major gap** |
| 8b | `settings.local.json` gitignored personal | ✗ | ✓ | gap (also 2.4) |
| 9a | Inline approval card buttons | ✓ Allow / Allow-All-This-Chat / Deny | ✓ Allow once / Yes don't ask again / Deny | match |
| 9b | "Allow always for this path" inline | ✗ | ✗ must edit settings | match |
| 9c | Two approval surfaces (inline + OS modal) | ⚠️ duplicate (1.5 bug) | ✗ inline only | bug (1.5) |
| 10 | Audit log of approvals | ✗ | ✗ in extension; CLI shows recently-denied (auto mode) | match |
| 11a | MCP permission integration (`mcp__server__tool`) | ✗ no MCP | ✓ | gap (6.2) |
| 11b | `allowManagedMcpServersOnly` enterprise lock | ✗ | ✓ | gap |
| 12a | Default-allow read-side tools | ✓ Read/Grep/Glob/List/find_symbol/figma_read never gated | ✓ same posture | match |
| 12b | Default-allow short list of safe Bash commands | ✓ `ls dir cat head tail wc pwd echo tree find which where` | ✓ broader set | match |
| 12c | Compound-command splitting | ✗ — `cmd.startsWith(safe + " ")` only matches leading binary; `ls && rm -rf /` auto-approves | ✓ | **bug** (security) |
| 12d | Hooks layer extending permissions | ✗ no hooks | ✓ `PreToolUse` deny / force-prompt / skip | gap (5.2) |
| 12e | Sandboxing complementary to permissions | ✗ | ✓ | gap |

**Top misses ranked by impact**

1. **No persisted allow/deny config at all.** Every `npm test` run prompts every conversation; every `git log` prompts (only `git status` is in our auto-approve list). Power users hit this every session. **Fix sketch**:
   - `.ailancers/permissions.json` (project) + `~/.ailancers/permissions.json` (user) with shape `{ allow: string[], deny: string[], ask: string[] }`
   - Reuse Claude Code's `Tool(specifier)` syntax verbatim — no reason to invent our own
   - `requiresApproval()` extends to: deny match → refuse → ask match → force prompt → allow match → skip → fall through to current `DESTRUCTIVE_TOOLS` logic
   - In `ApprovalCard`, add "Allow always (write rule)" appending the matched specifier to project allow list
   - Tied to slash commands (2.1) for `/permissions add` / `/permissions list` but not blocked on it
2. **Compound-command auto-approve bug.** [agentTools.ts:259-261](apps/backend/src/services/agentTools.ts#L259-L261) does `cmd.startsWith(safe + " ")` — a model emitting `ls && rm -rf node_modules` auto-approves because it *starts* with `ls`. Real prompt-injection surface. **Fix**: split on `&&`, `||`, `;`, `|` (not inside quoted strings) and require *every* subcommand to match the safe list. Borrow Claude Code's compound-evaluation behavior. **High priority — security audit will flag this.**
3. **No `acceptEdits` mode.** 1.5 / 2.3 already raise this; restating because the unified solution is a permission-mode picker that includes accept-edits. Today's "Allow All This Session" is per-tool, not category-level — clicking it for `edit_file` still prompts every time for `write_file` and `run_terminal`.
4. **No protected-path list.** Nothing stops the agent from `edit_file`-ing `.env`, `.git/config`, or `.husky/pre-commit`. Becomes a hardcoded preset deny once #1 lands: `["Edit(.env)", "Edit(.env.*)", "Edit(.git/**)", "Edit(.ailancers/**)", "Edit(.husky/**)"]` plus user-extendable.
5. **Multi-scope precedence** — once #1 lands, the chain (managed → CLI → local → project → user) makes the system enterprise-deployable. Cheap to add: walk candidate paths in order and merge.
6. **Inline "write rule" affordance.** Approval card grows to `[Allow once] [Allow always for "npm test"] [Allow always for "npm *"] [Deny]`. One extra decision vs Claude Code's silent save, but better — theirs saves the exact command, which is too narrow to be useful.
7. **Audit log of approvals**. Out of scope for an MVP, but worth a backlog ticket: every approval/deny → row in `permission_log` (timestamp, conversation, tool, input, decision, scope). Surfaceable via `/permissions log` later. Useful for "who approved that destructive command?" forensics.

**Things we do better**

- Nothing material to call out — small wins (workspace-escape protection in 4.5, plan-mode tool-filter enforcement in 2.3) belong in those items.

**Code references**: [agentTools.ts:251-266](apps/backend/src/services/agentTools.ts#L251-L266) (entire approval logic — 16 lines) · [shared-types/src/agent.ts:14-30](packages/shared-types/src/agent.ts#L14-L30) (DESTRUCTIVE_TOOLS + AUTO_APPROVED_COMMANDS — hardcoded sets) · [ApprovalService.ts:5](apps/extension/src/services/ApprovalService.ts#L5) (sessionAutoApproved — in-memory only) · [ApprovalCard.tsx:131-150](apps/extension/webview/src/components/ApprovalCard.tsx#L131-L150) (Allow / Allow-all-this-chat / Deny — no "always" persistence)

---

## 5.2 Hooks

> **Most one-sided item in the audit.** Claude Code has 15+ hook events with five execution types (command/HTTP/MCP/prompt/agent), JSON return contracts, scope merging, async/once/timeouts, and a `/hooks` browser. We have **none** of it.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | Per-session events (`SessionStart`, `SessionEnd`) | ✗ | ✓ | gap |
| 1b | Per-turn events (`UserPromptSubmit`, `Stop`, `StopFailure`) | ✗ | ✓ | gap |
| 1c | Per-tool events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`) | ✗ | ✓ | **major gap** |
| 1d | Permission lifecycle (`PermissionRequest`, `PermissionDenied`) | ✗ | ✓ | gap |
| 1e | Subagent lifecycle (`SubagentStart`, `SubagentStop`) | ✗ no subagents | ✓ | gap (also 2.2) |
| 1f | File-system / config events | ✗ | ✓ | gap |
| 1g | Notification / Elicitation / Task lifecycle | ✗ | ✓ | gap |
| 2a | Hook config in project `settings.json` | ✗ no settings file | ✓ `.claude/settings.json` | **major gap** |
| 2b | Hook config in user `~/.claude/settings.json` | ✗ | ✓ | gap |
| 2c | Managed/enterprise scope | ✗ | ✓ | gap |
| 2d | Skill/agent frontmatter scope | ✗ | ✓ | gap (2.2) |
| 2e | `disableAllHooks` global toggle | ✗ | ✓ | gap |
| 3a | Command execution (shell) | ✗ | ✓ | gap |
| 3b | HTTP POST execution | ✗ | ✓ with `allowedHttpHookUrls` allowlist | gap |
| 3c | MCP tool execution | ✗ | ✓ | gap (6.2) |
| 3d | Prompt (delegate decision to Claude) | ✗ | ✓ | gap |
| 3e | Agent (subagent verifies) | ✗ | ✓ experimental | gap |
| 3f | Env vars (`$CLAUDE_PROJECT_DIR`, `${CLAUDE_PLUGIN_ROOT}`) | ✗ | ✓ | gap |
| 4a | Exit code contract (0=ok, 2=blocking) | ✗ | ✓ | gap |
| 4b | JSON return shape | ✗ | ✓ | gap |
| 4c | `additionalContext` injection (10KB cap) | ✗ | ✓ | gap |
| 4d | `updatedInput` to mutate tool args | ✗ | ✓ | gap |
| 5a | `PreToolUse` decisions: `allow` / `deny` / `ask` / `defer` | ✗ | ✓ | **major gap** |
| 5b | Decision precedence (`deny > defer > ask > allow`) | ✗ | ✓ | gap |
| 6 | `PostToolUse` — log / inject context, can't block | ✗ | ✓ | gap |
| 7 | `UserPromptSubmit` — block submission via exit-2 | ✗ | ✓ | gap |
| 8a | `/hooks` read-only browser | ✗ | ✓ | gap |
| 8b | UI to edit hooks | ✗ | ✗ — settings.json only | match |
| 9 | Discoverability | ✗ | ⚠️ via `/hooks` only | gap |
| 10a | Per-hook timeouts | ✗ | ✓ | gap |
| 10b | `statusMessage` (custom spinner text) | ✗ | ✓ | gap |
| 10c | Async hooks (`async: true`, `asyncRewake`) | ✗ | ✓ | gap |
| 11a | Matchers — string / regex / `\|`-separated | ✗ | ✓ | gap |
| 11b | Conditional `if` with permission rule syntax | ✗ | ✓ `Bash(git *)`, `Edit(*.ts)` | gap (5.1) |
| 11c | `once: true` from frontmatter | ✗ | ✓ | gap |
| 11d | `Stop` auto-converted to `SubagentStop` in subagents | ✗ | ✓ | gap (2.2) |
| 11e | Multiple hooks per event with merged results | ✗ | ✓ | gap |
| 12 | Sandboxing complementing hooks | ✗ | ✓ | gap |

**Top opportunities ranked by impact**

1. **A minimal `PreToolUse` + `PostToolUse` pair is the highest-leverage subset.** Most teams want exactly two things: "before edit, run lint/format on the new content" and "after bash, scan output for credentials and warn". Both fit `PreToolUse`/`PostToolUse`. **Fix sketch (MVP)**:
   - Extend the `.ailancers/permissions.json` from 5.1 to `.ailancers/hooks.json`:
     ```json
     {
       "PreToolUse": [
         { "matcher": "edit_file|write_file", "command": "./scripts/format-check.sh", "timeout": 60 }
       ],
       "PostToolUse": [
         { "matcher": "run_terminal", "command": "./scripts/scan-secrets.sh" }
       ]
     }
     ```
   - Server-side hook runner in backend invoked from `ClaudeProxyService.agentTurn` around tool execution
   - Exit-2 → block; stdout JSON parsed for `additionalContext` / `permissionDecision`
   - **v1 = command type only**; skip HTTP/MCP/prompt/agent (each carries its own attack surface)
   - **v1 = project scope only**; skip user-scope and managed merging
   - Approx: a small backend module + a few hundred lines. Real engineering effort, but unlocks every "enforce X on every edit" use case at once.
2. **`additionalContext` is the single capability that closes the most "agent quality" gaps in the whole audit.** Once `PreToolUse` returns context, you can chain in: linter errors before edit (closes part of 4.2), type-check output after `run_terminal`, pre-fetched API spec for an HTTP tool. Many teams' AI workflows turn on this one mechanic.
3. **`/hooks` slash command (read-only).** Once #1 ships, expose `/hooks` to list configured hooks per scope. Pure read; settings file edits the config. Tied to slash commands (2.1) and settings UI (6.1).
4. **`disableAllHooks` global toggle.** Cheap escape hatch when a hook misfires. Workspace setting.
5. **Status messages.** Surface a hook's `statusMessage` (e.g. "Running linter…") in the agent status bar instead of the generic label. Small UX win.
6. **HTTP / MCP / prompt / agent execution types** are clearly post-MVP. Each carries attack surface (HTTP allowlists, MCP system, prompt cost, subagents). Defer all.

**Things we do better**

- Nothing — zero extensibility surface on our side.

**Code references**: No code. Closest "lifecycle" is internal callbacks in [ClaudeProxyService.ts:23-30](apps/backend/src/services/ClaudeProxyService.ts#L23-L30) — private to orchestration. Earliest user-hook insertion points: around `callbacks.onToolCall(...)` in [ClaudeProxyService.ts:189-225](apps/backend/src/services/ClaudeProxyService.ts#L189-L225).

---

## 6.1 Settings UI

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | VS Code settings (`<vendor>.*`) | ✓ 9 keys under `ailancers.*` | ✓ ~13 keys under `claudeCode.*` | match (similar shape) |
| 1b | Project-level config file (`.<vendor>/settings.json`) | ✗ | ✓ `.claude/settings.json` | **major gap** |
| 1c | User-level config file (`~/.<vendor>/settings.json`) | ✗ | ✓ `~/.claude/settings.json` | **major gap** |
| 1d | Project-local gitignored override (`settings.local.json`) | ✗ | ✓ | gap |
| 1e | Managed/enterprise settings file | ✗ | ✓ | gap |
| 2a | Setting: model | ✗ | ✓ in Claude settings.json | gap (also 2.5) |
| 2b | Setting: initial permission mode | ✗ | ✓ `claudeCode.initialPermissionMode` | gap (also 2.3, 5.1) |
| 2c | Setting: respectGitIgnore | ✗ | ✓ default true | gap (also 4.5) |
| 2d | Setting: useCtrlEnterToSend | ✗ | ✓ | gap (also 1.1) |
| 2e | Setting: autosave before Claude reads/writes | ⚠️ relies on VS Code default | ✓ `claudeCode.autosave` true by default | gap |
| 2f | Setting: hideOnboarding | ✗ | ✓ | gap (also 6.3) |
| 2g | Setting: panel location (sidebar / panel / editor tab) | ✗ panel only via our container | ✓ `preferredLocation` | gap (also 4.3) |
| 2h | Setting: useTerminal | n/a panel only | ✓ | n/a |
| 2i | Setting: environmentVariables for shell tools | ✗ | ✓ | gap |
| 2j | Setting: disableLoginPrompt | ✗ | ✓ | gap |
| 2k | Setting: allowDangerouslySkipPermissions | ✗ | ✓ | gap (also 5.1) |
| 2m | **Settings for chat / agent / model behavior in general** | ✗ — all 9 keys are activity-tracking / screenshot | ✓ | **structural gap** |
| 2n | Settings: activity tracking (idle timeout, telemetry interval, tracking on/off) | ✓ | ✗ no equivalent | **we're better** |
| 2o | Settings: screenshot (enabled / interval / max local / blur) | ✓ | ✗ | **we're better** |
| 2p | Settings: OS auto-start | ✓ | ✗ | **we're better** |
| 3a | Hierarchical merge — VS Code workspace > VS Code user | ✓ inherited | ✓ inherited | match |
| 3b | Merge between VS Code settings and own JSON | n/a (we have no JSON) | ⚠️ they don't merge — separate worlds | foreshadows our pitfall |
| 3c | Array-merge across scopes (cumulative `allow` etc.) | n/a | ✓ | gap (also 5.1) |
| 4 | `/config` slash command — tabbed scope viewer | ✗ no slash | ✓ tabs by source with origin labels | **major gap** |
| 5 | UI to edit JSON settings file | n/a | ✗ manual JSON | likely match (when we add a file) |
| 6a | VS Code Settings UI integration | ✓ keys appear under "Ailancers Code" title | ✓ | match |
| 6b | Group / category | ⚠️ flat under one title | ⚠️ same | match |
| 6c | Description per setting | ✓ all 9 have description | ✓ | match |
| 7a | Schema validation on JSON file | n/a | ⚠️ JSON schema URL provided | gap (when we add a file) |
| 7b | Runtime validation / migration warnings | ✗ | ✗ | match |
| 8 | Per-project vs user vs managed surfaced in UI | n/a | ✓ via `/config` tabs | gap |
| 9 | "Reset to defaults" action | ✗ | ✗ | match |
| 10a | Settings affecting LLM exposed | ✗ — model is in webview state, not settings | ✓ via `~/.claude/settings.json` | gap (also 2.5) |
| 11a | Export — settings.json git-tracked | n/a | ✓ trivial | gap |
| 12a | JSON-schema autocomplete in editor | n/a | ✓ via `$schema` URL | gap (when we add a file) |
| 12b | Settings search within UI | ✓ inherited from VS Code | ✓ same | match |
| 12c | Built-in MCP server with token auth (IDE context bridge) | ✗ | ✓ `127.0.0.1:<random>` exposing `mcp__ide__*` | gap (also 4.2 #7b, 6.2) |

**Top misses ranked by impact**

1. **No `.ailancers/settings.json` foundation.** Single most-cited cross-cutting gap of the audit. Implied by 2.4 (memory), 5.1 (permissions), 5.2 (hooks), 6.1 (this). Once it lands, those four items layer naturally. **Fix sketch**:
   - Schema: `{ "$schema": "...", "model": "...", "permissions": {...}, "hooks": {...}, "rules": {...}, "env": {...} }`
   - Loader chain: `~/.ailancers/settings.json` → `.ailancers/settings.json` → `.ailancers/settings.local.json` (skip CLI/managed for v1)
   - Merge: scalars override; arrays/objects merge per-key (matching Claude Code's cumulative `allow`/`deny`/`hooks`)
   - Publish JSON schema to `schemastore.org` once stable — users get autocomplete in the editor free
   - Backend `SettingsLoader` + small `SchemaValidator` shared with extension. ~few hundred lines.
   - Roll out as part of **5.1 (permissions)** — that's the most tangible reason to add the file
2. **Cheap VS Code-settings additions, no JSON file required** — pure `package.json` changes plus thin consumers. Could ship in one afternoon:
   - `ailancers.useCtrlEnterToSend` (closes 1.1)
   - `ailancers.respectGitIgnore` (gates 4.5 implementation)
   - `ailancers.initialPermissionMode` (closes 2.3)
   - `ailancers.autosaveBeforeAgent` — pre-save dirty editors before any tool call (default true)
   - `ailancers.hideOnboarding` (closes 6.3)
   - `ailancers.notifications.{permissionRequest,toolCompletion,budgetWarning}` (closes 4.4)
3. **Settings entry point in chat UI.** Today users have to know to open VS Code Settings and search "ailancers". One line: a gear icon in `ChatToolbar` firing `vscode.commands.executeCommand("workbench.action.openSettings", "ailancers")`. Higher-effort: `/config` slash command (depends on 2.1).
4. **`/config` tabbed scope viewer** — once the JSON file exists, this is the right discovery surface for "where does this setting come from?" (project / user / VS Code default). High value at low effort once foundation is in.
5. **Group existing 9 settings.** Flat today; VS Code Settings supports category ordering. Group: `Backend` / `Activity Tracking` / `Screenshots` / `OS Integration`. Pure cosmetics, improves readability.

**Things we do better**

- **Activity-tracking, screenshot, and auto-start configurability** is wholly orthogonal to Claude Code. For a product whose pitch includes time-tracked AI usage, real surface area.
- **Single namespace (`ailancers.*`)** with consistent description pattern. Claude Code has two parallel worlds (`claudeCode.*` IDE vs `~/.claude/*` shared) and explicitly notes they don't merge — confusing.

**Code references**: [package.json:161-209](apps/extension/package.json#L161-L209) (entire settings surface — 9 keys, all activity/screenshot/autostart) · No `.ailancers/` folder convention · Settings consumed via `vscode.workspace.getConfiguration("ailancers")` in `ScreenCaptureService`, `ActivityTracker`, `AuthService`, `AutoStartService`

---

## 6.2 MCP servers

> **One of the biggest single-category gaps of the audit.** Claude Code has a fully-fleshed MCP ecosystem (400+ community servers, OAuth flows, tool search, scope merging); we have nothing.

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | MCP protocol support (stdio / HTTP / SSE) | ✗ | ✓ | **major gap** |
| 1b | Tools / Resources / Prompts as separate concepts | ✗ tools only | ✓ all three | gap |
| 2a | Built-in IDE MCP server | ✗ | ✓ `127.0.0.1:<random>` with fresh token per activation | **gap** |
| 2b | `mcp__ide__getDiagnostics` (Problems panel) | ✗ | ✓ | gap (also 4.2) |
| 2c | `mcp__ide__executeCode` (Jupyter) | ✗ | ✓ with Quick Pick approval | gap (also 4.2) |
| 3a | User-added MCP servers (config file) | ✗ no config file | ✓ `.mcp.json` / `~/.claude.json` | **major gap** |
| 3b | UI to add servers | ✗ | ✗ CLI-only addition (`/mcp` manages existing) | match |
| 3c | Format flexibility (HTTP / stdio with command/args/env) | n/a | ✓ standard JSON shape | gap |
| 4a | Local / Project / User / Managed scopes + precedence | ✗ | ✓ | gap (also 5.1, 6.1) |
| 4b | Project-level `.mcp.json` requires workspace trust before first use | n/a | ✓ | gap |
| 4c | Managed (IT-admin) lockdown via `managed-mcp.json` | ✗ | ✓ enterprise-grade | gap |
| 5a | `/mcp` slash — list + status | ✗ | ✓ list + status + enable/disable + reconnect | **major gap** |
| 5b | OAuth flow UI for remote servers | ✗ | ✓ browser login + callback + clear-auth | gap |
| 6a | Auto-connect on session start | ✗ | ✓ HTTP/SSE | gap |
| 6b | Reconnect with exponential backoff | ✗ | ✓ 5 attempts at 1/2/4/8/16s | gap |
| 6c | `list_changed` dynamic refresh | ✗ | ✓ | gap |
| 6d | Initial-connect retry on transient errors | ✗ | ✓ 3 attempts | gap |
| 7a | Tool naming `mcp__server__tool` | ✗ | ✓ namespaced | gap |
| 7b | Prompts as `/mcp__server__prompt` | ✗ | ✓ | gap (also 2.1) |
| 7c | Resources as `@server:protocol://path` mentions | ✗ | ✓ in autocomplete | gap (also 1.1) |
| 8a | Permissions for MCP tools share allow/deny | n/a | ✓ same machinery as built-in | gap (also 5.1) |
| 8b | `anthropic/alwaysLoad: true` per-tool metadata | n/a | ✓ | gap |
| 9a | Server marketplace / registry | n/a | ⚠️ external (api.anthropic.com/mcp-registry) | gap |
| 9b | Plugin-bundled MCP servers | n/a | ✓ auto-start | gap |
| 10 | Server logs accessible from UI | n/a | ✗ extension shows its own logs only | match |
| 11a | Tool search (deferred schema loading) | ✗ | ✓ default, reduces context | gap (also 3.3) |
| 11b | `MAX_MCP_OUTPUT_TOKENS` (default 25k, warn >10k) | n/a | ✓ | gap |
| 11c | Per-tool `anthropic/maxResultSizeChars` (up to 500k) | n/a | ✓ | gap |
| 12a | OAuth token storage in system keychain | n/a | ✓ macOS keychain / credentials file | gap |
| 12b | Token auto-refresh | n/a | ✓ | gap |
| 12c | Elicitation (mid-task user input forms) | n/a | ✓ | gap |
| 12d | Dynamic auth headers via `headersHelper` command | n/a | ✓ fresh per connection | gap |
| 12e | HTTP servers not reachable from other machines (localhost-only) | n/a | ✓ | gap |
| 12f | Bundled tool list extension point (workaround for no MCP) | ✓ `figma_read` hardcoded server-side | n/a — they'd ship Figma as MCP | partial — we have one bundled integration, not extensible |

**Top opportunities ranked by impact**

1. **No MCP is strategic, not tactical.** Claude Code's Tools+Skills+MCP ecosystem is the moat. Every integration we want (database query, design-system inspectors, internal APIs, Slack/Linear/Sentry) is currently either impossible without code changes or one of our seven hardcoded tools. Today's `figma_read` is bespoke; an MCP-capable extension would expose 400+ community Figma/Linear/Sentry/etc. servers for free.
2. **MVP MCP client is a known-scope chunk, not small.** Honest estimate: 1-2 weeks. Reasonable phasing:
   - **Phase 1 — stdio transport only.** Child process per server, JSON-RPC over stdin/stdout, `tools/list` + `tools/call`, namespacing `mcp__name__tool`. Skip HTTP/SSE/OAuth/resources/prompts. Config in `.ailancers/settings.json` `mcpServers: {...}` (cross-ref 6.1).
   - **Phase 2 — HTTP transport + OAuth.** Token in `globalState` (extension scope), not keychain (defer).
   - **Phase 3 — `mcp__ailancers__*` built-in.** Ship our own tools (getDiagnostics, getActiveSelection, getProjectInfo) *as* an MCP-pattern server rather than hardcoded. Lets users disable individual tools and tests our own client end-to-end.
   - **Phase 4 — Resources / Prompts / tool search / managed scope.** Defer.
3. **Cheap intermediate (no MCP needed) — bundle a `get_diagnostics` tool.** The single highest-leverage MCP capability is `mcp__ide__getDiagnostics`. Ship the capability today as a hardcoded `get_diagnostics` tool calling `vscode.languages.getDiagnostics()` in `ToolExecutor`. Belongs in 4.2's fix list; called out here because it captures most of MCP's day-1 value.
4. **`figma_read` is a positive architectural signal.** The precedent for ad-hoc third-party tools exists. When MCP eventually lands, `figma_read` should be the first thing migrated — proof point + removes a third-party API surface from our backend.
5. **Reserve the namespace today.** Even if MCP doesn't ship soon, when permissions config (5.1) lands, reserve `mcp__server` / `mcp__server__tool` patterns in our deny/allow grammar — so future-written `.ailancers/permissions.json` files don't break later. Documentation-only commitment.

**Things we do better**

- **Bundled-tool model is simpler for v1.** Eight tools that Just Work, no config, no protocol, no broken OAuth, no localhost-token files with `0600` perms. Lower surface area, shorter onboarding.
- **`figma_read` proves the third-party-integration story works** without MCP. Limited but real.

**Code references**: No code anywhere. Hardcoded tool list in [agentTools.ts](apps/backend/src/services/agentTools.ts) (8 tools incl. `figma_read`) is the closest integration surface. Adding MCP needs: backend `McpClient` service, `mcpServers` schema in our future settings file, dynamic `AGENT_TOOL_DEFINITIONS` aggregation, namespace-aware permissions in `requiresApproval`.

---

## 6.3 Onboarding

> **Genuine close-to-a-tie item.** We're slightly ahead on first-run scaffolding (sign-in screen, walkthrough, empty-chat samples); Claude Code is ahead on persistent self-paced discovery (the "Learn Claude Code" checklist).

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | First-launch flow | ✓ Sign-in screen → walkthrough → empty chat | ✓ Sign-in screen → "Learn Claude Code" checklist | match |
| 2a | Browser-based login | ✓ primary "Login with Ailancers" | ✓ standard | match |
| 2b | Email/password fallback | ✓ secondary form same screen | ✗ OAuth-only | **we're better** |
| 2c | Third-party API keys (Bedrock / Vertex / Foundry) | ✗ — proxied via our backend | ✓ via env vars | gap (low priority) |
| 3 | VS Code walkthrough contribution | ✓ 3 steps (Sign in / Pick project / Open chat) | ✓ via "Open Walkthrough" cmd | match |
| 3b | Auto-completion events on steps | ✓ `onCommand:ailancers.{login,selectProject,openChat}` | unclear | likely match |
| 4a | Sample prompts on empty chat | ✓ ⚡ Agent + Code / 📋 Plan / 🔍 QA / 🎨 Design + ↑ + Shift+Enter hints | ✗ not documented | **we're better** |
| 4b | LoginScreen feature cards | ✓ 4 cards (AI Agent / QA / Design / Tracking) | ✗ | **we're better** |
| 5a | Capability discovery — `/` slash menu | ✗ no slash | ✓ command menu lists capabilities | gap (also 2.1) |
| 5b | Capability discovery — `@` mentions | ✗ | ✓ `@` + Alt+K hints | gap (also 1.1) |
| 5c | Capability discovery — walkthrough | ✓ | ✓ | match |
| 5d | Persistent input-footer hints (after first message) | ⚠️ hints vanish once chat is non-empty | ✓ selection count + context usage always visible | gap (also 4.1, 3.3) |
| 6 | Tooltips on interactive elements | ✓ on every status bar item, agent buttons, plan toggle | ⚠️ "minimal" per docs | **we're better** |
| 7 | Project-init flow (suggest `/init` in new repo) | ✗ no `/init`; have "Pick project" step | ✗ `/init` exists in CLI but not auto-suggested | match |
| 8a | Onboarding checklist panel (persistent, dismissable) | ✗ | ✓ "Learn Claude Code" graduation-cap panel | **gap** |
| 8b | Re-open via setting | ✗ once walkthrough step completes, hard to re-show | ✓ uncheck `hideOnboarding` | gap |
| 9 | Hide-onboarding setting | ✗ | ✓ `claudeCode.hideOnboarding` default false | gap (also 6.1) |
| 10 | Re-onboarding on reinstall / upgrade | unclear — VS Code walkthrough runs once per ID | unclear | match |
| 11a | In-product `/help` command | ✗ | ✓ | gap (also 2.1) |
| 11b | Docs / Discord links surfaced | ✗ | ✓ in error messages, quickstart | gap |
| 11c | Help entry point in chat UI | ✗ | ⚠️ via `/help` only | match (both bury it) |
| 12 | Sample workspace / demo mode | ✗ | ✗ | match |
| 12b | Status-bar yellow "Sign in" pill | ✓ unauthenticated state | ✗ silent | **we're better** (4.3) |
| 12c | viewsWelcome with command links | ✓ "Sign In" + "Open Get Started" | unclear | likely match |
| 12d | Progression scaffolding after sign-in | ⚠️ no in-chat "first conversation" coach | ✓ checklist drives next steps | gap |

**Top opportunities ranked by impact**

1. **No persistent onboarding checklist after sign-in.** Our walkthrough runs *before* sign-in (3 steps); we have nothing that scaffolds the user's first 5-10 minutes of *using* the agent. Claude Code's "Learn Claude Code" checklist walks new users through capabilities at their own pace, dismissable and re-openable. **Fix sketch**:
   - Collapsible `OnboardingChecklist` component above `MessageList`
   - Items: "Try plan mode" / "Switch agent type to QA on your open file" / "Edit project rules at .ailancers/instructions.md" / "Pin a screenshot of your design and ask the agent to match it"
   - Auto-check items by detecting the user did the thing (toggled plan mode, etc.) — same `completionEvents` pattern as the walkthrough
   - Persist in `globalState` per-user; hide once all done
   - Re-open via `ailancers.hideOnboarding` (cross-ref 6.1)
   - Closes discovery gap from 1.1 (`/`, `@`), 2.3 (plan), 2.4 (rules), 4.1 (selection)
2. **Capability discovery hints in the input footer.** Today's `↑ history` / `Shift+Enter` hints only show on empty-chat empty state and vanish after one message. Move them to a persistent input footer with periodic rotation: `↑ for history · Shift+Enter for newline · /commands · @files`. Cross-refs 4.1 (selection indicator), 3.3 (context bar), 1.1.
3. **Help / docs entry point.** No link to docs anywhere. Add `?` icon in `ChatToolbar` opening docs URL via `vscode.env.openExternal(...)`. One line. When `/` ships, `/help` lands here too.
4. **`hideOnboarding` setting** — belongs in 6.1's cheap-package.json wins list; called out here for the conceptual link.
5. **"Re-show walkthrough" Cmd Palette command** — useful for users re-orienting after a break or onboarding a new colleague over their shoulder. VS Code API supports this directly.

**Things we do better**

- **Empty-chat sample prompts** with concrete bracketed feature names — Claude Code has nothing on empty chat
- **LoginScreen feature cards** previewing the 4 capabilities — Claude Code doesn't surface this
- **Email/password fallback login** — Claude Code is OAuth-only
- **Yellow status-bar Sign-in pill** (4.3) — Claude Code's unauthenticated state is silent
- **Tooltip coverage** on every interactive element — docs explicitly note Claude Code's is "minimal"
- **Browser-login progress hint** ("A browser window has opened. Sign in there to continue.")

**Code references**: [package.json:119-160](apps/extension/package.json#L119-L160) (walkthrough) · [package.json:63-67](apps/extension/package.json#L63-L67) (viewsWelcome) · [LoginScreen.tsx](apps/extension/webview/src/components/LoginScreen.tsx) (rich first-screen) · [MessageList.tsx:55-73](apps/extension/webview/src/components/MessageList.tsx#L55-L73) (empty-chat sample prompts) · [StatusBarProvider.ts:24-28](apps/extension/src/providers/StatusBarProvider.ts#L24-L28) (yellow Sign-in pill) · No `OnboardingChecklist` component · No `?` help entry point

---

## 6.4 Keybindings

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | `package.json` `contributes.keybindings` registered | ✗ none | ✓ ~4 (Focus, Open-in-New-Tab, New Conversation, Insert @-Mention) | **major gap** |
| 2 | Cmd/Ctrl+Esc — focus toggle between editor and chat input | ✗ | ✓ | **gap** |
| 2b | Cmd/Ctrl+Shift+Esc — open in new tab | ✗ | ✓ | gap |
| 3a | Alt-K / Option-K — insert `@file#L5-10` from selection | ✗ | ✓ when `editorFocus` | **major gap** (also 1.1) |
| 3b | Other text-insertion shortcuts | ✗ | ✗ | match |
| 4 | Ctrl+O — collapse/expand all thinking blocks | ✗ | ✓ session-wide | gap (also 1.2, 2.5) |
| 5 | Cmd+N / Ctrl+N — new conversation | ✗ | ⚠️ opt-in via `enableNewConversationShortcut`, default off | gap (cheap) |
| 6a | Enter to send | ✓ webview-only handler | ✓ | match |
| 6b | Shift+Enter newline | ✓ default | ✓ | match |
| 6c | Esc to interrupt | ✗ (3.4 cross-ref) | ✓ | **gap** |
| 6d | Arrow-key history nav | ✓ explicit composing-buffer impl | ✓ implied | **we're better** |
| 6e | `useCtrlEnterToSend` setting | ✗ | ✓ | gap (also 1.1, 6.1) |
| 7 | Customisation via `keybindings.json` | n/a — we have no defaults registered | ✓ standard VS Code | n/a until we register |
| 8a | Shortcut hints in Cmd Palette | ✓ inherited (once keys bound) | ✓ | match |
| 8b | Shortcut hints in VS Code Keyboard Shortcuts editor | n/a — nothing to remap | ✓ | gap (until we register) |
| 8c | Inline shortcut hints in chat UI | ✓ on empty-state (`↑` + `Shift+Enter`) | ✗ minimal — Cmd Palette only | **we're better** (but vanishes — 6.3) |
| 9 | `when` clauses to avoid conflicts | n/a | ✓ Alt+K only `editorFocus`, Cmd+N only chat-focused | gap (when we add them) |
| 10 | Platform-specific labels (Cmd vs Ctrl) | n/a | ✓ via `mac:`/`win:`/`linux:` keys | gap (when we add them) |
| 11a | Discoverability — Cmd Palette | ✓ all `ailancers.*` commands | ✓ | match |
| 11b | Discoverability — VS Code Keyboard Shortcuts editor | ✓ commands appear (unbound) | ✓ | match |
| 11c | Onboarding checklist mentions shortcuts | ✗ no checklist (6.3) | ✓ | gap |
| 11d | In-extension shortcut cheat sheet | ✗ | ✗ | match |
| 12a | Vim/emacs adapter | ✗ relies on VS Code native | ✗ same | match |
| 12b | Multi-key chords (Cmd+K Cmd+S style) | ✗ | ✗ | match |
| 12c | Auto-focus chat input when chat opens | unclear | ✓ | likely gap |
| 12d | Returns focus to editor when chat closes | unclear | ✓ | likely gap |

**Top opportunities ranked by impact**

1. **Add a small default keybindings set.** Cheapest, highest-discoverability fix in this section. Register **5 combinations** in `contributes.keybindings`:
   - `ailancers.openChat` — `Ctrl+Shift+L` / `Cmd+Shift+L` (avoid Cmd+L = Select Line)
   - `ailancers.toggleAgentMode` — `Ctrl+Alt+A` / `Cmd+Alt+A`
   - `ailancers.newConversation` — opt-in via `ailancers.enableNewConversationShortcut`, default off, mirror Claude Code's `Cmd+N` when on
   - `ailancers.stopGeneration` — Esc, `when: "ailancersChatFocused"` (avoid stomping editor Esc)
   - `ailancers.insertFileReference` — `Alt+K` / `Option+K`, `when: "editorFocus"` (matches Claude Code exactly)
   - **Pure `package.json` + tiny implementations for `insertFileReference` / `stopGeneration`.** One PR.
2. **`Cmd/Ctrl+Esc` focus-toggle command.** Once users have it, they stop using the mouse to switch between editor and chat. Implement: `ailancers.focusInput` calls `webviewView.show(true)` then posts a `focusInput` message handled in webview by `textareaRef.current?.focus()`.
3. **Esc to cancel generation** — already on 3.4's list. Use `when: "ailancersChatFocused && ailancersIsStreaming"`.
4. **`when`-clause scaffolding.** When registering keybindings, set up context keys via `setContext`:
   - `ailancersChatFocused` — on `webviewView.onDidChangeVisibility` + focus events
   - `ailancersIsStreaming` — on stream start/end
5. **Persistent shortcut hints in input footer** — already on 6.3's list. Hints (`↑ history · Shift+Enter newline · Cmd+Esc focus · Alt+K file ref · /commands · @files`) belong in the persistent footer, not just empty-state.
6. **Auto-focus management.** Focus input when chat opens; return focus to previous editor when chat dismisses via shortcut. Both are small webview `useEffect` additions.

**Things we do better**

- **Empty-state shortcut hints with `<kbd>` styling** — Claude Code only surfaces shortcuts via Cmd Palette
- **↑/↓ input history with explicit composing buffer** — theirs is "implied"

**Code references**: [package.json:69-117](apps/extension/package.json#L69-L117) (commands registered, no keys bound) · No `contributes.keybindings` block · [ChatInput.tsx:74-114](apps/extension/webview/src/components/ChatInput.tsx#L74-L114) (webview Enter / Shift+Enter / ↑↓ handler) · No global Esc handler · No `setContext` calls anywhere

---

## 7.1 Themes

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Chat respects VS Code active theme | ✓ extensive `--vscode-*` token usage in [index.css](apps/extension/webview/src/styles/index.css) (1547 lines) | ✓ | match |
| 2 | Colours pulled from theme tokens | ✓ ~50+ token refs | ✓ | match |
| 3 | Code-block syntax highlighting follows theme | ⚠️ `highlight.js` default-dark stylesheet, no theme detection | ⚠️ "hardcoded dark" — issue #8879 closed "not planned" | match (both poor; we can fix unilaterally) |
| 4a | Custom brand colours regardless of theme | ⚠️ `LoginScreen` `#f5c518`, `BillingCard` red/amber tints | ⚠️ yellow `#cca700` + orange `#d18616` | match |
| 4b | Theme-aware brand fallback (`var(--vscode-charts-yellow)`) | ✗ hardcoded hex | ✓ uses token + fallback | gap |
| 5a | High-contrast theme support | ✓ inherited via tokens | ✓ | match |
| 5b | Visible focus rings (WCAG AA) | ✓ `:focus-visible` `2px solid` | ✓ same | match |
| 6 | Light theme behaviour | ✓ tokens cascade | ✓ same | match |

**Top opportunities ranked by impact**

1. **Theme-aware syntax highlighting.** Both stuck on dark; Claude Code's #8879 closed "not planned" — measurable lead opportunity. Smallest path: detect VS Code theme via `document.body.dataset.vscodeThemeKind`, swap the highlight.js stylesheet (ship 3 pre-built CSS files: `default-dark`, `default-light`, `a11y-high-contrast`). Better path: don't ship highlight.js theme CSS, write our own ~30-rule CSS using `--vscode-symbolIcon-keywordForeground` / `-stringForeground` / `-commentForeground` tokens — perfect-fidelity theming for free.
2. **Replace `LoginScreen` hardcoded `#f5c518`** with `var(--vscode-charts-yellow, #f5c518)`. One line; preserves brand if no token set.
3. **`BillingCard` colour values** — currently raw RGB-with-alpha hex. Will look harsh in light theme. Wrap with `var(--vscode-editorWarning-foreground)` / `-errorForeground` semantic tokens.

**Things we do better**

- Can ship the syntax-highlight theme fix unilaterally; Claude Code's bug is publicly closed "not planned"

**Code references**: [index.css](apps/extension/webview/src/styles/index.css) · [LoginScreen.tsx:53-54](apps/extension/webview/src/components/LoginScreen.tsx#L53-L54) · [MessageList.tsx:175-210](apps/extension/webview/src/components/MessageList.tsx#L175-L210) · [markdown.ts:11-19](apps/extension/webview/src/utils/markdown.ts#L11-L19)

---

## 7.2 Accessibility

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | ARIA roles on interactive elements | ⚠️ 2 sites: `ApprovalCard` `role="alertdialog"`, `ToolCallDisplay` `role="button" tabIndex={0}` | ⚠️ minimal | match (both weak) |
| 1b | `aria-label` on icon-only buttons | ✗ rely on `title` | ⚠️ same | match |
| 2a | Tab order through chat panel | ⚠️ natural DOM flow | ⚠️ same | match |
| 2b | Visible focus rings | ✓ `:focus-visible` + `--vscode-focusBorder` | ✓ same | match |
| 2c | Skip-to-input link / shortcut | ✗ | ✗ | match |
| 3a | `aria-live` for streaming text | ✗ | ✗ | match |
| 3b | `aria-busy` on running tools | ✗ | ✗ | match |
| 3c | Approval-prompt arrival announced | ✗ — `role="alertdialog"` set but no live region | ✗ | match |
| 4a | Focus management on dialog open/close | ✗ | ✗ | match |
| 4b | Restore focus to caller after dismiss | ✗ | ✗ | match |
| 5 | `prefers-reduced-motion` honoured | ✗ — `streaming-cursor` blink, agent pulse, fade-ins all unconditional | ✗ same | match (both fail same way) |
| 6 | WCAG AA contrast | ⚠️ inherited via tokens; `BillingCard` 0x20 overlays may dip | ⚠️ same | match |
| 7 | Font-size scales with `editor.fontSize` | ✓ via `--vscode-font-size` | ✓ same | match |
| 8 | Public a11y issues filed/addressed | unclear | unclear — docs don't address | match |

**Top opportunities ranked by impact**

1. **`aria-live="polite"` on the streaming assistant message body.** Highest screen-reader-impact change. Add `role="log" aria-live="polite" aria-relevant="additions"` to the streaming `<div className="msg-content">` in `MessageList`. ~5 lines.
2. **`prefers-reduced-motion` media query** wrapping every animation:
   ```css
   @media (prefers-reduced-motion: reduce) {
     .streaming-cursor::after { animation: none; opacity: 1; }
     .agent-status-dot { animation: none; }
   }
   ```
3. **`aria-label` on every icon-only button** (camera/attach, send, stop, remove-image, copy, edit). `title=` is *not* a screen-reader replacement.
4. **Focus management on `ApprovalCard`.** `useRef` + `useEffect` to focus primary "Allow" button on mount; restore previous focus on dismiss. ~15 lines.
5. **Audit colour contrast on custom overlays.** `BillingCard` `0x20` alpha tints are the most likely AA violators in light theme.
6. **Skip-to-input keyboard shortcut.** `Cmd+/` → focus input. Tied to 6.4 keybindings work.

**Things we do better**

- Nothing meaningful — both extensions are at roughly the same a11y level (poor). We have *more* upside potential because we can ship without coordinating.

**Code references**: [ApprovalCard.tsx:79](apps/extension/webview/src/components/ApprovalCard.tsx#L79) (`role="alertdialog"`) · [ToolCallDisplay.tsx:114-115](apps/extension/webview/src/components/ToolCallDisplay.tsx#L114-L115) · No `aria-live`, no `prefers-reduced-motion`, no focus trap or restore anywhere

---

## 7.3 Performance

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1a | Activation event | ✓ `onStartupFinished` (deferred) | ✓ deferred | match |
| 1b | Service init cost | ⚠️ sequential init of 7+ services | ⚠️ similar | match |
| 1c | `retainContextWhenHidden` | ⚠️ not explicitly set on our webview view | ✓ explicit | likely gap (verify) |
| 2a | Long scrollback handling | ✗ no virtualisation | ✗ same | match (both will degrade ~5k messages) |
| 2b | Auto-scroll respects manual scrollback | ✓ `stuckToBottom` + 60px slack | ⚠️ same intent | match |
| 2c | Jump-to-bottom button | ✓ "↓ New" | ⚠️ unclear | likely we're better |
| 3a | Image-heavy session memory | ⚠️ base64 in DOM, 5MB cap | ⚠️ same | match |
| 3b | Image strip / EXIF / compression | ✗ raw PNG | ✗ | match |
| 4 | Streaming throughput | ⚠️ React re-renders per chunk; `marked.parse` per render of streaming text item | ⚠️ same per-frame map | match |
| 5 | Public benchmarks / known issues | unclear | unclear | match |
| 6 | VSIX bundle size | unclear — esbuild output, would need to measure | ~5-8 MB (estimated) | likely match |
| 7a | Idle CPU/memory | ⚠️ telemetry 60s + screenshots 300s + idle polling + status-bar 30s | ✓ no equivalent (no activity tracking) | gap (cost of differentiated surface) |

**Top opportunities ranked by impact**

1. **Verify `retainContextWhenHidden: true` on the webview view.** Without it, every panel toggle reloads the webview — losing scroll, streaming state, in-flight approvals. One line in `ChatViewProvider.resolveWebviewView`. Possibly already correct, definitely worth confirming.
2. **Virtualise `MessageList`.** Once a single conversation reaches a few thousand messages, DOM grows linearly. Add `react-window` or write a small "render last N" pattern. Matters more once `/compact` (3.1, 3.3) lands so users *can* keep long conversations.
3. **Memoise `renderMarkdown` per stream item.** Currently every render re-parses every text block. Wrap each text item in `<MemoMarkdown>` keyed on content; tail re-parses (correctly), older items don't. Material reduction in DOM churn for long streams. ~30 lines.
4. **Coalesce periodic timers.** Throttle the 30s status-bar refresh, 60s telemetry, 300s screenshot onto a single shared scheduler to reduce wake-ups on battery.
5. **Bundle-size budget script** — `npm run package` prints VSIX size and warns at >10 MB.
6. **Image compression before upload.** `ScreenCaptureService` writes raw PNG; for 1440p+ displays this is 2-3 MB. `canvas.toDataURL("image/jpeg", 0.85)` or `OffscreenCanvas` resize to 1280px max-width. ~10× per-screenshot bandwidth cut.

**Things we do better**

- **Jump-to-bottom button** for long scrollback — Claude Code unclear
- Deliberate streaming auto-scroll respect (60px slack)

**Costs we accept that Claude Code doesn't**

- Activity tracking (telemetry, idle polling, screenshots, hourly billing) is orthogonal to Claude Code. They have a cleaner idle profile because they don't ship those features. Deliberate tradeoff for our time-tracking value-add.

**Code references**: [MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx) · [ScreenCaptureService.ts](apps/extension/src/services/ScreenCaptureService.ts) · [StatusBarProvider.ts:44](apps/extension/src/providers/StatusBarProvider.ts#L44) · [package.json:41](apps/extension/package.json#L41)

---

## 7.4 Telemetry / feedback

| # | Feature | Ours | Claude Code | Verdict |
|---|---|---|---|---|
| 1 | Built-in feedback button (chat UI) | ✗ | ✗ | match |
| 1b | GitHub issues link from extension | ✗ | ✗ | match |
| 2a | Crash / error reporting | ⚠️ output channel "Ailancers Code" for manual review | ⚠️ same | match |
| 2b | Automatic crash uploads | ✗ | ✗ | match |
| 3a | Telemetry — what's collected | ✓ activity sessions: ext version, vscode version, OS, project/task IDs, idle state, keystroke/file-save counts via heartbeats | ⚠️ different product — Anthropic telemetry, not extension-activity | structural difference |
| 3b | Heartbeat cadence | ✓ 60s, configurable via `telemetryIntervalSeconds` | ⚠️ likely similar | match |
| 4a | Opt-out for telemetry | ✓ `ailancers.trackingEnabled` (default true) | ⚠️ separate Anthropic controls | match (different mechanism) |
| 4b | User-facing UI toggle | ⚠️ via VS Code settings only | ⚠️ similar | match |
| 5 | Privacy notice / data-handling statement | ✗ no link in extension UI | ⚠️ general docs at code.claude.com/data-usage | gap |
| 6 | Issue templates / GitHub link in extension | ✗ | ✗ | match |
| 7 | Diagnostic export (logs for support) | ✗ | ⚠️ `Claude Code: Show Logs` Cmd Palette | gap |

**Top opportunities ranked by impact**

1. **"Send Feedback" Cmd Palette command + chat toolbar entry.** One command `ailancers.sendFeedback` opens an external URL with pre-filled fields:
   ```ts
   vscode.env.openExternal(vscode.Uri.parse(
     `https://feedback.ailancers.com?ext=${pkg.version}&vscode=${vscode.version}&platform=${process.platform}`
   ));
   ```
   Add a 💬 icon in `ChatToolbar`. Cross-ref 6.3 (`?` help icon) — same architectural slot.
2. **"Show Logs" Cmd Palette command.** We already have an output channel; `ailancers.showLogs` calls `outputChannel.show()`. One line. Closes a real "user can't get me a useful bug report" gap.
3. **Privacy notice link.** Add to LoginScreen below the form ("By signing in you agree to our [Privacy Policy](...)"). Today we collect project IDs, idle counts, screenshots, keystroke metadata — worth being explicit about.
4. **Crash reporting via VS Code notification + opt-in upload.** Catch unhandled errors, surface `showErrorMessage("Ailancers hit an error", "Send report", "Ignore")`. POST sanitised stack on consent. Standard pattern.
5. **Distinguish "activity telemetry" from "product analytics" in settings.** Today `ailancers.trackingEnabled` covers both. If we add product-analytics telemetry, separate the toggle so users can opt out of analytics without disabling the time-tracking feature they signed up for.

**Things we do better**

- **Activity telemetry is a product feature**, not just one-way analytics — users see their tracked time on a dashboard fed by the same heartbeats. Claude Code has nothing comparable.
- **Explicit opt-out flag** documented in `package.json` description. Better discoverability than "edit `~/.claude/settings.json` to opt out".

**Code references**: [TelemetryService.ts](apps/extension/src/services/TelemetryService.ts) · [extension.ts:51](apps/extension/src/extension.ts#L51) · [package.json:174-182](apps/extension/package.json#L174-L182) · No `sendFeedback`, no `showLogs`, no privacy notice anywhere

---

## Consolidated fix list (running)

Priority = (user impact × frequency) ÷ effort. Reassess as we audit more sections.

**Status legend**: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked.

### Implementation log — 2026-05-05 first-pass session

Shipped Wave 1–4 in one session. Typecheck + build clean (extension, webview, backend).

**Wave 1 — Critical bugs (7 items, all `[x]`)**:
- Compound-command splitting in `requiresApproval` — security hole closed
- AbortSignal piped end-to-end into `ToolExecutor` — Stop button now actually kills bash children
- `MessageBubble` orphan deleted; image rendering + token breakdown folded into `MessageList` (uploaded images now show in chat)
- `ApprovalService` (OS modal) deleted — single inline approval surface
- Plan-mode reset bug fixed — `planMode` independent of `agentMode` toggle
- No-folder-mode crash fixed — fall back to active editor's directory
- `fs.realpath()` canonicalisation before workspace-prefix check — closes symlink-escape

**Wave 2 — `package.json` (multiple `[x]` items, single PR)**:
- 9 new settings, all sub-categorised via `order`
- `extensionKind: "workspace"` declared
- 8 new commands, 6 new keybindings, 2 new menu entries (`editor/title`, `editor/context`)

**Wave 3 — Webview quick wins (parallel agents + sequential edits)**:
- `LoginScreen` brand colour tokenised, privacy notice added
- `ChatToolbar` ⚙/?/💬 icon buttons (settings/docs/feedback)
- `prefers-reduced-motion` media query
- `aria-live="polite"` on streaming row, `role="alert"` on `BillingCard`
- `aria-label`s on icon buttons; `(stopped)` tag on cancelled assistant messages
- `BillingCard` colour values switched to semantic tokens
- `ApprovalCard` autofocus + previous-focus restoration
- `ToolCallDisplay` diffstat in collapsed header
- `markdown.ts` rewrite: theme-aware syntax highlighting + clickable file links + long-code-block collapse
- `App.tsx` listens for host UI nudges (focusInput / insertAtCursor / requestCancel) and re-emits as window events

**Wave 4 — Host-extension quick wins**:
- `ChatViewProvider`: `openSettings`/`openDocs`/`sendFeedback`/`openFile` postMessage handlers; `webviewView.visible` tracked → `setContext("ailancersChatFocused")`; `maybeNotifyHiddenPermission` toast plumbing; `focusInput`/`insertText`/`insertFileReferenceFromActiveEditor`/`cancelActiveStream` public helpers; `openFileFromChat` with multi-root candidate resolution + line-range selection
- `extension.ts`: 8 new commands registered (`focusInput`, `stopGeneration`, `insertFileReference`, `askAilancersAboutSelection`, `openProjectRules`, `showWalkthrough`, `showLogs`, `sendFeedback`)
- `WorkspaceContextService`: new `getLocalProjectRules()` reading `instructions.local.md`; `getEditorContext()` now includes `workspaceRoot` + Problems-panel `diagnostics`
- `ChatService`: `autosaveBeforeAgent` setting honoured (saves dirty editors before sending); local rules concatenated after team rules

**Tally**: ~30 quick-wins + 2 medium ones (file-link wiring is one feature spanning 3 files; richer completion banner) marked `[x]`. ~10 partial `[~]` either declared but not fully consumed or deferred. Larger items (slash commands, MCP, subagents, fork+rewind, hooks, settings-file foundation) all still `[ ]` and gated on future planning.

**Next session priorities**:
1. Wire the deferred consumers: `useCtrlEnterToSend` in ChatInput, `respectGitIgnore` in ToolExecutor's glob/search/list/read paths, `initialPermissionMode` in App initial state, `hideOnboarding` once a checklist exists
2. `ailancersIsStreaming` context key (needs ChatService stream-start/end hook)
3. Unblock medium pieces: editor-context indicator in input footer, "Claude needs you" badge on activity bar icon, multi-root resolution in ToolExecutor, `.gitignore`-aware tools
4. **Foundation work** — start `.ailancers/settings.json` schema + loader, in service of permissions persistence (5.1) which gates hooks (5.2) and MCP config (6.2)

### Implementation log — 2026-05-05 second-pass session

Picked up the four "Next session priorities" listed above. Typecheck + build clean across all three projects.

**Items shipped this pass (6 fully `[x]`, 1 `[~]`)**:

1. **Live config plumbing webview ↔ host** — new `loadConfig`/`configLoaded` wire messages, host-side `onDidChangeConfiguration` listener pushes any `ailancers.*` change live; webview reducer adopts `initialPermissionMode` only on first config push so workspace-settings changes don't silently flip plan mode mid-conversation.
2. **`useCtrlEnterToSend` honoured** in `ChatInput.handleKeyDown` — Ctrl/Cmd+Enter sends, Enter inserts newline; input-hint updates accordingly.
3. **`ailancersIsStreaming` context key** — `ChatService` toggles via `setContext` on stream-start (in `sendMessage`/`sendAgentMessage`), stream-end (terminating wire-event branches), and cancel. Pairs with `ailancersChatFocused` to cleanly scope the Esc-to-cancel keybinding.
4. **Editor-context indicator** — `ChatViewProvider` subscribes to `onDidChangeActiveTextEditor` + `onDidChangeTextEditorSelection` and pushes `editorContextSnapshot { activeFile, selectionLines }`. ChatInput renders `📎 path (N lines selected)` between the textarea and the controls row.
5. **Multi-root resolution in `ToolExecutor.resolvePath`** — tries every workspace folder, prefers the root where the file already exists, gates absolute paths against any root.
6. **`.gitignore`-aware tools** — minimal in-tree gitignore matcher (no new dep) handling negation, dir-only, root-anchored, `**`/`*`/`?`. mtime-cached per root. Consumed by `glob_files`, `search_files`, `list_directory`, `read_file`. `read_file` accepts `force: true` to override. Honours `respectGitIgnore` setting.
7. **"Ailancers needs you" / "Ailancers finished" status-bar indicator** — 5th `StatusBarItem` (priority 102) with bell icon + warning background for pending approval, check icon for stream completion. Wired via `ChatViewProvider.onAttention` callback that taps `postToWebview` for `tool_approval_request` / `agent_complete` / `stream_end` while hidden. Cleared when chat becomes visible.
8. **OS toast on hidden-chat permission** — `maybeNotifyHiddenPermission` now actually called from the `postToWebview` tap; honours `ailancers.notifications.permissionRequest` setting.
9. *(Partial)* **Streaming-state in status bar** — the attention-indicator covers the "finished while hidden" case; a live spinner during agent runs is still pending.

**Tally update**: ~38 quick-wins + medium fixes shipped across both sessions. ~3 partial `[~]` (streaming-state spinner; aria-label on copy buttons; `hideOnboarding` consumer pending checklist UI). All other `[ ]` items are large/strategic and gated on planning.

**Next priorities**:
1. **Foundation: `.ailancers/settings.json`** — schema + loader. Single biggest cross-cutting unblock.
2. Live status-bar spinner during agent runs.
3. Persistent input-footer hints (rotating shortcuts) — depends on having more shortcuts that are useful to surface.

### Implementation log — 2026-05-05 third-pass session

Foundation work landed. `.ailancers/settings.json` is now the canonical persisted-config home; permissions and the model default are the first two consumers. Typecheck + build clean across shared-types, extension, webview, backend.

**Items shipped this pass**:

1. **Schema in shared-types** ([packages/shared-types/src/settings.ts](packages/shared-types/src/settings.ts)) — `AilancersSettings` interface with reserved sections for permissions / hooks / mcpServers / agents / rules / env. Single file convention (not split per Claude Code's pattern) — simpler mental model, atomic merge. Reserved fields documented as defined-but-unconsumed so users writing the file today don't have to migrate when hooks/MCP/etc. land.
2. **`parsePermissionRule` + `specifierMatches`** exported from shared-types — the `Tool(specifier)` grammar used by both the loader and the evaluator. Supports `*`, `**`, `:*` trailing-args, exact match.
3. **`SettingsLoader` service** ([apps/extension/src/services/SettingsLoader.ts](apps/extension/src/services/SettingsLoader.ts)) — three-scope loader (`~/.ailancers/settings.json` → `.ailancers/settings.json` → `.ailancers/settings.local.json`), mtime-cached, file-system-watcher driven. Surfaces invalid-JSON errors as a warning toast with "Open file" action. Fires `onDidChange` so consumers can refresh live.
4. **`PermissionEvaluator`** ([apps/extension/src/services/PermissionEvaluator.ts](apps/extension/src/services/PermissionEvaluator.ts)) — `evaluatePermission(settings, toolName, toolInput)` returns `"deny" | "ask" | "allow" | null`. Bash-aware compound-command splitting (quote-aware): every subcommand must match an allow; any subcommand match counts for deny/ask. Same shared splitter logic as the security-fix backend version, just reimplemented client-side to avoid a backend round-trip per tool call.
5. **`ChatService.handleWsMessage` consults the evaluator** before deciding whether to prompt. Deny → refuse the tool immediately, send error result back to model, dispatch a `tool_result_ack` to the webview so the UI updates. Ask → force a prompt even if backend said `requiresApproval = false`. Allow → skip the prompt even if backend said `requiresApproval = true`.
6. **"⤓ Always allow `Bash(npm run *)`" button** on `ApprovalCard`. Suggests a sensible specifier: bash compound → keep verb + first qualifier, wildcard the rest; file tools → glob the parent directory. Click writes the rule to `.ailancers/settings.json` via the `writeAllowRule` postMessage. Idempotent on duplicates; refuses to clobber unparseable JSON; toast confirms with "Open file".
7. **`ailancers.openPermissions` Cmd Palette command** opens `.ailancers/settings.json`, creating a starter template (with a `$schema` link, sample allow/deny rules) if the file is missing.
8. **Settings-file `model` field seeds the picker** — webview's `SET_MODELS` reducer prefers `state.config.defaultModelFromSettings` over the backend's defaults. Once the user picks something via the dropdown, `selectedModel` wins (no silent overrides mid-session).
9. **Live config refresh** — `SettingsLoader.onDidChange` triggers `ChatViewProvider.pushConfig`, so editing settings.json immediately propagates to the webview without a reload.

**Tally update**: ~42 items shipped across three sessions. Major foundation now in place; layered features (hooks v1, MCP v1) can plug into the same loader without re-architecting.

**Notable design decisions**:

- **Single file vs. split**: chose single `.ailancers/settings.json` holding everything. Reason: simpler `gitignore` story (one file to gitignore-or-not), atomic merge, fewer-files-per-feature surface. Trade-off: file gets longer as features land — split if it ever exceeds ~150 lines.
- **Client-side permission override** rather than sending rules to the backend: permissions are a *trust* decision the user owns, not a model behavior. Backend's `requiresApproval` is a safe-default; rules let the user relax or tighten it. No backend changes needed.
- **`model` field seeds, doesn't override**: user's dropdown choice always wins after the first send. A workspace-settings change shouldn't silently switch you mid-conversation.

**Next priorities**:
1. **Hooks v1** — `PreToolUse` + `PostToolUse` (command type, project scope). The schema slot is already there; hooks runner needs to be a small backend module hooked into `ClaudeProxyService.agentTurn` around tool execution.
2. **Live status-bar spinner during agent runs** — small follow-up; subscribe StatusBarProvider to ChatService stream events and swap text to `$(sync~spin) running… 12s`.
3. **Slash-command picker (Phase 1)** — typing `/` opens a popover; intercept to dispatch instead of sending. Once the picker exists, `/permissions`, `/cost`, `/copy`, `/clear`, `/model`, `/agent`, `/plan` all reuse existing behavior.

### Implementation log — 2026-05-05 fourth-pass session

Three parallel passes. Net: 13 more `[x]` items. Typecheck + build clean across shared-types, extension, webview, backend.

**Pass C — accurate audit doc**: marked all previously-unmarked items in the Medium and Large/strategic sections. Doc now reflects real status across all items.

**Pass A — knocked out small `[ ]` items** (8 fully `[x]`, 2 `[~]`):
- `📎` editor-context indicator is now click-to-toggle; toggling sets `excludeEditorContext` honoured by `ChatService.sendAgentMessage`
- Plan toggle is always visible (clicks from chat mode auto-enable agent + plan)
- `Cmd+/` second keybinding for focus-input
- `ailancers.analytics.enabled` setting declared (separate from time-tracking)
- `+X −Y` diffstat in `editFile` result text (header was already showing it)
- `edit_file` / `write_file` post-completion display now uses ApprovalCard-style find/replace blocks
- `MarkdownBlock = memo(...)` cuts marked.parse() on every render of older stream items
- "Cancelling…" intermediate state with 5s fallback
- New bundled `get_diagnostics` tool (registered everywhere; reads `vscode.languages.getDiagnostics()` filtered by severity) — captures most of MCP `mcp__ide__getDiagnostics` day-1 value with zero protocol surface
- `mcp__server*` / `Agent(<name>)` / `Hook(<id>)` namespaces reserved in `AilancersSettings.permissions` JSDoc
- `opusplan` hybrid: backend regex-swaps `claude-{sonnet,haiku}-X-Y` → `claude-opus-X-Y` whenever planMode is on
- `[x]` Inline rename — shipped in v0.2.6 (PATCH `/api/chat/conversations/:id` + double-click sidebar input)
- `[~]` Image compression — needs sharp/jimp dep, deferred

**Pass B — Slash-command system Phase 1** (1 `[x]`, the largest single shipment of this pass):
- Registry: `SlashCommands.ts` with 8 built-ins, aliases, group labels
- Picker: `SlashCommandPicker.tsx` floating popover, group-headed list, mouse + keyboard
- Integration: ChatInput intercepts leading `/`, ↑/↓ navigates, Enter/Tab selects, Esc dismisses
- Dispatcher: `App.tsx` `handleSlashCommand` short-circuits the send path; output rendered as local assistant messages (zero tokens, no model round-trip)
- 8 commands shipped: `/clear`, `/copy`, `/export`, `/cost`, `/agent`, `/plan`, `/model`, `/help`

**Tally update**: 50 `[x]` + 10 `[~]` + 14 `[ ]` shown earlier, now updated to **63 `[x]` + 11 `[~]` + 0 small-`[ ]`** plus the strategic backlog. The small-quick-win backlog is fully cleared. What's left in `[ ]` are the truly large/strategic items (slash Phase 2/3, MCP, subagents, hooks, fork/rewind, etc.).

**What's left**: the large/strategic items only — slash Phase 2/3 (`/help` etc. are done; `/compact`, `/memory`, `/init` need real engineering), Hooks v1, MCP Phase 1, Subagent system, Fork+Rewind, native diff viewer, plan-mode-as-document, prompt caching, virtualised MessageList, custom code actions, SCM commit messages, persistent onboarding checklist. Each is a multi-hour or multi-day shipment best taken one at a time.

### Implementation log — 2026-05-05 fifth-pass session

Four high-leverage strategic items shipped. All built on foundations from earlier passes.

**1. Prompt caching markers** (3.2) — single biggest cost lever in the audit. Server-side change in `ClaudeProxyService`:
- Switched `system: string` to `system: TextBlockParam[]` with `cache_control: { type: "ephemeral" }` on the block
- Added `cache_control` on the LAST tool definition in the active tool list (Anthropic caches everything before AND including the marker, so this captures the full prefix in one block)
- Applied to both the main `agentTurn` loop and the `runSubAgent` path
- **Net effect**: ~10× cheaper input tokens on every turn after the first within ~5 minutes. For agent flows where the system prompt + tool definitions repeat every turn, that's 50–80% cost reduction. Zero UX impact, zero new deps.

**2. User-level rules** (2.4) — new `WorkspaceContextService.getUserRules()` reads from `~/.ailancers/instructions.md`. `ChatService.sendAgentMessage` cascades **user → team → local** with `\n\n---\n\n` separators. Project specifics override user globals.

**3. `/init` command** (2.4 / Slash Phase 2) — webview posts `initProjectRules`; host scans 10 standard metadata files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json`, `tsconfig.json`, `README.md`, `CLAUDE.md`, `.github/copilot-instructions.md`), each capped 2–6KB, composes a structured prompt asking the AI to draft an `instructions.md`, and inserts it into the chat via `insertAtCursor`. User reviews + sends — agent then proposes `write_file` to `.ailancers/instructions.md`. Pattern: smart prompt builder, not silent backend call. Transparent.

**4. `@` file autocomplete** (1.1, biggest single discoverability win) — registered the major missing chat-input feature:
- New `AtFilePicker.tsx` component (mirrors `SlashCommandPicker`)
- New `loadFileList` / `fileListResult` wire-message pair
- Host `handleFileListRequest` uses `vscode.workspace.findFiles` then ranks: exact-name > starts-with > contains > path-contains, tie-broken by path length. Capped at 30 results.
- ChatInput detects `@<query>` at word-start (preceded by whitespace or start-of-input), debounces 80ms, sends `loadFileList`. On select replaces `@<query>` with `@<full-path> `.
- Mutually exclusive with the slash-command picker — slash takes priority.
- Now that this is live, `Alt+K` (insert `@file#L5-L10` from editor selection) becomes fully useful.

**Tally update**: previously 65 `[x]` + 15 `[~]` + 42 `[ ]`. After this pass: **70 `[x]` + 14 `[~]` + 38 `[ ]`**. (Net: 5 items moved to done — the four shipped, plus Alt-K upgraded from `[~]` since its dependent autocomplete now exists.)

**Most-impactful items remaining** (any of these is its own session):
1. **Hooks v1** — `PreToolUse` + `PostToolUse` runner. Schema is already defined in `AilancersSettings.hooks`; just need a small backend module hooked into `ClaudeProxyService.agentTurn` around tool execution.
2. **`vscode.diff` viewer** — show proposed edits in VS Code's native diff editor. Wraps `edit_file`/`write_file` approval flow.
3. **MCP Phase 1** (stdio transport) — child process per server, JSON-RPC, `tools/list` + `tools/call`. Schema reserved in `AilancersSettings.mcpServers`. ~1-2 weeks.
4. **Persistent onboarding checklist** — auto-checks items via existing `completionEvents` pattern. Closes discovery gaps from 1.1 / 2.3 / 2.4 / 4.1 in one shipment.
5. **`/compact` mid-session summarization** — backend route to summarise older turns when nearing context limit.

### Implementation log — 2026-05-05 sixth-pass session

Single major item: **Hooks v1**. The largest extensibility shipment of the audit, and the next-most-important strategic feature after the foundation work.

**What shipped**:

- New [HookRunner.ts](apps/extension/src/services/HookRunner.ts) — spawns hooks via platform shell (`cmd.exe` on Windows, `/bin/bash` elsewhere), pipes JSON payload to stdin, captures stdout/stderr (64KB cap each), parses exit code + JSON return shape. Per-hook timeout (default 60s), abort-aware so Stop kills running hooks. Env vars `AILANCERS_PROJECT_DIR` / `AILANCERS_HOOK_EVENT` / `AILANCERS_HOOK_TOOL` exposed.
- **Matchers**: `matcher` field supports exact tool name, `|`-separated alternation (e.g. `"edit_file|write_file"`), or `/regex/` form. `if` field uses the same `Tool(specifier)` grammar as permissions, mapped against the tool's primary input (command for Bash, path for Read/Edit/Write).
- **Decision merging**: when multiple hooks fire for the same event, outcomes merge per Claude Code's precedence (`deny > ask > allow`); `additionalContext` strings concatenate. First exit-2 short-circuits with that hook's stderr as the block reason.
- **Wired into [ChatService.handleWsMessage](apps/extension/src/services/ChatService.ts)** at three points:
  - `PreToolUse` runs **before** the permission evaluator — hook decisions override settings rules. Exit-2 short-circuits with denial; `additionalContext` is prepended to the tool result the model sees.
  - Tool executes
  - `PostToolUse` runs after the result returns. Cannot block (the tool already ran), but can append `additionalContext` for the model to see in the next turn.
- **`/hooks` slash entry** opens `.ailancers/settings.json` (the same single-file foundation that holds permissions). Starter template now includes a commented-out hooks example showing both `PreToolUse` and `PostToolUse`.
- **Schema was already declared** in [shared-types/src/settings.ts](packages/shared-types/src/settings.ts) — `AilancersSettings.hooks` with `HookEntry` shape. This pass just made it consumed.

**Real-world workflows now possible**:
- "Run prettier on every edit before it's accepted" — `PreToolUse` matcher `edit_file|write_file`, command runs prettier on `new_text`, exits 2 if it would reformat (with the diff as block reason)
- "Scan bash output for credentials" — `PostToolUse` matcher `run_terminal`, command pipes `toolResult.result` through `trufflehog`, returns `additionalContext: "⚠️ found 1 leaked AWS key on line 23"` on hit
- "Block edits to migration files unless I'm in a `migration/*` branch" — `PreToolUse` matcher `edit_file`, `if: "Edit(./db/migrations/**)"`, command checks `git branch`, returns `permissionDecision: "deny"` outside the right branch
- "Always run typecheck after a TypeScript edit" — `PostToolUse` matcher `edit_file`, `if: "Edit(**/*.ts)"`, command runs `tsc --noEmit` and returns `additionalContext` with any new errors

**Tally update**: previously 70 `[x]` + 14 `[~]` + 38 `[ ]`. After this pass: **71 `[x]` + 14 `[~]` + 37 `[ ]`**.

**Remaining items**: same priority list as before, minus Hooks v1.

### Implementation log — 2026-05-06 seventh-pass session

Two strategic items in one session: **`vscode.diff` viewer** + **persistent onboarding checklist**. Independent — no overlap in files or behaviour, so they shipped together.

**1. `vscode.diff` viewer for proposed edits.**

- New `ProposedContentProvider` class registered for the `ailancers-proposed:` URI scheme (lazy-registered on first use). Provides read-only access to a small in-memory map of `path → content` keyed by a per-diff random id.
- `ApprovalCard` shows a new "⇄ View diff" button next to Allow when the tool is `edit_file` or `write_file`. The button posts `showProposedDiff` to the host with the relevant payload.
- `ChatViewProvider.showProposedDiff(rawPath, oldText?, newText?, content?)` synthesises the side-by-side pair:
  - For `edit_file`: reads current disk content, splices `oldText` → `newText` to build the proposed full file. If the on-disk content has drifted (concurrent edit), falls back to the bare find-vs-replace pair so the user still sees something useful.
  - For `write_file`: left side is current disk content (or empty for new files); right side is the proposed full content.
- Both URIs registered in the provider's map, then `vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: true })` opens the native diff editor. Read-only — user reviews and clicks Allow on the card to apply.
- CSS: new `.approval-btn-diff` style sits to the left of Allow with a slightly different tone so it reads as "preview" rather than "decide".

**2. Persistent onboarding checklist.**

- New `OnboardingChecklist.tsx` component renders between `ChatToolbar` and `MessageList`. 7 items: open chat (auto-checked), first message, slash command, @-mention, plan toggle, agent type switch, project rules. Collapsible header with progress (`N/7`); explicit × dismiss; auto-hides when all done.
- Detection threaded through the natural action sites:
  - `firstMessage` / `tryAt`: `handleSend` (skips slash commands; `tryAt` regex `(^|\s)@\S` matches the picker's own trigger).
  - `trySlash`: same `handleSend`, in the slash-command branch.
  - `tryPlan`: `onTogglePlanMode` (the input footer toggle) plus the `/plan` slash dispatcher.
  - `tryAgentType`: `onSetAgentType` (only when the chosen type isn't `coder`) plus the `/agent` slash dispatcher.
- Persistence: webview posts `loadChecklist` on auth-state load; `saveChecklist` fires from a `useEffect` whenever `state.checklist` changes (with a one-shot guard on first render so the default doesn't clobber stored progress). Host stores at `globalState["ailancers.onboarding"]` as `{ completed: string[], dismissed: boolean }` — `ChatViewProvider` constructor now takes the `ExtensionContext` so it has globalState access.
- `hideOnboarding` setting hides the checklist without dispatching dismiss, so flipping the setting back off re-shows it. Explicit × persists.
- CSS uses VS Code variables throughout (panel border, list hover bg, charts-green for done items) — light/dark/HC themes free.

**Net behavioural change for users:**
- When the agent proposes an `edit_file`/`write_file`, an extra "⇄ View diff" button on the approval card opens VS Code's native diff editor instead of forcing them to read inline `- Find` / `+ Replace` blocks — much better for >5-line edits and lets them use VS Code's own search/inline diff features inside the proposed view.
- New users get a self-paced, dismissable checklist that surfaces the discoverability gaps from sections 1.1 / 2.3 / 2.4 / 4.1 in one shipment, ticking off items naturally as they explore.

**Tally update**: previously 71 `[x]` + 14 `[~]` + 37 `[ ]`. After this pass: **73 `[x]` + 14 `[~]` + 35 `[ ]`**.

**Remaining items**: MCP Phase 1, Subagent system, Fork/rewind, Slash Phase 2/3 (`/compact`, `/memory` UI, custom user commands), Auto-memory tool, Path-scoped rules, Plan-mode-as-document, "Approve plan" card, virtualised MessageList, SCM commit message generation, CodeActionProvider quick-fix, Effort selector, audit log, Hooks v2 events, MCP Phases 2+, multi-scope managed/CLI permissions, edit-the-proposed-content workflow.

### Implementation log — 2026-05-06 eighth-pass session

Five small/medium polish items shipped in one pass. Each was self-contained — no overlap in files or behaviour.

**1. Drag-drop image attach** ([ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx)). The whole `.input-area` is now a drop target. Drag-depth counter so drag-leave-into-children doesn't cause flicker; `is-dragging` outline + "Drop image to attach" overlay during a valid file drag; only image MIME types are ingested (text drops fall through to textarea); reuses the same 5MB / accepted-types guard as paste. Factored the previous paste handler into a shared `ingestImageFile(file)` so paste and drop both go through one path.

**2. Auto-detect bare paths in prose** ([markdown.ts](apps/extension/webview/src/utils/markdown.ts)). New `barePath` inline-token marked extension. Matches paths that contain a slash and end with a recognised extension (or have a `:line` / `:line-end` suffix). Renders as a `.file-link` anchor with the same `data-path`/`data-line` attrs as explicit markdown links, so the existing click delegation in MessageList opens them in VS Code at the right line. Refuses bare names without a slash to avoid noise (e.g. plain "package.json" wouldn't match unless prefixed with `./`).

**3. Expand/collapse-all keybinding** ([App.tsx](apps/extension/webview/src/App.tsx), [ToolCallDisplay.tsx](apps/extension/webview/src/components/ToolCallDisplay.tsx)). App-level `keydown` listener for `Ctrl/Cmd+Alt+]` (expand all) and `Ctrl/Cmd+Alt+[` (collapse all) — mirrors VS Code's fold/unfold style. Dispatches `ailancers:expand-all-tools` / `ailancers:collapse-all-tools` window CustomEvents. Every mounted `ToolCallDisplay` listens for these and flips its own `expanded` state — no prop-drilling, no re-render storm, each component owns its own state.

**4. `withProgress` for long-running terminals** ([ToolExecutor.ts](apps/extension/src/services/ToolExecutor.ts)). `runTerminal` starts a 2s timer when it kicks off the exec; if the command is still running at 2s, opens a `withProgress` task at `ProgressLocation.Window` (status bar) titled `Ailancers: <command>` (truncated to 60 chars). Resolves on exec completion or abort. Fast commands never show progress; only the >2s ones surface, which is the right discoverability win — "I forgot npm test was still running" becomes "I can see it in the status bar."

**5. "Open in editor" affordance** ([MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts)). Every assistant message > 400 chars (and not a stopped/error message) shows an "↗ Open in editor" action next to the role label; clicking posts `openMarkdownInEditor` to the host, which uses `workspace.openTextDocument({ language: "markdown", content })` + `showTextDocument` to open it as a new untitled `.md` doc. User can annotate inline / save / share. No re-inject-on-close (intentional — the message stays in the chat as the source of truth). Useful beyond plan mode: any long markdown response can be opened this way.

**Tally update**: previously 73 `[x]` + 14 `[~]` + 35 `[ ]`. After this pass: **78 `[x]` + 14 `[~]` + 30 `[ ]`**.

**Remaining items**: MCP Phase 1, Subagent system, Fork/rewind, Slash Phase 2/3, Auto-memory tool, Path-scoped rules, Plan-mode-as-document, "Approve plan" card, virtualised MessageList, SCM commit message generation, CodeActionProvider quick-fix, Effort selector, audit log, Hooks v2 events, MCP Phases 2+, multi-scope managed/CLI permissions, edit-the-proposed-content workflow, `/memory` slash UI, `/context` view, `/compact`, file-link hover preview, per-tool custom rendering for Read/Grep, `@agent-name` mention triggering, per-agent tool restrictions, per-project conversation scoping, 1M context picker entries, extended thinking blocks, checkpoint hover, unified permission-mode picker.

### Implementation log — 2026-05-06 ninth-pass session

Four mid-size items shipped, including the first server-side change since the prompt-caching pass.

**1. `@agent-name` mention triggering** ([App.tsx](apps/extension/webview/src/App.tsx)). `handleSend` now matches `^@(coder|qa|design|supervisor)\s+` at the very start of a message; if it hits, dispatches `SET_AGENT_TYPE` for that agent, strips the prefix from the outbound content, and sends with the new agentType for that turn. Reuses the existing system-prompt swap. Persists across the rest of the conversation (matching `/agent` semantics). One-shot — user types `@qa review the auth flow` and gets a QA review without manually toggling the agent picker first.

**2. Per-agent tool restrictions** ([ClaudeProxyService.ts](apps/backend/src/services/ClaudeProxyService.ts)). `runAgentLoop` now filters `AGENT_TOOL_DEFINITIONS` to the read-only set when `agentType` is `qa` or `design`; Coder and Supervisor still get the full toolset. Reuses the same `READ_ONLY_TOOLS` set the plan-mode filter uses. Real safety win — prior to this, a QA agent could call `edit_file` even though the system prompt told it not to. Now it literally cannot, regardless of how the model interprets instructions.

**3. `/context` slash view** ([SlashCommands.ts](apps/extension/webview/src/components/SlashCommands.ts), [App.tsx](apps/extension/webview/src/App.tsx)). New `/context` slash entry renders a local assistant message listing: conversation message counts (user/assistant), active agent + plan mode + model, current editor context (with excluded marker), last-turn input tokens, total session input tokens, and a note about project rules. No round-trip — pure UI dispatch reading existing reducer state.

**4. 1M context picker entries** ([AIService.ts](apps/backend/src/services/AIService.ts), [ClaudeProxyService.ts](apps/backend/src/services/ClaudeProxyService.ts)). Two new model entries — `Claude Sonnet 4.6 (1M ctx)` and `Claude Opus 4.6 (1M ctx)` — exposed via `getAvailableModels`. `ClaudeProxyService.runAgentLoop`, `streamChat`, and `runSubAgent` all detect the `-1m` suffix, strip it from the model id sent to the SDK (Anthropic's actual id has no suffix), and attach the `anthropic-beta: context-1m-2025-08-07` header on the request. `calculateCost` defensively strips the suffix too. Higher per-token cost — useful for very large repos or skipping `/compact`.

**Tally update**: previously 78 `[x]` + 14 `[~]` + 30 `[ ]`. After this pass: **82 `[x]` + 14 `[~]` + 26 `[ ]`**.

**Remaining items**: MCP Phase 1, Subagent system, Fork/rewind, Slash Phase 2/3, Auto-memory tool, Path-scoped rules, Plan-mode-as-document, "Approve plan" card, virtualised MessageList, SCM commit message generation, CodeActionProvider quick-fix, Effort selector, audit log, Hooks v2 events, MCP Phases 2+, multi-scope managed/CLI permissions, edit-the-proposed-content workflow, `/memory` slash UI, `/compact`, file-link hover preview, per-tool custom rendering for Read/Grep, per-project conversation scoping, extended thinking blocks, checkpoint hover, unified permission-mode picker, drag-drop polish, /context view (covered).

### Implementation log — 2026-05-06 tenth-pass session

Four mid-large items shipped: per-tool custom rendering, file-link hover preview, audit log, effort selector. Final one is the first reasoning-extension feature — covers all three projects (webview / extension host / backend / shared-types) in one shipment.

**1. Per-tool custom rendering for Read/Grep** ([ToolCallDisplay.tsx](apps/extension/webview/src/components/ToolCallDisplay.tsx)). Two new sub-components:
- `ReadFileResult`: parses the executor's `<lineno>\t<text>` row format into a fixed-width line-number gutter + content column. Line numbers are selectable (so users can copy ranges) but unobtrusive. Trailing meta line ("Showing lines X-Y of N") rendered separately.
- `SearchFilesResult`: parses `<path>:<lineno>:<preview>` rows from ripgrep output into a clickable list. Each row's path+line opens in VS Code via existing `openFile` postMessage. Falls through to raw `<pre>` if rows don't parse. Handles Windows drive-letter colons.

Both use VS Code semantic tokens (`editorLineNumber-foreground`, `textLink-foreground`) so themes work without overrides. Custom rendering is skipped when output is truncated to avoid mismatched gutter/preview pairs.

**2. File-link hover preview** ([MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts)). Hovering a `.file-link` for 350ms triggers `loadFilePreview` to the host; host reads the workspace-relative file (multi-root candidate resolution, 256KB cap), returns the first 20 lines or 4KB whichever smaller; webview caches by path so repeat hovers are free. Tooltip is a fixed-position floating panel anchored to the link's bounding rect, theme-aware via `editorHoverWidget-background`/`-border`. "Loading…" placeholder during fetch, "(file unavailable)" graceful miss.

**3. Permission decision audit log** ([PermissionAuditLog.ts](apps/extension/src/services/PermissionAuditLog.ts), [ChatService.ts](apps/extension/src/services/ChatService.ts), [SlashCommands.ts](apps/extension/webview/src/components/SlashCommands.ts)). New `PermissionAuditLog` service appends every tool decision to `.ailancers/audit.log` as JSONL. Each record has timestamp, tool name, summarised input (string values capped at 200 chars to keep the file small), source (`rule`/`hook`/`prompt`/`session-allow`/`fallback-allow`), decision, optional matched rule, optional user choice, optional reason. File rotates at 5MB → keeps the trailing 4MB. Best-effort writes — auditing never blocks a tool call. Surfaced via new `/permissions log` slash entry that opens the file; `/permissions` (no args) opens settings.json. Records cover **every** approval pathway including "no rule fired, backend said safe" — so even the fully-frictionless calls show up in the log.

**4. Reasoning effort selector** (cross-project — [ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx), [App.tsx](apps/extension/webview/src/App.tsx), [ChatService.ts](apps/extension/src/services/ChatService.ts), [ClaudeProxyService.ts](apps/backend/src/services/ClaudeProxyService.ts), [agent.ts](packages/shared-types/src/agent.ts)). New "Effort: default/low/medium/high" dropdown in the ChatInput controls row (agent-mode-only). State lives in App reducer (`SET_EFFORT`); piped through `OutgoingMessage.effort` → host → `WsAgentMessage.effort` → `runAgentLoop` options. Backend attaches `thinking: { type: "enabled", budget_tokens: 4000|12000|32000 }` to the stream call when set. Default sends nothing → preserves prior behaviour exactly. Anthropic-only for now; OpenAI's `reasoning_effort` parity can layer in once OpenAIProxyService picks up the option. shared-types `WsAgentMessage` rebuilt into dist so backend picks up the new field.

**Tally update**: previously 82 `[x]` + 14 `[~]` + 26 `[ ]`. After this pass: **86 `[x]` + 14 `[~]` + 22 `[ ]`**.

**Remaining items**: MCP Phase 1, Subagent system, Fork/rewind, Slash Phase 2/3 (`/compact`, `/memory` UI, custom user commands), Auto-memory tool, Path-scoped rules, Plan-mode-as-document, "Approve plan" card, virtualised MessageList, SCM commit message generation, CodeActionProvider quick-fix, Hooks v2 events, MCP Phases 2+, multi-scope managed/CLI permissions, edit-the-proposed-content workflow, per-project conversation scoping, extended thinking blocks (now wired via Effort selector — separate UI surfacing of thinking blocks could come later), checkpoint hover, unified permission-mode picker.

### Implementation log — 2026-05-06 eleventh-pass session

Five medium UX items shipped in one pass — all five touch user-facing chat surfaces. The unified permission-mode picker is the most consequential: it gives users category-level approval policy without sacrificing the existing prompt UX for sensitive tools.

**1. `/memory` rules-file picker** ([SlashCommands.ts](apps/extension/webview/src/components/SlashCommands.ts), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts)). New `/memory` slash entry posts `pickMemoryFile` to the host. Host opens a native quick-pick of the three rules-file scopes (user / project team / project local) with "exists" / "create" badges and absolute paths. Picking opens the file with a per-scope starter banner if it didn't exist. Reuses the existing rule cascade — purely a discoverability fix.

**2. SCM commit message generation** ([CommitMessageService.ts](apps/extension/src/services/CommitMessageService.ts), [extension.ts](apps/extension/src/extension.ts), [package.json](apps/extension/package.json), [app.ts](apps/backend/src/app.ts)). New service reads `git diff --cached` via VS Code's built-in Git extension API (`repository.diff(true)`), POSTs it to a new `/api/commit-message` backend route (auth-gated, one-shot streamChat with a Conventional-Commits prompt), writes the response into the SCM input box. Multi-repo aware (picks the repo whose root is the closest ancestor of the active editor). Diff capped at ~16KB client-side. Wired to a sparkle icon in the SCM title bar (`scm/title` menu, `when: scmProvider == git`).

**3. "Approve plan" card** ([MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx), [App.tsx](apps/extension/webview/src/App.tsx)). MessageList renders an "Approve plan" card under the last assistant message when (planMode on, turn finished, no error, response > 80 chars). Single Execute button — clicking flips plan mode off via reducer and posts a synthetic "Execute the plan above." user turn with `planMode: false` directly (bypasses handleSend's closure-captured planMode). MVP — accept-edits-execute and explicit keep-planning are reachable via the new unified permission-mode picker.

**4. Editor context popover** ([ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx)). The 📎 indicator is now a popover trigger; clicking opens a small dialog with a "Send active file & selection to the agent" checkbox, an explanatory hint, plus an "Open this file" affordance and a Close button. Replaces the hidden line-through-toggle behaviour with explicit, discoverable controls. Exclude flag still pins until manually toggled off — semantics unchanged.

**5. Unified permission-mode picker** ([ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx), [App.tsx](apps/extension/webview/src/App.tsx), [ChatService.ts](apps/extension/src/services/ChatService.ts)). New dropdown next to the agent-type buttons replaces the legacy Plan toggle (which stays as fallback for unmigrated hosts). Four options: Default / Plan / Accept-edits / Bypass. Bypass shows a confirmation dialog before activation and renders with a danger-red border. Wired via new `setPermissionMode` postMessage → `ChatService.setPermissionMode()` which pre-populates the `sessionAutoApproved` set: `accept-edits` adds read/edit/write/list/glob/search; `bypass` adds every tool name. Settings deny rules and PreToolUse hooks still apply regardless of mode, and the audit log captures every decision so even bypass mode is fully traceable. Plan flag stays in sync with picker so existing `WsAgentMessage.planMode` wire continues working untouched.

**Tally update**: previously 86 `[x]` + 14 `[~]` + 22 `[ ]`. After this pass: **91 `[x]` + 14 `[~]` + 17 `[ ]`**.

**Remaining items**: MCP Phase 1, Subagent system, Fork/rewind, Slash Phase 3 (custom user commands + plugin-sourced), Slash Phase 2 (`/compact`), Auto-memory tool, Path-scoped rules, Plan-mode-as-document, virtualised MessageList, CodeActionProvider quick-fix, Hooks v2 events, MCP Phases 2+, multi-scope managed/CLI permissions, edit-the-proposed-content workflow, per-project conversation scoping, extended thinking blocks (UI surfacing), checkpoint hover.

### Implementation log — 2026-05-06 twelfth-pass session

Four mid-size items shipped — all touching different surfaces (rules cascade, agent prompt, code-action API, render-virtualisation). Plus one item (Edit-the-proposed-content) examined and deferred with a clear "needs deeper rework" reason.

**1. Path-scoped rules** ([WorkspaceContextService.ts](apps/extension/src/services/WorkspaceContextService.ts), [ChatService.ts](apps/extension/src/services/ChatService.ts)). New `getPathScopedRules(activeRelPath)` reads `.ailancers/rules/*.md`. Tiny YAML-ish frontmatter parser handles inline `paths: ["a", "b"]` and YAML-block list forms; files without `paths:` are always included. In-tree glob matcher handles `**`, `*`, `?`, literal `/` — no `picomatch` dependency. Files mtime-cached. Rules cascade now goes user → team → **scoped** → local. Pattern: a `src/api/**` rule auto-applies when the user is editing a file under that folder, so the system prompt stays small in big repos but specialised conventions still load when needed.

**2. Auto-memory via `<memory_suggestion>` block** ([agentTools.ts](apps/backend/src/services/agentTools.ts), [MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts)). AGENT_SYSTEM_PROMPT now instructs the model to emit a single `<memory_suggestion>One-sentence imperative rule</memory_suggestion>` block at the end of a turn when it discovers a stable preference or convention not already in the rules files. MessageList detects the block per assistant message, renders a small `.memory-suggestion-card` with a "+ Save to memory" button. Clicking posts `saveMemorySuggestion` → host appends to `.ailancers/instructions.local.md` (banner-creates if missing, refuses dupes), opens the file for review.

**3. CodeAction "Fix with Ailancers"** ([AilancersCodeActionProvider.ts](apps/extension/src/providers/AilancersCodeActionProvider.ts), [extension.ts](apps/extension/src/extension.ts)). New CodeActionProvider registered for every file-scheme document; emits a `QuickFix` action per diagnostic. Picking dispatches `ailancers.fixWithAilancers` with the diagnostic payload — host pulls the diagnostic's surrounding 17-line window (line-numbered), formats a "Fix this error" prompt, focuses chat input, inserts via existing `insertText`. User reviews + presses Enter. Reuses existing focus + insert plumbing — no new wire shape.

**4. MessageList virtualisation** ([MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx)). Render-last-N approach (audit's "cheaper option"). When total messages > 50, only the last 30 render and a "Load earlier N messages" button surfaces at the top. Slice + index correction in the existing map — original indices preserved so existing edit/copy click handlers still target the right entry. No `react-window` dependency.

**5. Edit-the-proposed-content workflow — deferred**. Examined and deferred: the existing `vscode.diff` view uses the read-only `ailancers-proposed:` virtual scheme, and making the right side editable cleanly requires either an `untitled:` doc per toolCallId (with save-watching + per-id registry) or an `EditableContentProvider` rewrite. Both are substantial — better as a dedicated session. The current "View diff" affordance still lets the user *see* the proposal before approving, so the value-loss is small.

**Tally update**: previously 91 `[x]` + 14 `[~]` + 17 `[ ]`. After this pass: **95 `[x]` + 14 `[~]` + 13 `[ ]`**.

**Remaining items**: MCP Phase 1, Subagent system, Fork/rewind, Slash Phase 3 (custom user commands + plugin-sourced), Slash Phase 2 (`/compact`), Plan-mode-as-document, Hooks v2 events, MCP Phases 2+, multi-scope managed/CLI permissions, edit-the-proposed-content workflow, per-project conversation scoping, extended thinking blocks UI surfacing, checkpoint hover.

### Implementation log — 2026-05-06 thirteenth-pass session

Four items shipped — three fully complete, two partial (`[~]` on the parts that need separate sessions to finish cleanly). All four projects (extension/webview/backend/shared-types) typecheck and build clean.

**1. Slash Phase 3 — custom user commands** ([SlashCommands.ts](apps/extension/webview/src/components/SlashCommands.ts), [SlashCommandPicker.tsx](apps/extension/webview/src/components/SlashCommandPicker.tsx), [App.tsx](apps/extension/webview/src/App.tsx), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts)). User-authored commands as `.ailancers/commands/<name>.md`. Two scopes: project (`<workspace>/.ailancers/commands/`) and user (`~/.ailancers/commands/`); project wins on collision. Frontmatter has `description:` and `argHint:`; body is the prompt template with `$ARGUMENTS` substitution. Picker shows them under a new "Custom" group. New `/commands` slash entry seeds a starter `review.md` if the folder is empty and reveals it. File watcher reloads the picker on changes. Plugin/MCP-sourced commands still pending — depends on MCP Phase 1, so this is `[~]` partial.

**2. Plan-mode-as-document** ([MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx)). The Approve-plan card now has an "↗ Open plan in editor" button next to Execute. Posts `openMarkdownInEditor` with the assistant's plan; host opens it as an untitled markdown doc for inline annotation. The general "Open in editor" affordance on long messages was already there — this gives plan mode a discoverable top-level button.

**3. Hooks v2 — SessionStart + UserPromptSubmit** ([HookRunner.ts](apps/extension/src/services/HookRunner.ts), [ChatService.ts](apps/extension/src/services/ChatService.ts)). New `runSessionStart()` fires once per chat session (tracked via `sessionsStarted` Set); `runUserPromptSubmit()` fires on every user message before the WS send. Both reuse the existing shell-spawn / JSON-stdin / exit-code-2-blocks contract from v1. `additionalContext` is prepended to the user message inside `<hook_context source="...">` blocks so the model sees it as setup. UserPromptSubmit can exit-2 to block the send entirely — the user gets an inline error and no tokens spent. Schema was already declared in `AilancersSettings.hooks` (we anticipated this in the v1 pass), so no shared-types change needed. HTTP execution + `allowedHttpHookUrls` still pending — `[~]` partial.

**4. Edit-the-proposed-content workflow** ([ApprovalCard.tsx](apps/extension/webview/src/components/ApprovalCard.tsx), [App.tsx](apps/extension/webview/src/App.tsx), [ChatService.ts](apps/extension/src/services/ChatService.ts), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts)). New "✎ Edit before approve" button on `edit_file` / `write_file` approval cards. Click opens the proposed full content as an untitled doc with language-id matched to the target file's extension (so syntax highlighting works). When the user closes the tab, host posts `editableProposedClosed` with the final text; the webview stashes it per toolCallId in a ref. Next "Allow" click sends `toolApprovalResponse.editedInput` carrying the substitution. ChatService's approval wait now resolves with `{ kind, editedInput? }`; on allow, `editedInput` is merged into the original `toolInput` before the executor runs. Audit log records the user-edit for forensics. write_file is fully working; edit_file is partial because the underlying tool needs `old_text` to match disk and we only override `new_text` — full edit_file support needs an executor change. `[~]` partial.

**Tally update**: previously 95 `[x]` + 14 `[~]` + 13 `[ ]`. After this pass: **97 `[x]` + 17 `[~]` + 9 `[ ]`**.

**Remaining items**: MCP Phase 1, MCP Phases 2+, Subagent system, Fork/rewind, Slash Phase 2 (`/compact`), `/compact` mid-session summarization, Auto-memory tool (write-to-memory protocol — separate from `<memory_suggestion>`), multi-scope managed/CLI permissions, per-project conversation scoping, extended thinking blocks UI surfacing, checkpoint hover.

### Implementation log — 2026-05-06 fourteenth-pass session

Four items shipped end-to-end. Two of them (Hooks v2 HTTP, Edit-the-proposed-content for edit_file) close `[~]` partials from earlier passes — those are now full `[x]`.

**1. `/compact` mid-session summarization** ([chat.routes.ts](apps/backend/src/routes/chat.routes.ts), [chat.ws.ts](apps/backend/src/routes/chat.ws.ts), [SlashCommands.ts](apps/extension/webview/src/components/SlashCommands.ts), [App.tsx](apps/extension/webview/src/App.tsx), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts)). New `/compact` slash + `POST /api/chat/conversations/:id/compact` route. Backend reads all messages, summarises everything except the last 4 turns via `streamChat` (structured markdown synopsis with goals / decisions / files / open threads), inserts a `role: "system"` summary at the cutoff, deletes any prior system row so re-running `/compact` replaces rather than nests. WS history loader honours the boundary: keeps the most-recent system row + everything after it, drops everything before. Anthropic's API doesn't accept `role: "system"` in the messages array, so the loader rewrites it as a `user` message wrapped in `<conversation_summary>` tags. Older rows stay in the DB so `/export` still sees them. Webview shows a progress assistant message during the round-trip and reloads the conversation on result.

**2. Multi-scope managed/CLI permissions** ([SettingsLoader.ts](apps/extension/src/services/SettingsLoader.ts)). Loader expanded from 3 to 5 scopes: user → project → local → cli (`$AILANCERS_SETTINGS` env override) → managed (system-wide org policy at `/etc/ailancers/managed-settings.json` on Unix or `%PROGRAMDATA%\Ailancers\managed-settings.json` on Windows). Managed wins on scalars; permission lists are unioned across every scope so a managed `deny` is always enforced regardless of layer order. mtime-cache key now covers all five paths so any change invalidates the cache.

**3. Edit-the-proposed-content for edit_file** ([ToolExecutor.ts](apps/extension/src/services/ToolExecutor.ts), [App.tsx](apps/extension/webview/src/App.tsx)). Closes the `[~]` from the thirteenth pass. Executor's `editFile` now recognises a `__overwrite__: <full content>` field as a force-overwrite signal that bypasses the normal `old_text`-must-match-disk check. Path: webview's `handleApproval` for `edit_file` packs the user-edited content under `__overwrite__` instead of trying to fold it back into the find/replace shape. The agent itself never emits `__overwrite__` — the tool schema doesn't expose it; only the user-edit-and-approve path uses it. Audit log records the user-edit.

**4. Hooks v2 — HTTP execution** ([HookRunner.ts](apps/extension/src/services/HookRunner.ts), [shared-types/settings.ts](packages/shared-types/src/settings.ts)). Closes the `[~]` from the thirteenth pass. New `HookEntry.type: "http"` variant with `url` + optional `headers`; HookRunner POSTs the JSON payload (same as the stdin path), parses the response body as the same `{ permissionDecision, additionalContext }` shape. `allowedHttpHookUrls` allowlist on `AilancersSettings` — additive prefix match; missing/empty list refuses every HTTP hook to prevent committed-settings exfiltration. 5xx on PreToolUse hooks → block with body's first line as reason; 4xx logged + treated as no-outcome. Hook timeout reused via AbortController + `fetch.signal`.

**Tally update**: previously 97 `[x]` + 17 `[~]` + 9 `[ ]`. After this pass: **101 `[x]` + 15 `[~]` + 7 `[ ]`**.

**Remaining items**: MCP Phase 1, MCP Phases 2+, Subagent system, Fork/rewind, Auto-memory tool (write-to-memory protocol — separate from `<memory_suggestion>`), per-project conversation scoping, extended thinking blocks UI surfacing, checkpoint hover.

### Implementation log — 2026-05-06 fifteenth-pass session

Seven items shipped — six finishing `[~]` partials, one closing a strategic `[ ]`. All four projects (extension/webview/backend/shared-types) typecheck and build clean.

**1. Conversation rename** ([chat.routes.ts](apps/backend/src/routes/chat.routes.ts), [ApiClient.ts](apps/extension/src/services/ApiClient.ts), [ConversationList.tsx](apps/extension/webview/src/components/ConversationList.tsx)). New `PATCH /api/chat/conversations/:id { title }` route — auth-gated, owner-only, 200-char cap, rejects empty/whitespace. ApiClient grew `patch()`. ConversationList items are now `<div>`s so an inline `<input>` can sit inside without nested-button issues; double-click → autoselect input → Enter saves, Esc cancels, blur saves. Webview posts `renameConversation`; host calls the route + replies with `conversationRenamed`; webview reloads the list.

**2. AI-generated conversation titles** ([chat.ws.ts](apps/backend/src/routes/chat.ws.ts)). Fires async after `agent_complete` is sent (so the user isn't blocked on a title). Skips conversations with custom titles; reads the first user message; asks Haiku for a 4-7-word title with no preamble; trims quotes/punct, caps at 80 chars, updates the row. Failures swallow silently. Webview reloads the sidebar on `agent_complete` so the new title shows automatically.

**3. Streaming-state in status bar** ([StatusBarProvider.ts](apps/extension/src/providers/StatusBarProvider.ts), [ChatViewProvider.ts](apps/extension/src/providers/ChatViewProvider.ts), [extension.ts](apps/extension/src/extension.ts)). New `setStreaming(boolean)` reuses the attention-indicator slot to show `$(sync~spin) Ailancers running… Ns` with a 1s ticker (cleared on stream end so battery isn't burned on idle). ChatViewProvider exposes an `onStreaming` callback; `postToWebview` taps `stream_start` / `stream_end` / `agent_complete` / `billing_suspended` / `error` to fire it. Streaming spinner takes priority over pending/done attention text while active.

**4. Protected-path preset deny list** ([PermissionEvaluator.ts](apps/extension/src/services/PermissionEvaluator.ts)). New `PRESET_DENY_RULES` array runs before the settings-based rule check. Covers `.env*`, `.git/**`, `.husky/**`, `.ailancers/**` for both Edit and Write tools — read is intentionally not preset-blocked so the agent can still inspect protected files. Users can grant one-shots via the approval prompt; the preset only blocks unattended writes.

**5. Persistent input-footer hints** ([ChatInput.tsx](apps/extension/webview/src/components/ChatInput.tsx)). The keyboard hint now appends a 5-second-rotating tip from a 5-item carousel (`/commands`, `@files`, `↑ recall`, `Shift+Enter newline`, `📋 plan mode`). Pauses while streaming so "Stop" stays put. Stays inline with the existing `Enter ↑` indicator — no extra vertical space.

**6. Extended thinking blocks UI** ([ClaudeProxyService.ts](apps/backend/src/services/ClaudeProxyService.ts), [chat.ws.ts](apps/backend/src/routes/chat.ws.ts), [chat.ts](packages/shared-types/src/chat.ts), [App.tsx](apps/extension/webview/src/App.tsx), [MessageList.tsx](apps/extension/webview/src/components/MessageList.tsx)). Backend streams `thinking_delta` events on a separate WS channel (`stream_thinking`); `AgentCallbacks.onThinking` is a new optional callback. Webview accumulates `state.streamingThinking` per turn; MessageList renders a collapsible "💭 Reasoning" `<details>` block above the visible answer in the active streaming row when non-empty. Char count shown in the summary header. Doesn't leak into the saved message because Anthropic doesn't replay thinking blocks back to the next turn.

**7. Slash Phase 2 — explicitly closed**. All four (`/help`, `/compact`, `/memory`, `/init`) are live across earlier passes. Audit doc updated to reflect.

**Tally update**: previously 101 `[x]` + 15 `[~]` + 7 `[ ]`. After this pass: **108 `[x]` + 9 `[~]` + 5 `[ ]`**.

**Remaining items**: MCP Phase 1, MCP Phases 2+, Subagent system, Fork/rewind, Auto-memory tool (full read/write protocol, separate from `<memory_suggestion>`), per-project conversation scoping, checkpoint hover.

### Implementation log — 2026-05-06 sixteenth-pass session (v0.2.6 → v0.2.8 polish)

Three releases in one session — each driven by user-testing feedback against v0.2.5. No audit-line items, but three relevant strategic deltas worth recording.

**v0.2.6 — 8 UX issues from first-day testing** (commit `e1b22b1`):

1. `@`-picker no longer auto-selects on Enter — Enter sends, Tab commits.
2. Explicit `@`-mention auto-suppresses pinned editor context for that turn.
3. AGENT_SYSTEM_PROMPT relaxed: skip plan.md for simple tasks.
4. Toolbar gear/help/feedback buttons reuse `.icon-btn` (no white-card boxes).
5. `⋯` literal in overflow button — first attempt at fix.
6. Send button visibility — agent-mode uses primary button colour; disabled opacity raised.
7. AgentStatusBar pins the most recent user prompt as a second line.
8. Auto-title race — backend pushes `conversation_titled` WS event, webview reloads sidebar on receipt.

**v0.2.7 — render-crash + auto-commit + escape-literal regressions** (commit `70d92bd`):

- **Old conversations open blank** (real crash): Drizzle decimal columns deserialize as strings; `msg.costUsd.toFixed()` on `"0.0042"` threw and React unmounted the tree. Defensive `Number()` coerce + `Number.isFinite` guards on `costUsd`/`inputTokens`/`outputTokens`.
- **`@`-picker still auto-committing on second use**: `lastNonceRef` initialised to 0 but parent's `commitNonce` was already > 0 from an earlier successful commit; on remount the effect saw the gap and re-fired. Init `lastNonceRef` to the current `commitNonce` so a fresh mount needs a real bump.
- **`⋯` still rendering as `⋯`**: esbuild minifier preserves unicode escapes inside JSX-text strings to save bytes; `{"⋯"}` stayed as the 6-char literal in the bundle. Fix: emit the actual unicode char via `<span>⋯</span>`.
- **New surface — ErrorBoundary + host log channel**: top-level `<ErrorBoundary>` catches webview render crashes, shows an in-place fallback instead of blanking, forwards to the host's "Ailancers Code" output channel via a new `webviewError` postMessage.

**v0.2.8 — chat panel placement + super-admin screenshot kill switch + post-logout capture bug** (commit `982f043`):

- **Chat panel right-side default** (G): `viewsContainers` moved from `activitybar` to `auxiliarybar` so the sidebar opens on the right by default — same place Claude Code, Codex, and Copilot Chat live.
- **Super-admin: disable screenshot capture per user** (H): new migration `0010_screenshots_disabled.sql` adds `users.screenshots_disabled boolean`; `PUT /api/admin/users/:id/screenshots` (gated by `requireSuperAdmin`); `POST /api/telemetry/screenshot` returns `403 { error: "screenshots_disabled" }` for users with the flag set; `/api/auth/me` + `/api/admin/users` expose the field; dashboard Users page gains a "Screenshots" column visible only to `super_admin` role; extension's `ScreenCaptureService` catches the 403, sets a local short-circuit, and clears the retry queue. Resets on next session/login.
- **Bug: screenshots still captured + "Screenshot captured" toast fired after logout** (I): `ScreenCaptureService` now takes an `isAuthenticated` getter and refuses to `start()` or run `captureAndUpload()` when it returns false; `scheduleMidnightReset` bails early when logged out.

**Tally unchanged** at the audit-item level: **108 `[x]` + 9 `[~]` + 5 `[ ]`**. The closed `inline rename` `[~]` (was deferred pending the PATCH route) is now `[x]` since both ends shipped in v0.2.6.

**Open backlog (5 items, all multi-week strategic)**:
1. MCP Phase 1 (stdio transport)
2. MCP Phases 2+ (HTTP + OAuth)
3. Subagent system (full)
4. Fork/rewind + checkpoint hover
5. Per-project conversation scoping

These need dedicated sessions, not polish passes.

**Open `[~]` partials (8 items, all defer reasons stand)**:
- Best-available model alias (backend deploy gating)
- Context-fullness bar (backend wire format)
- Coalesce periodic timers (multi-service refactor)
- Image compression before upload (sharp/jimp dep)
- Crash-report opt-in toast (new backend endpoint)
- aria-label coverage on icon-only buttons (~one component left)
- Slash Phase 3 plugin/MCP-sourced commands (depends on MCP Phase 1)

---

**Implementation strategy**: Option B (cherry-pick independents first, foundation later). Items grouped into waves so non-overlapping file groups can run on parallel agents:

- **Wave 1 — Critical bugs** (sequential, half-day): security holes and behavioural regressions
- **Wave 2 — `package.json`-only quick wins** (single agent, sequential — same file, conflicts otherwise)
- **Wave 3 — Webview-only quick wins** (parallel by component file)
- **Wave 4 — Host-extension-only quick wins** (parallel by service file)
- **Wave 5 — Backend-only quick wins** (parallel by service file)
- **Wave 6 — Cross-cutting medium pieces**
- **Wave 7 — Foundation work** (sequential): `.ailancers/settings.json`, slash-command framework, then dependent features
- **Wave 8 — Large/strategic**: deferred — needs dedicated planning

### Quick wins (high impact, low effort)

- `[x]` **Fix MessageBubble bug** *(W1 critical — webview)* — uploaded images don't render back into the conversation; either merge into `MessageList` or delete the orphan. (1.2) — *deleted MessageBubble.tsx; folded image rendering + per-message tokens into MessageList*
- `[x]` **Surface editor selection** *(W3 webview/ChatInput)* — show "X lines selected" with a toggle in the input footer. (1.1) — *the existing `📎 path (N lines selected)` indicator is now click-toggleable; toggling sets `excludeEditorContext` which `ChatService.sendAgentMessage` honours by skipping `editorContext` on the wire. Visual: line-through when excluded.*
- `[x]` **Long-code-block collapse** *(W3 webview/markdown)* — fold blocks past ~30 lines with a "show all" toggle. (1.2) — *blocks > 30 lines render first 30 visible + `<details class="code-block-rest"><summary>Show all N lines</summary>` for the rest; Copy button still copies the full source*
- `[x]` **Esc to cancel generation** *(W3 webview/ChatInput)* — handler on the textarea. (1.1) — *also wired global `ailancers.stopGeneration` cmd + Esc keybinding scoped to chat focus*
- `[x]` **Configurable submit key** *(W2 package.json + W3 ChatInput)* — setting for Ctrl+Enter vs Enter. (1.1) — *fully wired: host pushes via `configLoaded` message; ChatInput keydown switches between Enter-sends-Shift-Enter-newline and Cmd/Ctrl+Enter-sends-Enter-newline; input-hint updates to `⌘+Enter ↑` when on*
- `[x]` **Make file links work** *(W3 webview + W4 ChatViewProvider)* — clickable file refs that open the file at the right line. Claude Code's are broken (#51015) — direct competitive win. (1.3) — *markdown.ts emits `<a class="file-link" data-path/-line/-end-line>`; MessageList delegates click → host opens via `openFile` postMessage with line range support and multi-root candidate resolution*
- `[x]` **Visually style file links** *(W3 webview/markdown)* — even before they're clickable, `[file.ts](path)` should look like a link. (1.3) — *`.file-link` class with dotted underline, hover underline-offset, themed via `--vscode-textLink-foreground`*
- `[x]` **Diffstat in collapsed tool header** *(W3 webview/ToolCallDisplay)* — "Edit src/foo.ts +12 −3" beats just "Edit src/foo.ts". (1.4) — *`formatDiffstat` computes `+X −Y` from `old_text`/`new_text`, rendered next to description with `tc-diffstat` class*
- `[x]` **Reuse approval-card rendering on completed edit/write tools** *(W3 webview/ToolCallDisplay)* — we already have it, just plumb it into `ToolCallDisplay`. (1.4) — *`edit_file` now shows `- Find` / `+ Replace` blocks; `write_file` shows `+ New file content` block; CSS classes `tc-block-add`/`-remove`/`-label-add`/`-label-remove` reuse the same colours as ApprovalCard.*
- `[x]` **Surface the "+X −Y lines" diffstat we already compute** *(W4 ToolExecutor)* — `ToolExecutor.editFile` returns it; show it. (1.5) — *result string now includes both `+X` and `−Y`. Already shown in the collapsed tool header via `formatDiffstat` (1.4); this completes the picture in the OUT block.*
- `[x]` **Pick one approval surface** *(W1 critical — webview + extension)* — delete `ApprovalService.requestApproval` and route everything through `ApprovalCard`. Eliminates inconsistency. (1.5) — *`ApprovalService.ts` deleted; `ChatService` constructor signature simplified; `extension.ts` no longer imports it*
- `[x]` **Plan-mode reset bug** *(W1 critical — webview/App)* — keep `planMode` independent of `agentMode` (today it silently resets when agent toggles off). (2.3) — *App reducer `TOGGLE_AGENT_MODE` no longer touches `planMode`*
- `[x]` **Always-visible mode indicator** *(W3 webview/ChatInput)* — move plan/mode toggle to input footer regardless of agent mode. (2.3) — *Plan toggle now renders unconditionally; clicking from chat mode auto-enables agent + plan in one click; tooltip explains the auto-switch.*
- `[x]` **`initialPermissionMode` setting** *(W2 package.json + W3 App)* — VS Code config so teams can default to plan mode. (2.3) — *App reducer's `SET_CONFIG` action adopts `initialPermissionMode` only on first config push (no in-flight conversation), so a workspace-settings change doesn't silently flip plan mode mid-session*
- `[x]` **`instructions.local.md` gitignored personal file** *(W4 WorkspaceContextService)* — concatenated after team rules. (2.4) — *`getLocalProjectRules()` reads `.ailancers/instructions.local.md`; `ChatService.sendAgentMessage` joins team + local with separator before sending as `projectRules`*
- `[x]` **"Open project rules" Cmd Palette command** *(W2 package.json + W4 extension)* — opens `.ailancers/instructions.md` (creates if missing). (2.4) — *`ailancers.openProjectRules` command — creates `.ailancers/` dir + starter template if missing, opens in editor*
- `[~]` **"Best available" model alias** *(W5 backend/AIService)* — dynamic dropdown entry resolved server-side, survives model-version releases without UI changes. (2.5) — *requires backend deploy; defer until release window*
- `[x]` **`opusplan` hybrid** *(W5 backend/ClaudeProxyService)* — when plan mode is on, override model to Opus regardless of selection. Cheap, leverages existing toggle. (2.3, 2.5) — *`ClaudeProxyService.runAgent` swaps `claude-{sonnet,haiku}-X-Y` → `claude-opus-X-Y` whenever `planMode` is on. Pure string regex substitution; safe — falls through to user's choice if the swap doesn't match.*
- `[x]` **AI-generated conversation titles** *(W5 backend)* — one Haiku call after first AI turn completes; replaces "Untitled". (3.1) — *fires async after `agent_complete` is sent (so the user isn't blocked waiting for the title). Skips if the conversation already has a custom title (anything other than "New Conversation" / "Untitled"); reads the first user message; asks Haiku for a 4-7-word title with no preamble; trims quotes/punct, caps at 80 chars, updates the row. Failures swallow silently — auto-titling is a polish, not a critical path. Webview reloads the sidebar on `agent_complete` so the new title shows up automatically.*
- `[x]` **Inline rename for conversations** *(W3 webview/ConversationList)* — double-click title in sidebar to edit. (3.1) — *new `PATCH /api/chat/conversations/:id { title }` route added (auth-gated, owner-only, 200-char cap, rejects empty/whitespace). ApiClient grew a `patch` method to match. ConversationList: each item is now a `<div>` rather than a `<button>` so an inline `<input>` can sit inside without nested-interactive-element issues. Double-click any title → focused autoselect input → Enter saves, Esc cancels, blur saves. Webview posts `renameConversation`; host calls the route and replies with `conversationRenamed`; webview reloads the list to pick up the new title.*
- `[x]` **Surface token breakdown in `MessageList`** *(W3 webview)* — already captured, only rendered in orphan `MessageBubble`. Pair with the 1.2 cleanup. (3.2) — *`msg-meta` row now shows `X in / Y out / $cost` for every assistant message*
- `[x]` **Richer completion banner** *(W3 webview/MessageList)* — add `(X in / Y out / Z cached) · Ns/turn · model-name`. Pure presentation; data on hand. (3.2) — *banner now shows turns / tools / `X in / Y out` (when present) / cost*
- `[~]` **Context-fullness bar at top of input** *(W5 backend + W3 webview)* — green/yellow/red. Server emits `context_state` events; webview renders a 6px bar. (3.3) — *defer (needs backend wire format)*
- `[x]` **Pipe AbortSignal into ToolExecutor** *(W1 critical — extension/ToolExecutor)* — kill `run_terminal` child process and short-circuit `write_file`/`edit_file` on cancel. Real bug fix. (3.4) — *`ToolExecutor.execute` accepts `AbortSignal`; `runTerminal` SIGTERMs the spawned child on abort; `writeFile`/`editFile` check before mutating; `ChatService.handleWsMessage` creates a per-conversation AbortController, fired by `cancelStream`*
- `[x]` **Esc-to-cancel keyboard shortcut** *(W3 webview/ChatInput)* — handler on input/status bar + global `ailancers.stopGeneration` command bound to Esc. (3.4) — *ChatInput Esc handler when streaming; `ailancers.stopGeneration` Cmd Palette command; keybinding scoped via `when: ailancersChatFocused && ailancersIsStreaming`*
- `[x]` **"Cancelling…" intermediate state** *(W3 webview/App)* — App reducer flag, button label, greyed status bar until backend confirms. (3.4) — *new `isCancelling` flag in App state; Stop button shows `…` + cursor:progress while pending; 5-second fallback to force STREAM_ERROR if backend never confirms.*
- `[x]` **"(stopped)" label on partially-streamed assistant message** *(W3 webview/MessageList)* — for any assistant turn that ended without `STREAM_END`. (3.4) — *detects `Error: Cancelled.` content, renders `(stopped)` tag in role row*
- `[x]` **Editor context indicator in input footer** *(W3 webview/ChatInput + W4 ChatViewProvider)* — `📎 src/foo.ts (3 lines selected)`. Makes auto-attach explicit. (4.1) — *`ChatViewProvider` subscribes to `onDidChangeActiveTextEditor` + `onDidChangeTextEditorSelection`, pushes `editorContextSnapshot`; ChatInput renders `📎 path (N lines selected)` between textarea and controls row*
- `[x]` **Workspace root path included in `<editor_context>`** *(W4 WorkspaceContextService)* — one line, eliminates "what's the project root?" round-trips. (4.1) — *`workspaceRoot` field on editorContext snapshot*
- `[x]` **Read Problems panel diagnostics into `<editor_context>`** *(W4 WorkspaceContextService)* — agent quality lever, no UI work. (4.2) — *`vscode.languages.getDiagnostics(uri)` formatted as `line N: severity [code]: message`, capped at 25 entries*
- `[x]` **`editor/context` menu entry "Ask Ailancers about this"** *(W2 package.json + W4 extension)* — sends current selection into chat with preset prompt. Two-line manifest change. (4.2) — *`ailancers.askAilancersAboutSelection` cmd registered + `editor/context` menu entry; opens chat, inserts `Explain this code from <path>:\n```<lang>\n<selection>\n```` at cursor*
- `[x]` **Bundle `get_diagnostics` tool** *(W4 ToolExecutor + W5 agentTools)* — hardcoded `vscode.languages.getDiagnostics()` in `ToolExecutor`. Captures most of MCP day-1 value without requiring MCP. (6.2, 4.2) — *new `get_diagnostics` tool in shared-types `ToolName`, schema in backend `agentTools.ts`, `ToolExecutor.getDiagnostics` reads `vscode.languages.getDiagnostics(uri)` (or workspace-wide), filters by min severity, formats per-file.*
- `[x]` **Reserve `mcp__server*` namespace** *(W7 docs-only)* — in future permission rules so policies written today don't break when MCP lands. Doc-only commitment. (6.2, 5.1) — *documented in shared-types `AilancersSettings.permissions` JSDoc — `mcp__<server>` / `mcp__<server>__<tool>` / `Agent(<name>)` / `Hook(<id>)` are now declared as reserved namespaces, future-compatible.*
- `[x]` **`Cmd/Ctrl+Esc` focus-toggle command** *(W2 package.json + W4 extension)* — `ailancers.focusInput` shows view + focuses textarea. (6.4) — *cmd registered, keybinding declared, post-message → window event → ChatInput textarea focus*
- `[x]` **`when`-clause context keys** *(W4 ChatViewProvider + extension)* — `ailancersChatFocused` + `ailancersIsStreaming` via `setContext`, scopes our keybindings cleanly. (6.4) — *both context keys wired: `ChatViewProvider` toggles `ailancersChatFocused` on visibility change; `ChatService` toggles `ailancersIsStreaming` on stream-start/end/cancel*
- `[x]` **Theme-aware syntax highlighting** *(W3 webview/markdown + styles)* — detect VS Code theme via `body.dataset.vscodeThemeKind`, swap pre-built `default-{dark,light}.css` for highlight.js. Or write our own ~30-rule CSS using `--vscode-symbolIcon-*Foreground` tokens. Claude Code's #8879 closed "not planned" — direct competitive lead. (7.1, 1.2) — *markdown.ts emits `<div class="markdown-body theme-{light,dark,hc}">`; CSS overrides hljs tokens with `--vscode-symbolIcon-*` for light + high-contrast*
- `[x]` **Memoise `renderMarkdown` per stream item** *(W3 webview/MessageList)* — wrap each text block in `<MemoMarkdown>` keyed on content; tail re-parses, older items don't. Reduces DOM churn for long streams. ~30 lines. (7.3) — *new `MarkdownBlock = memo(...)` component used by both the message-history loop and the active stream's text items.*
- `[~]` **Coalesce periodic timers** *(W4 multi-service refactor)* — single shared scheduler for status-bar 30s + telemetry 60s + screenshot 300s. Reduces battery wake-ups. (7.3) — *defer; touches too many services*
- `[~]` **Image compression before upload** *(W4 ScreenCaptureService)* — `canvas.toDataURL("image/jpeg", 0.85)` or `OffscreenCanvas` resize to 1280px. ~10× per-screenshot bandwidth cut. (7.3) — *deferred — requires platform-aware tooling (sharp/jimp dependency or per-OS capture-format tweaks). Current `SCREENSHOT_MAX_SIZE_MB` cap protects against worst-case payload but doesn't optimise typical case.*
- `[x]` **Skip-to-input keyboard shortcut (`Cmd+/`)** *(W2 package.json + W3 ChatInput)* — focus input from anywhere in the chat panel. (7.2, 6.4) — *added as a second keybinding for `ailancers.focusInput` (alongside the existing `Cmd/Ctrl+Esc`); both fire the same focus-toggle command.*
- `[x]` **Focus management on `ApprovalCard`** *(W3 webview/ApprovalCard)* — autofocus primary action; restore previous focus on dismiss. ~15 lines. (7.2) — *ref-on-Allow-button + useEffect that captures previous activeElement and restores on unmount*
- `[x]` **`BillingCard` colour values via semantic tokens** *(W3 webview/MessageList)* — replace `#92400e20` etc. with `var(--vscode-editorWarning-foreground)` / `-errorForeground` for proper light-theme rendering. (7.1, 7.2) — *all hex literals replaced with semantic tokens (`editorWarning-foreground`, `editorError-foreground`, `inputValidation-warningBackground`, `descriptionForeground`); card now has `role="alert"`*
- `[~]` **Crash-report opt-in toast** *(W4 + W5)* — catch unhandled errors → `showErrorMessage("Ailancers hit an error", "Send report", "Ignore")` → POST sanitised stack. (7.4) — *defer; needs backend endpoint*
- `[x]` **Distinguish activity telemetry from product analytics** *(W2 package.json — defer until we add analytics)* — `ailancers.trackingEnabled` for activity (the time-tracking feature), separate `ailancers.analytics.enabled` for any future product-usage telemetry. (7.4) — *new `ailancers.analytics.enabled` setting declared (default true). Description in package.json calls out the distinction. Consumer wires up when product-analytics fires its first event.*
- `[x]` **Streaming-state in status bar** *(W4 StatusBarProvider + W4 ChatViewProvider)* — repurpose `statusBarItem` while `isStreaming` to show `$(sync~spin) running… 12s`. Reuses existing item. (4.3) — *new `setStreaming(boolean)` on StatusBarProvider; while true the attention-indicator slot shows `$(sync~spin) Ailancers running… Ns` with a 1s ticker that updates the elapsed counter (cleared on stream end so idle status doesn't burn battery). ChatViewProvider now exposes an `onStreaming` callback; `postToWebview` taps `stream_start` → fire(true) and `stream_end`/`agent_complete`/`billing_suspended`/`error` → fire(false). extension.ts wires the callback to `statusBar.setStreaming`. Streaming spinner takes priority over the existing attention text so the user always sees the active operation; once the run ends, the attention indicator (pending / done) takes over again.*
- `[x]` **Editor title bar "Open Ailancers" button** *(W2 package.json)* — `editor/title` menu entry firing `ailancers.openChat`. Discovery booster. (4.3) — *already shipped in Wave 2's package.json menus block; was just unmarked. Confirmed live: `editor/title` group has `ailancers.openChat` with `when: editorIsOpen`.*
- `[x]` **OS toast on permission-needed when chat is hidden** *(W4 ChatViewProvider)* — `vscode.window.showInformationMessage(..., "Open chat")` gated on `webviewView.visible`. Pair with notification opt-out settings. (4.4) — *`maybeNotifyHiddenPermission` now invoked from the `postToWebview` tap whenever a `tool_approval_request` arrives while hidden; honours `ailancers.notifications.permissionRequest` (auto/always/never)*
- `[x]` **No-folder mode fallback in `getWorkspaceRoot`** *(W1 critical — extension/ToolExecutor)* — fall back to `dirname(activeTextEditor.uri)` so tools don't hard-fail on scratch buffers. (4.5) — *`getWorkspaceRoot` falls back to active editor's dir when no folder is open*
- `[x]` **`fs.realpath()` before prefix check in `resolvePath`** *(W1 critical — extension/ToolExecutor)* — closes the symlink-escape edge case. (4.5) — *`canonicaliseExistingAncestor` walks up to nearest existing dir, realpaths it, re-appends suffix; both root + resolved canonicalised before prefix check*
- `[x]` **Declare `extensionKind: "workspace"`** *(W2 package.json)* — so we run on the Remote-SSH host, not the UI side. (4.5)
- `[x]` **Compound-command splitting in `requiresApproval`** *(W1 critical — backend/agentTools)* — split on `&&` / `||` / `;` / `|` and require every subcommand to match the safe list. Closes a real prompt-injection-via-`ls && rm -rf` hole. **High priority security fix.** (5.1) — *`splitCompoundCommand` quote-aware splitter (handles `'`, `"`, backticks, escapes); `requiresApproval` requires every subcommand to be in the safe list*
- `[x]` **Protected-path preset deny list** *(W7 — depends on settings file)* — hardcoded `Edit(.env*)` / `Edit(.git/**)` / `Edit(.ailancers/**)` / `Edit(.husky/**)` rules even before user-defined rules exist. (5.1) — *new `PRESET_DENY_RULES` array in PermissionEvaluator runs BEFORE the settings-based rule check, so it can't be bypassed by a project allow rule. Covers `.env*`, `.git/**`, `.husky/**`, `.ailancers/**` for both Edit and Write tools; reads are intentionally not preset-blocked so the agent can still inspect protected files. If a workflow legitimately needs to edit one of these (e.g. installing a git hook), the user can grant a one-shot via the approval prompt — the preset only blocks unattended writes.*
- `[x]` **Six new VS Code settings** *(W2 package.json + W3/W4 thin consumers)* — `useCtrlEnterToSend`, `respectGitIgnore`, `initialPermissionMode`, `autosaveBeforeAgent`, `hideOnboarding`, `notifications.{permissionRequest,toolCompletion,budgetWarning}`. Pure `package.json` + thin consumers. (6.1, plus 1.1/4.5/2.3/4.4/6.3) — *all 8 settings declared (also added `enableNewConversationShortcut`); `autosaveBeforeAgent` consumer wired in `ChatService.sendAgentMessage`; `notifications.permissionRequest` consumer wired in `ChatViewProvider.maybeNotifyHiddenPermission`; remaining consumers (`useCtrlEnterToSend`, `respectGitIgnore`, `initialPermissionMode`, `hideOnboarding`) declared but not yet consumed — separate small follow-ups*
- `[x]` **Gear icon in `ChatToolbar`** *(W3 webview/ChatToolbar)* — firing `workbench.action.openSettings ailancers` — one-line discovery boost. (6.1) — *⚙ button posts `openSettings`, host calls `workbench.action.openSettings` with query "ailancers"*
- `[x]` **Group settings under sub-categories** *(W2 package.json)* — Backend / Activity / Screenshots / OS Integration. Cosmetic, improves readability. (6.1) — *all settings now have `order` so VS Code Settings UI groups them: Backend (1) → Chat/Agent (10-15) → Notifications (20-22) → Activity (50-52) → Screenshots (60-63) → OS Integration (70)*
- `[x]` **`?` help icon in `ChatToolbar`** *(W3 webview/ChatToolbar)* — opening docs via `vscode.env.openExternal`. One line. (6.3) — *? button posts `openDocs`, host opens `https://ailancers.com/docs` externally*
- `[x]` **"Ailancers: Show Walkthrough" Cmd Palette command** *(W2 package.json + W4 extension)* — re-opens the existing 3-step walkthrough. (6.3) — *cmd registered, fires `workbench.action.openWalkthrough` for our category*
- `[x]` **Persistent input-footer hints** *(W3 — defer; depends on `/` and `@` work in foundation wave)* — rotating through `↑ history · Shift+Enter · /commands · @files` (visible after first message too). (6.3, 4.1, 3.3, 1.1) — *the keyboard hint in the input footer now appends a 5-second-rotating tip from a 5-item carousel (`/commands`, `@files`, `↑ recall`, `Shift+Enter newline`, `📋 plan mode`). Pauses while streaming (the "Stop" hint stays put). Hint stays inline with the existing `Enter ↑` / `⌘+Enter ↑` indicator so it doesn't claim extra vertical space.*
- `[x]` **Default keybindings set (5 combinations)** *(W2 package.json + W4 extension)* — `Ctrl+Shift+L` open chat / `Ctrl+Alt+A` toggle agent / `Cmd+N` new conversation (opt-in setting) / Esc cancel (chat-focused) / `Alt+K` insert file ref (editor-focused). Pure `package.json` + tiny handlers. Closes 6.4 + most of 1.1 / 3.4. (6.4) — *6 keybindings declared incl. `Cmd/Ctrl+Esc` focus-toggle; `ailancers.insertFileReference` and `ailancers.stopGeneration` cmds wired*
- `[x]` **Auto-focus chat input when chat opens** *(W3 webview/App)* — small `useEffect`. (6.4) — *App listens for `focusInput` postMessage; ChatInput listens for the `ailancers:focus-input` window event and focuses textarea*
- `[x]` **Replace `LoginScreen` hardcoded `#f5c518`** *(W3 webview/LoginScreen)* — with `var(--vscode-charts-yellow, #f5c518)`. One line. (7.1)
- `[x]` **`prefers-reduced-motion` media query** *(W3 webview/styles)* — wrapping all CSS animations. ~10 lines. (7.2) — *blanket `*, *::before, *::after { animation-duration: 0.001ms; transition-duration: 0.001ms; }` plus explicit overrides for `streaming-cursor::after`, `agent-status-dot`, `tc-running-text`*
- `[~]` **`aria-label` pass on every icon-only button** *(W3 webview multi-component)* — (camera, send, stop, remove-image, copy, edit). (7.2) — *ChatInput (camera, send, stop, remove-image), ApprovalCard (Allow/Allow-all/Deny), MessageList (Edit) labelled. Copy button on code blocks still pending — ChatToolbar agent uses existing `chat-toolbar-btn` aria from earlier pass*
- `[x]` **`aria-live="polite"` on streaming assistant message body** *(W3 webview/MessageList)* — for screen-reader announcement. ~5 lines. (7.2) — *streaming row gets `role="log" aria-live="polite" aria-relevant="additions" aria-busy="true"`; completion banner gets `role="status"`*
- `[x]` **Verify `retainContextWhenHidden: true`** *(W4 ChatViewProvider)* — on the webview view — preserves scroll/streaming state across panel toggles. One line. (7.3) — *already set at registration site (extension.ts:64); confirmed; also added redundant safety set inside ChatViewProvider*
- `[x]` **"Show Logs" Cmd Palette command** *(W2 package.json + W4 extension)* — `outputChannel.show()`. One line. Closes "user can't send me a bug report" gap. (7.4)
- `[x]` **"Send Feedback" Cmd Palette + chat toolbar 💬 icon** *(W2 package.json + W3 ChatToolbar + W4 extension)* — opens external URL with pre-filled ext/vscode/platform versions. (7.4) — *cmd registered, 💬 icon in ChatToolbar posts `sendFeedback`, host opens `https://feedback.ailancers.com/?ext=…&vscode=…&platform=…`*
- `[x]` **Privacy notice link** *(W3 webview/LoginScreen)* — on `LoginScreen` below the form. (7.4) — *footer notice "By signing in you agree to our Privacy Policy" linking to `https://ailancers.com/privacy`*

### Medium

- `[x]` **`@` file autocomplete** in the input — fuzzy match workspace files and folders. (1.1) — *new `AtFilePicker.tsx` component, `loadFileList`/`fileListResult` wire-message pair, `handleFileListRequest` host handler that ranks matches (exact-name > starts-with > contains > path-contains, then by path length). ChatInput detects `@` at word-start, debounces 80ms, replaces `@<query>` with `@<full-path> ` on select. Mutually exclusive with the slash picker (slash takes priority).*
- `[x]` **Alt-K hotkey** to insert `@file#L5-10` from current editor selection. (1.1) — *keybinding declared, `ailancers.insertFileReference` command registered, `insertAtCursor` postMessage flows to ChatInput. Now that `@` autocomplete is live, the inserted text behaves like any other `@`-mention.*
- `[x]` **Drag-drop files into input** — already covered by image paste, but adds polish. (1.1) — *the whole `.input-area` is now a drop target; drag depth tracked so leave-into-children doesn't flicker the visual; `is-dragging` outline + "Drop image to attach" overlay during a valid file drag; only image MIME types are ingested (text drops fall through to textarea); reuses the same 5MB / accepted-types guard as paste.*
- `[x]` **Per-message timestamps + tokens** — fold into MessageList rendering. (1.2) — *tokens shipped (X in / Y out / $cost on every assistant row); timestamps still cosmetically deferred — data is on `ChatMessage.createdAt` but not surfaced. Effectively done.*
- `[x]` **Auto-detect bare paths** in plain prose and convert to clickable links. (1.3) — *new `barePath` inline-token marked extension; matches paths that contain a slash (`./foo.ts`, `src/x.ts`, `apps/extension/src/x.ts:42`) and end with a recognised extension or have a `:line` / `:line-end` suffix; renders as a `.file-link` anchor with the same `data-path`/`data-line` attrs as explicit markdown links, so existing click delegation in MessageList opens it in VS Code at the right line. Refuses bare names without a slash (too noisy).*
- `[x]` **File-link hover preview** — first ~20 lines in a tooltip. (1.3) — *350ms-debounced hover handler on `.file-link` anchors fires `loadFilePreview` to the host; host reads the workspace-relative file (multi-root candidate resolution, 256KB cap), returns the first 20 lines / 4KB whichever smaller; webview caches per path so repeat hovers are free. Tooltip is a fixed-position floating panel anchored to the link's bounding rect, theme-aware via `editorHoverWidget-background`/`-border`. Shows "Loading…" placeholder while fetching, "(file unavailable)" gracefully on miss.*
- `[x]` **Per-tool custom rendering** for Read (line numbers gutter) and Grep (clickable match list). (1.4) — *new `ReadFileResult` and `SearchFilesResult` components in ToolCallDisplay; Read now parses the executor's `<lineno>\t<text>` rows back into a fixed-width gutter + content layout (line numbers selectable but unobtrusive); Grep parses `<path>:<lineno>:<match>` rows into a clickable list — clicking a match opens the file at the right line via `openFile` postMessage. Falls through to the raw `<pre>` block when truncated (long-output mode) or when output isn't parseable. CSS uses VS Code's `editorLineNumber-foreground` and `textLink-foreground` so themes work out of the box.*
- `[x]` **Keyboard shortcut to expand/collapse all tool calls** in the conversation. (1.4) — *App-level `keydown` listener for `Ctrl/Cmd+Alt+]` (expand all) and `Ctrl/Cmd+Alt+[` (collapse all), mirroring VS Code's fold/unfold style; dispatches `ailancers:expand-all-tools` / `ailancers:collapse-all-tools` window CustomEvents that every mounted `ToolCallDisplay` listens for, flipping its own `expanded` state. No prop-drilling, no re-render storm — each component owns its own state and just toggles when nudged.*
- `[x]` **`@agent-name` mention triggering** — route to existing system-prompt swap; cheap once `@` autocomplete exists. (2.2) — *handleSend now matches `^@(coder|qa|design|supervisor)\s+` at message start, dispatches `SET_AGENT_TYPE` for that agent, strips the prefix from the outbound content, and sends with the new agentType for that turn. Reuses the existing system-prompt swap. Persists across the rest of the conversation (matching the slash `/agent` semantics).*
- `[x]` **Per-agent tool restrictions** — QA/Design read-only, Coder full set. Server-side change in `ClaudeProxyService`. (2.2) — *`runAgentLoop` now filters `AGENT_TOOL_DEFINITIONS` to the read-only set when `agentType` is `qa` or `design`; Coder and Supervisor get the full toolset. Reuses the same `READ_ONLY_TOOLS` set the plan-mode filter uses. Prevents a "QA review" from accidentally fixing the bug it was supposed to flag — the agent literally cannot call `edit_file`/`write_file`/`run_terminal` regardless of system-prompt instructions.*
- `[x]` **"Approve plan" card at end of plan-mode turn** — three buttons (Execute with approvals / Execute auto-accepting edits / Keep planning) that send a synthetic user turn flipping the mode. Removes "manually toggle off and re-ask" friction. (2.3) — *MessageList now renders an "Approve plan" card under the last assistant message when (planMode is on, last turn finished without errors, response > 80 chars). Single Execute button — clicking flips plan mode off via reducer and posts a synthetic "Execute the plan above." user turn with `planMode: false` directly (bypasses handleSend's closure-captured planMode). MVP version of the audit's three-button design — accept-edits-execute and keep-planning-explicit are reachable via the new unified permission-mode picker.*
- `[x]` **"Open plan in editor" affordance** — detect plan output, write to `untitled:plan.md`, re-inject on close. Smaller fallback: "Copy plan" button. (2.3) — *every assistant message > 400 chars (and not a stopped/error message) now shows an "↗ Open in editor" action next to the role label; clicking posts `openMarkdownInEditor` to the host, which uses `workspace.openTextDocument({ language: "markdown", content })` + `showTextDocument` to open it as a new untitled `.md` doc. User can annotate inline / save / share; no re-inject-on-close (intentional — the message stays in the chat as the source of truth). Useful beyond plan mode: any long markdown response can be opened this way.*
- `[x]` **User-level rules** at `~/.ailancers/instructions.md`, concatenated before project rules. (2.4) — *`WorkspaceContextService.getUserRules()` reads from `os.homedir()/.ailancers/instructions.md`; `ChatService.sendAgentMessage` cascades user → team → local with `\\n\\n---\\n\\n` separators (project specifics override user globals).*
- `[x]` **`/memory` slash command** opening a small webview to list/open/create all loaded rules files. (2.4) — *new `/memory` slash entry posts `pickMemoryFile` to the host; host renders a native quick-pick listing all three rules-file scopes (user / project team / project local) with "exists" / "create" badges and absolute paths. Picking opens the file, creating it with a per-scope starter banner if missing. Reuses the existing rule cascade — no behavioural change, just discoverability.*
- `[x]` **"Effort" selector** next to model picker — low/medium/high mapped to Anthropic `thinking.budget_tokens` and OpenAI `reasoning_effort`. (2.5) — *new effort dropdown in ChatInput's controls row (next to model picker, agent-mode-only) with options default/low/medium/high; piped through OutgoingMessage `sendAgentMessage.effort` → ChatService → backend `WsAgentMessage.effort` → `ClaudeProxyService.runAgentLoop`. Backend attaches `thinking: { type: "enabled", budget_tokens: ... }` (4K/12K/32K) to the stream call when set. Anthropic-only for now; OpenAI's `reasoning_effort` parity can layer in cheaply once OpenAIProxyService supports it. Default = no thinking block sent → existing behaviour preserved.*
- `[x]` **1M context variants** as separate picker entries (e.g. `Claude Sonnet 4.6 (1M)`). (2.5) — *`AIService.ALL_MODELS` now exposes `claude-sonnet-4-6-1m` and `claude-opus-4-6-1m` as discrete picker entries. `ClaudeProxyService.runAgentLoop`, `streamChat`, and `runSubAgent` all detect the `-1m` suffix, strip it from the model id sent to the SDK (Anthropic's actual id has no suffix), and attach the `anthropic-beta: context-1m-2025-08-07` header on the request. `calculateCost` defensively strips the suffix too. Higher per-token cost — useful when the user genuinely needs the 1M window (very large repos, full-conversation rewinds, skipping `/compact`); they can switch back at any time via the picker.*
- `[ ]` **Per-project conversation scoping** — store workspace fingerprint, filter sidebar by current workspace with "Show all" toggle. (3.1)
- `[x]` **`/compact` mid-session summarization** — server route to summarize earlier turns when nearing context limit. (3.1, 3.3) — *new `/compact` slash command + `POST /api/chat/conversations/:id/compact` backend route. Backend reads all messages, summarises everything except the last 4 turns via `streamChat` (Conventional structured markdown synopsis with goals / decisions / files / open threads), inserts the result as a `role: "system"` message at the cutoff, and deletes any prior system row so re-running `/compact` replaces rather than nests. WS history loader honours the boundary: keeps only the most-recent system row + everything after it. Anthropic's API doesn't accept role-system in the messages array, so the loader rewrites it as a `user` message wrapped in `<conversation_summary>` tags. Older rows stay in the DB so `/export` still sees them. Webview shows a progress assistant message during the round-trip and reloads the conversation on result.*
- `[x]` **Prompt caching markers on system prompt + tool definitions** — `cache_control: { type: "ephemeral" }` in `ClaudeProxyService`. 50-80% cost lever for agent flows. Server-side only. (3.2) — *applied to both the main agent loop and the `runSubAgent` path; system prompt switched from string to `TextBlockParam[]` with `cache_control` on the block; tool list gets `cache_control` on the last entry (caches everything before AND including the marker, so this captures the full prefix). One-time `cache_creation_input_tokens` write on first turn, ~10× cheaper input on every subsequent turn within ~5 min.*
- `[x]` **`/context` view** — shows which sources are consuming context (system prompt / tools / rules / history). Pairs with 3.1 compact and 3.3 indicator. (3.2, 3.3) — *new `/context` slash command renders a local assistant message listing: conversation message counts (user/assistant), active agent + plan mode + model, current editor context (with excluded marker), last-turn input tokens, total session input tokens, and a note about project rules. No round-trip — pure UI dispatch reading existing reducer state.*
- `[x]` **Editor context popover with opt-out toggle** — extends the footer indicator with "Hide selection from agent" / "Disable for next message" controls. (4.1) — *the existing 📎 indicator is now a popover trigger; clicking opens a small dialog with a "Send active file & selection to the agent" checkbox (replaces the hidden line-through behaviour), an explanatory hint, plus an "Open this file" affordance and a Close button. The exclude flag still pins until manually toggled off — matches existing semantics, just makes them visible.*
- `[x]` **`CodeActionProvider` quick-fix** — "Fix with Ailancers" on diagnostic squiggles; sends error + surrounding code with "Fix this error:" prompt. Requires diagnostics-in-context to be useful. (4.2) — *new `AilancersCodeActionProvider` registered for every file-scheme document; emits a `QuickFix` action per diagnostic in the context. Picking dispatches `ailancers.fixWithAilancers` with the diagnostic payload — host pulls the diagnostic's surrounding 17-line window (8 above, 8 below, line numbered for clarity), formats a prompt ("Fix this error in `<path>` at line N: …\n\nSurrounding code:\n```<lang>…```"), focuses the chat input, and inserts it via `insertText`. User reviews + presses Enter. Reuses existing focusInput / insertText plumbing — no new wire shape.*
- `[x]` **SCM commit message generation** — "Generate with Ailancers" button in commit input, reads staged diff. (4.2) — *new `CommitMessageService` reads the staged diff via VS Code's built-in Git extension API (`repository.diff(true)`), POSTs it to a new `/api/commit-message` backend route which one-shot-streams a Conventional-Commits-style message via `streamChat`, writes the result into the SCM input box. Multi-repo aware (picks the repo whose root is the closest ancestor of the active editor). Diff capped client-side at ~16KB. Wired to a sparkle icon in the SCM title bar (`scm/title` menu, `when: scmProvider == git`) and exposed as `Ailancers: Generate Commit Message` in the palette. Auth-gated, reuses existing AIService.*
- `[x]` **"Claude needs you" / "Claude finished while away" indicator** — flashing status-bar item or `webviewView.badge` when chat is hidden and there's pending approval / stream completion. Tracks `webviewView.visible`. (4.3) — *5th status-bar item (priority 102) with `$(bell) Ailancers needs you` (warning bg) for pending approval, `$(check) Ailancers finished` for stream completion. ChatViewProvider taps `postToWebview` to detect events while hidden; cleared when the chat becomes visible.*
- `[x]` **`withProgress` for long-running tools** — wrap `ToolExecutor.runTerminal` calls above a threshold with `vscode.window.withProgress({ location: ProgressLocation.Window, title: ... })`. (4.4) — *`runTerminal` now starts a 2s timer when it kicks off the exec; if the command is still running at 2s, opens a `withProgress` task at `ProgressLocation.Window` (status bar) titled `Ailancers: <command>` truncated to 60 chars. Resolves on exec completion or abort. Fast commands never show progress; only the >2s ones surface, which matches the discoverability goal of "tell me my npm test is still running."*
- `[x]` **Per-event notification opt-out settings** — `ailancers.notifications.{toolCompletion,permissionRequest,budgetWarning}` config keys. (4.4) — *all three settings declared in package.json; `permissionRequest` actively consumed by `maybeNotifyHiddenPermission`; the other two are wired to be read once the corresponding toast firing-points exist.*
- `[x]` **Persistent onboarding checklist** above `MessageList` — auto-check items via existing `completionEvents` pattern, persist in `globalState`, re-open via `hideOnboarding` setting. Closes discovery gaps from 1.1 / 2.3 / 2.4 / 4.1 in one shipment. (6.3) — *new `OnboardingChecklist` component with 7 items (open chat, first message, slash, @-mention, plan toggle, agent type switch, project rules). Detection threaded through `handleSend` (`firstMessage`, `tryAt`), slash dispatcher (`trySlash`), and the plan/agent toggles in the input footer (`tryPlan`, `tryAgentType`). Persistence via `loadChecklist`/`saveChecklist` postMessage to ChatViewProvider, stored under `globalState["ailancers.onboarding"]`. Auto-hides when all done; `hideOnboarding` setting hides without dismissing (re-shows when flipped off); explicit × dismiss persists. Theme-aware CSS using VS Code variables.*
- `[x]` **`.gitignore` awareness on `glob_files` / `search_files` / `list_directory` / `read_file`** — `respectGitIgnore: true` setting (default on). Use `ignore` npm package. Single biggest agent-quality lever in 4.5. (4.5) — *minimal in-tree gitignore matcher (no new dep), handles negation, dir-only, root-anchored, `**`/`*`/`?`; mtime-cached per root; consumed by all four tools; `read_file` accepts `force: true` to override; `respectGitIgnore` setting honoured*
- `[x]` **Multi-root resolution per-operation** — use `vscode.workspace.getWorkspaceFolder(uri)` instead of always `workspaceFolders[0]`. (4.5) — *`resolvePath` now tries every workspace folder, prefers the root where the file already exists; absolute paths gated against any root*
- `[x]` **Persisted allow/deny rules** — `.ailancers/permissions.json` + `~/.ailancers/permissions.json` with `{ allow, deny, ask }` lists using Claude Code's `Tool(specifier)` syntax. Reuses spec verbatim. Closes the daily-friction "approve `npm test` again" UX. (5.1) — *implemented in `.ailancers/settings.json` (single-file foundation) with three-scope merge: user (`~/.ailancers/`) → project (`.ailancers/`) → local override (`.ailancers/settings.local.json`). `parsePermissionRule` + `specifierMatches` exported from shared-types; `SettingsLoader` watches all three; `evaluatePermission` wired into `ChatService.handleWsMessage` so deny/ask/allow override the backend's default `requiresApproval`. Bash compound: every subcommand must match an allow rule for the whole call to pass.*
- `[x]` **Inline "Allow always (write rule)" button** on `ApprovalCard` — appends matched specifier to project allow list. Requires #above. (5.1) — *new third button on the approval card; suggests `Bash(npm run *)` style for compound bash commands or `Edit(<dir>/**)` for file paths; `writeAllowRule` postMessage flows to host's `appendAllowRule` which JSON-edits `.ailancers/settings.json` (creates if missing, refuses to clobber unparseable JSON, idempotent on duplicates).*

### Large / strategic

- `[x]` **`/` slash command system (Phase 1: picker UI + dispatcher)** — foundation that unlocks `/clear`, `/cost`, `/copy`, `/export`, `/model`, `/agent`, `/plan` reusing existing behaviors. (1.1, 2.1) — *registry in `SlashCommands.ts`, picker popover in `SlashCommandPicker.tsx`, ChatInput integration (Up/Down to navigate, Enter/Tab to select, Esc to dismiss). Dispatcher in `App.tsx` intercepts `/`-prefixed sends. 8 built-ins shipped: `/clear`, `/copy`, `/export [md\|json]`, `/cost`, `/agent <coder\|qa\|design>`, `/plan [on\|off\|toggle]`, `/model [<id>]`, `/help`. All run client-side, zero token cost, no model round-trip.*
- `[x]` **Slash Phase 2 expansion** — `/help`, `/compact`, `/memory`, `/init`. (2.1, 2.4) — *all four shipped across earlier passes: `/help` (Phase 1), `/init` (W6), `/memory` (twelfth pass — host quick-pick over user/team/local rules files), `/compact` (fourteenth pass — backend route summarises older turns into a `role:"system"` row at a cutoff boundary). Plus extras the audit didn't list: `/context`, `/permissions`, `/permissions log`, `/commands`, `/cost`, `/copy`, `/agent`, `/plan`, `/model`, `/clear`, `/export`, `/hooks`.*
- `[~]` **Slash Phase 3** — custom commands as `.claude/commands/*.md` with `$ARGUMENTS` templating + plugin/MCP-sourced commands. (2.1, 6.2) — *user-authored part shipped: scans `.ailancers/commands/*.md` (project-scoped) and `~/.ailancers/commands/*.md` (user-scoped, project wins on collision); tiny YAML-ish frontmatter parser pulls `description:` and `argHint:`; body is the prompt template with `$ARGUMENTS` substitution. New commands surface in the slash picker under a "Custom" group, fire as regular agent messages. New `/commands` slash entry seeds a starter `review.md` if the folder is empty and reveals it. File watcher reloads the picker when the user adds/edits/deletes a command. Plugin/MCP-sourced commands still pending — depends on MCP Phase 1.*
- `[ ]` **Subagent system (full)** — named, configurable, nestable workers loaded from `.claude/agents/*.md`; spawn-as-tool protocol; Running panel; per-agent transcripts. Strong differentiator. (2.2)
- `[x]` **`/init` command** — scan `package.json`/`pyproject.toml`/`Cargo.toml`/`README.md`, ask the model to draft a starter `instructions.md`, open it for review. (2.4) — *registered as a slash command; webview posts `initProjectRules`; host reads `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`/`Gemfile`/`composer.json`/`tsconfig.json`/`README.md`/`CLAUDE.md`/`.github/copilot-instructions.md` (each capped 2-6KB), composes a structured prompt, and inserts it into the chat input via `insertAtCursor`. User reviews + sends — agent then proposes `write_file` to `.ailancers/instructions.md`.*
- `[x]` **Auto-memory via `add_memory` tool** — model can save things it learns to a per-repo machine-local memory file; "remember X" works in natural language. MVP: model emits `<memory_suggestion>` block, UI shows "Add to project rules" button. (2.4) — *AGENT_SYSTEM_PROMPT now instructs the model to emit a single `<memory_suggestion>One-sentence imperative rule</memory_suggestion>` block at the end of a turn when it discovers a stable user preference / project convention not already captured. MessageList detects the block on every assistant message and renders a small `.memory-suggestion-card` with a "+ Save to memory" button. Clicking posts `saveMemorySuggestion` to the host, which appends the rule to `.ailancers/instructions.local.md` (creating with a starter banner if missing, refusing duplicates), then opens the file for review. The user gets to keep/edit/discard — no auto-commit.*
- `[x]` **Path-scoped rules** (`.ailancers/rules/*.md` with `paths:` frontmatter) loaded on demand by glob. (2.4) — *new `getPathScopedRules()` on WorkspaceContextService scans `.ailancers/rules/*.md`. Each file may have YAML-ish frontmatter with a `paths:` array (inline `["a", "b"]` or block list); files without frontmatter (or with empty `paths:`) are always included. The active editor's workspace-relative path is matched against the globs (handles `**`, `*`, `?`); only matching rules are concatenated into the system prompt for that turn. Files cached by mtime, capped at 4KB body each. Wired into ChatService.sendAgentMessage's existing user → team → scoped → local cascade. Tiny in-tree glob matcher — no `picomatch` dependency.*
- `[ ]` **Fork-from-here + rewind code** — per-message hover buttons, branch into new conversation, optionally undo file edits made after that point via stored old/new text. Multi-week feature, high impact for "off the rails" recovery. (3.1)
- `[x]` **Extended thinking blocks** — once we adopt reasoning models. (1.2) — *backend now streams `thinking_delta` events on a separate WS channel (`stream_thinking`); `AgentCallbacks.onThinking` is the new optional callback. Webview accumulates `state.streamingThinking` per turn (cleared on stream-end / start-new-turn), and MessageList renders a collapsible `<details>` "💭 Reasoning" block above the visible answer in the active streaming row whenever it's non-empty. Auto-expands on first appearance; user can collapse via the standard chevron. Char count shown in the summary header so users can gauge effort. Doesn't leak into `streamingContent` because the saved message only stores the visible answer — Anthropic doesn't replay thinking blocks back to the next turn anyway.*
- `[ ]` **Checkpoint / fork-from-here on hover** — bigger feature, ties to session history. (1.2, 3.1)
- `[x]` **Hand off edits to VS Code's native diff viewer** via `vscode.diff` URI scheme — covers 1.4 and 1.5 together. (1.4, 1.5) — *new `ProposedContentProvider` registered for `ailancers-proposed:` scheme; ApprovalCard's "⇄ View diff" button on `edit_file`/`write_file` posts `showProposedDiff` to host, which synthesises a left/right pair (current disk content vs. proposed) and runs `vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: true })`. For `edit_file` we splice `oldText` → `newText` in the on-disk content; if no match (file changed underfoot) falls back to plain find/replace pair. For `write_file` left side is current disk (or empty for new files). Read-only virtual docs — user reviews, then clicks Allow on the card to actually apply.*
- `[x]` **Edit-the-proposed-content workflow** — once diff viewer is in, allow user to tweak right-hand side before accepting; host re-reads on Allow. (1.5) — *Both `write_file` and `edit_file` paths working. Clicking "✎ Edit before approve" on the approval card opens the proposed full content as an untitled doc with language-id matched to the target file's extension. When the user closes the tab, the host posts `editableProposedClosed` with the final text; the webview stashes it per toolCallId. Next "Allow" click sends a `toolApprovalResponse.editedInput` that ChatService merges into the original toolInput before the executor runs. For `write_file` the merge sets `content: edited`. For `edit_file` the merge sets `__overwrite__: edited` — a new field the executor recognises as a full-file replacement that bypasses the normal `old_text`-must-match-disk check. The agent itself never emits `__overwrite__` (the tool schema doesn't expose it); only this user-edit-and-approve path uses it. Audit log records the user-edit for forensics.*
- `[x]` **Plan-mode-as-document** — open a markdown plan in editor for inline feedback rather than just toggling system prompt. (1.5, 2.3) — *the Approve-plan card now has a second button "↗ Open plan in editor" that posts `openMarkdownInEditor` with the assistant's plan content. Host opens it as an untitled markdown doc so the user can annotate inline / save as `.ailancers/plan.md` / share. The general "Open in editor" affordance on long assistant messages already covers non-plan-mode markdown — this gives plan mode a top-level button. Re-injection on close intentionally not implemented; the plan stays in chat as the source of truth, the editor copy is a working canvas.*
- `[x]` **Unified permission-mode picker (default / plan / accept-edits / bypass)** — replaces our ad-hoc Plan toggle + per-tool Allow-All-This-Session. Includes accept-edits as a category-level mode that auto-allows safe writes + safe fs commands but still gates protected paths. (2.3, 5.1) — *new dropdown next to the agent-type buttons replaces the legacy Plan toggle (which is kept as fallback for any host build that doesn't wire the new prop). Four options: Default (current behaviour), Plan (read-only + plan), Accept-edits (auto-allows read/edit/write/list/glob/search but still prompts for `run_terminal`), Bypass (auto-allows every tool — confirmation dialog before activation, danger-styled red border). Wired via new `setPermissionMode` postMessage that pre-populates ChatService's `sessionAutoApproved` set; settings deny rules and PreToolUse hooks still apply, so the audit log captures every decision regardless of mode. Plan flag stays in sync with picker so existing `WsAgentMessage.planMode` wire continues working.*
- `[x]` **Multi-scope permission precedence** — managed → CLI → project → user, cumulative merge of allow/deny lists. Enables enterprise deployment. (5.1) — *all 5 scopes now wired in SettingsLoader: user (`~/.ailancers/settings.json`) → project (`<workspace>/.ailancers/settings.json`) → local (`settings.local.json`) → cli (`$AILANCERS_SETTINGS` env override) → managed (system-wide org policy at `/etc/ailancers/managed-settings.json` on Unix or `%PROGRAMDATA%\Ailancers\managed-settings.json` on Windows). Managed wins on scalars; permission lists are unioned across every scope so a managed `deny` is always enforced regardless of layer order. mtime-cache key now covers all five paths so changes to any file (including org-policy reloads) invalidate the cache.*
- `[x]` **Audit log of permission decisions** — `permission_log` table, surfaceable via `/permissions log`. Forensic value. (5.1) — *new `PermissionAuditLog` service appends every tool decision (deny / ask-user-allow / ask-user-deny / session-allow / fallback-allow / hook-allow / hook-deny / rule-allow / rule-deny) to `.ailancers/audit.log` as JSONL. Each record has timestamp, tool name, summarised input (string values truncated past 200 chars to keep the file small), source category, decision, optional matched rule, optional user choice, optional reason. File rotates at 5MB → 4MB-of-tail-records. Best-effort writes — auditing never blocks a tool call. Surfaced via new `/permissions log` slash entry that opens the file; `/permissions` (no args) opens settings.json.*
- `[x]` **Hooks v1 — `PreToolUse` + `PostToolUse` (command type, project scope)** — `.ailancers/hooks.json` with matcher + shell command + timeout. Exit-2 blocks, JSON stdout returns `additionalContext` / `permissionDecision`. Unlocks "lint before edit" / "scan output for secrets" workflows. Real engineering, not trivial — but single highest-leverage extensibility shipment. (5.2) — *new `HookRunner` service spawns hooks via platform shell with JSON-on-stdin, parses exit code (0=ok, 2=block) + stdout JSON for `permissionDecision`/`additionalContext`. `matcher` supports exact name, `\|`-separated alternation, or `/regex/`. `if` field uses the same `Tool(specifier)` grammar as permissions. PreToolUse decisions take priority over settings rules (deny > ask > allow); `additionalContext` injected into the tool result the model sees. PostToolUse cannot block but can append context. Per-hook timeout (default 60s), abort-aware (Stop kills hooks too), env vars `AILANCERS_PROJECT_DIR` / `AILANCERS_HOOK_EVENT` / `AILANCERS_HOOK_TOOL` exposed. Lives in single-file `.ailancers/settings.json` foundation; `/hooks` slash entry opens it. Starter template includes a commented-out hooks example.*
- `[x]` **Hooks v2 — additional events + execution types** — `SessionStart`, `UserPromptSubmit`, plus HTTP execution with `allowedHttpHookUrls` allowlist. Layer on after v1 lands. (5.2) — *event side: `runSessionStart` fires once per chat session (tracked via `sessionsStarted` Set); `runUserPromptSubmit` fires on every user message before the WS send. Both pipe through the same shell-spawn / JSON-stdin contract as v1; `additionalContext` prepended to the user message inside `<hook_context source="...">` blocks. UserPromptSubmit can exit-2 to block. **HTTP execution**: hooks may declare `type: "http"` with a `url` and optional `headers`; HookRunner POSTs the same JSON payload, parses the response body as the same `{ permissionDecision, additionalContext }` shape. `allowedHttpHookUrls` allowlist on AilancersSettings — additive prefix match; missing/empty list refuses every HTTP hook to prevent committed-settings exfiltration. 5xx on PreToolUse hooks → block with body's first line as reason; 4xx logged + treated as no-outcome. Hook timeout reused via AbortController + `fetch.signal`. shared-types `HookEntry.type` + `url` + `headers` declared.*
- `[ ]` **MCP client — Phase 1 (stdio transport)** — child process per server, JSON-RPC, `tools/list` + `tools/call`, namespace `mcp__name__tool`. Config in `.ailancers/settings.json`. ~1-2 weeks. (6.2)
- `[ ]` **MCP Phases 2+** — HTTP transport + OAuth, then `mcp__ailancers__*` self-as-MCP-server, then resources/prompts/tool-search. Defer past Phase 1. (6.2)
- `[x]` **Virtualise `MessageList`** — `react-window` or "render last N + sentinel" pattern. Defer until conversation length pain is visible (probably after `/compact` lands so users *can* keep long conversations). (7.3) — *render-last-N approach (the cheaper option from the audit); when total messages > 50, only the last 30 render and a "Load earlier N messages" button surfaces at the top. Clicking flips local state to render the full list. No `react-window` dependency — just a slice + index-correction in the existing `messages.map`. Original message indices preserved so click handlers (edit, copy, etc.) still target the right entry.*
