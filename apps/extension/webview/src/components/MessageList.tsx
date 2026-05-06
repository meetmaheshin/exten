import { memo, useEffect, useRef, useState } from "react";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ApprovalCard } from "./ApprovalCard";
import type { ChatMessage, PendingApproval, AgentUsage } from "../types";
import type { StreamItem } from "../App";
import { renderMarkdown } from "../utils/markdown";
import { getVsCodeApi } from "../vscodeApi";

/**
 * Extract the inner text of a `<memory_suggestion>...</memory_suggestion>`
 * block from an assistant message. Returns null when there's no block, or
 * when the inner text is too short to be useful. The model is encouraged
 * to emit these (via the agent system prompt) when it learns something
 * stable about the user's preferences or project conventions; the UI
 * surfaces a one-click button to save it to `instructions.local.md`.
 */
function extractMemorySuggestion(content: string): string | null {
  const m = /<memory_suggestion>([\s\S]+?)<\/memory_suggestion>/i.exec(content);
  if (!m) return null;
  const inner = m[1].trim();
  if (inner.length < 8) return null;
  return inner;
}

/** Memoised markdown block — re-renders only when its content prop changes.
 *  Material reduction in DOM churn during long streams: only the streaming
 *  tail item changes per delta, so older items skip the marked.parse() call. */
const MarkdownBlock = memo(function MarkdownBlock({
  content,
  className,
}: { content: string; className?: string }) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
});

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${(s % 60).toString().padStart(2, "0")}` : `${s}s`;
}

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  stream: StreamItem[];
  /** Extended-thinking text accumulated for the current turn. Rendered in
   *  a collapsible "Reasoning" block above the visible answer when
   *  non-empty. Cleared by the App reducer on stream end. */
  streamingThinking?: string;
  pendingApprovals?: PendingApproval[];
  onApprovalDecision?: (id: string, d: "allow" | "allowAll" | "deny") => void;
  agentUsage?: AgentUsage | null;
  /** Pull a user message back into the input for editing */
  onEditMessage?: (content: string) => void;
  /** True when the user is in plan mode AND the last assistant message
   *  finished without errors. When true, MessageList renders an
   *  "Approve plan" card under the last assistant message. */
  planMode?: boolean;
  /** Fired when the user clicks "Execute" — App turns plan mode off and
   *  sends a synthetic "Execute the plan above." user turn. */
  onApprovePlan?: () => void;
}

export function MessageList({ messages, isStreaming, stream, streamingThinking, pendingApprovals = [], onApprovalDecision, agentUsage, onEditMessage, planMode = false, onApprovePlan }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stuckToBottom, setStuckToBottom] = useState(true);
  /** When true, render every historical message; otherwise virtualise to the
   *  last 30 once the total exceeds 50. Stays sticky across conversation
   *  switches — fine; user can dismiss by clicking the button again. */
  const [showAllMessages, setShowAllMessages] = useState(false);
  const t0 = useRef(0);

  useEffect(() => {
    if (isStreaming) { t0.current = Date.now(); setElapsed(0); const i = setInterval(() => setElapsed(Math.floor((Date.now() - t0.current) / 1000)), 1000); return () => clearInterval(i); }
    setElapsed(0);
  }, [isStreaming]);

  // Auto-scroll only when user is already at the bottom — respects manual scrollback
  useEffect(() => {
    if (stuckToBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, stream.length, isStreaming, agentUsage, stuckToBottom]);

  // Detect whether the user has scrolled away from the bottom
  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    const slack = 60; // px tolerance — counts as "at bottom" if within this much
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
    setStuckToBottom(atBottom);
  }

  // Delegate clicks on `<a class="file-link">` (rendered by markdown.ts) to the
  // host extension. The host opens the file at the right line. Claude Code's
  // file links are publicly broken — this is a measurable competitive lead.
  //
  // Hover preview: same delegation, but on `mouseover`/`mouseout`. Asks the
  // host for the first ~20 lines of the file and renders a floating tooltip
  // anchored to the link. Cache by path so revisiting is free.
  const previewCache = useRef<Map<string, string | null>>(new Map());
  const [hoverPreview, setHoverPreview] = useState<{ path: string; content: string | null; x: number; y: number } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onClick(e: Event) {
      const target = e.target as HTMLElement | null;
      const link = target?.closest("a.file-link") as HTMLAnchorElement | null;
      if (!link) return;
      e.preventDefault();
      const path = link.dataset.path;
      if (!path) return;
      const line = link.dataset.line ? parseInt(link.dataset.line, 10) : undefined;
      const endLine = link.dataset.endLine ? parseInt(link.dataset.endLine, 10) : undefined;
      getVsCodeApi().postMessage({ type: "openFile", path, line, endLine });
    }
    function onMouseOver(e: Event) {
      const target = e.target as HTMLElement | null;
      const link = target?.closest("a.file-link") as HTMLAnchorElement | null;
      if (!link) return;
      const path = link.dataset.path;
      if (!path) return;
      // Debounce — only fetch/show after 350ms of stable hover so flick-throughs
      // don't spam the host.
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = window.setTimeout(() => {
        const rect = link.getBoundingClientRect();
        const cached = previewCache.current.get(path);
        if (cached !== undefined) {
          setHoverPreview({ path, content: cached, x: rect.left, y: rect.bottom + 4 });
        } else {
          // Show a "loading" placeholder while the host fetches.
          setHoverPreview({ path, content: null, x: rect.left, y: rect.bottom + 4 });
          getVsCodeApi().postMessage({ type: "loadFilePreview", path });
        }
      }, 350);
    }
    function onMouseOut(e: Event) {
      const target = e.target as HTMLElement | null;
      const link = target?.closest("a.file-link") as HTMLAnchorElement | null;
      if (!link) return;
      // Hide on leave, but keep the cache.
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoverPreview(null);
    }
    function onPreview(e: MessageEvent) {
      const data = e.data;
      if (!data || data.type !== "filePreview") return;
      previewCache.current.set(data.path, data.content);
      setHoverPreview((prev) =>
        prev && prev.path === data.path ? { ...prev, content: data.content } : prev,
      );
    }
    el.addEventListener("click", onClick);
    el.addEventListener("mouseover", onMouseOver);
    el.addEventListener("mouseout", onMouseOut);
    window.addEventListener("message", onPreview);
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("mouseover", onMouseOver);
      el.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("message", onPreview);
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  function jumpToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // Empty state
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="messages-container">
        <div className="empty-state">
          <div className="empty-state-icon">✨</div>
          <div className="empty-state-text" style={{ marginBottom: 12, fontWeight: 600 }}>Start a conversation</div>
          <div style={{ fontSize: 12, color: "var(--vscode-descriptionForeground, #888)", lineHeight: 1.6, maxWidth: 320 }}>
            <div style={{ marginBottom: 8 }}>Try one of these:</div>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              <li><strong>⚡ Agent + Code</strong> — "Add a logout button to the header"</li>
              <li><strong>📋 Plan</strong> — investigate first, propose changes for review</li>
              <li><strong>🔍 QA</strong> — find bugs in the file you have open</li>
              <li><strong>🎨 Design</strong> — review the UI you're building</li>
            </ul>
            <div style={{ marginTop: 10, fontSize: 11 }}>Press <kbd>↑</kbd> to recall a previous message · <kbd>Shift+Enter</kbd> for newline</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-container" ref={containerRef} onScroll={onScroll}>
      {hoverPreview && (
        <div
          className="file-link-preview"
          style={{ left: hoverPreview.x, top: hoverPreview.y }}
          role="tooltip"
        >
          <div className="file-link-preview-path">{hoverPreview.path}</div>
          {hoverPreview.content === null ? (
            <div className="file-link-preview-loading">Loading…</div>
          ) : hoverPreview.content === "" ? (
            <div className="file-link-preview-empty">(file unavailable)</div>
          ) : (
            <pre className="file-link-preview-pre">{hoverPreview.content}</pre>
          )}
        </div>
      )}
      {/* ── Render-last-N virtualisation ──
           Cheap version of `react-window`. When the conversation gets long,
           render only the trailing 30 messages and surface a "Load earlier"
           button. Avoids re-parsing markdown for messages the user can't
           see anyway. The slice happens inline so the existing map JSX
           stays unchanged. */}
      {!showAllMessages && messages.length > 50 && (
        <button
          type="button"
          className="virtualise-toggle"
          onClick={() => setShowAllMessages(true)}
          title={`The first ${messages.length - 30} messages are hidden to keep this view fast.`}
        >
          ↑ Load earlier {messages.length - 30} message{messages.length - 30 === 1 ? "" : "s"}
        </button>
      )}
      {/* ── History ── */}
      {(showAllMessages || messages.length <= 50
        ? messages.map((m, i) => ({ m, i }))
        : messages.slice(messages.length - 30).map((m, i) => ({ m, i: i + messages.length - 30 }))
      ).map(({ m: msg, i }) => {
        // For user messages, strip the auto-injected <editor_context> block when
        // showing it back to the user — they don't need to re-read the IDE state.
        let displayContent = msg.content;
        if (msg.role === "user" && displayContent.startsWith("<editor_context>")) {
          const end = displayContent.indexOf("</editor_context>");
          if (end !== -1) displayContent = displayContent.slice(end + "</editor_context>".length).trim();
        }
        // Detect a turn that was stopped by the user mid-stream — App reducer
        // emits "Error: Cancelled." via STREAM_ERROR on the cancel path.
        const wasStopped = msg.role === "assistant" && displayContent.trim() === "Error: Cancelled.";
        return (
        <div key={msg.id ?? `m${i}`} className={`msg-row ${msg.role === "user" ? "msg-user" : "msg-assistant"}`}>
          <div className="msg-role">
            {msg.role === "user" ? "YOU" : "AI"}
            {wasStopped && <span className="msg-stopped-tag" aria-label="Stopped by user"> (stopped)</span>}
            {msg.role === "user" && onEditMessage && (
              <button
                className="msg-edit-btn"
                onClick={() => onEditMessage(displayContent)}
                title="Edit & resend this message"
                aria-label="Edit and resend this message"
              >
                ✎ Edit
              </button>
            )}
            {msg.role === "assistant" && displayContent && displayContent.length > 400 && !wasStopped && (
              <button
                className="msg-edit-btn"
                onClick={() => {
                  // Hand the markdown off to the host, which opens it as
                  // a new untitled `.md` document. Useful for plan-mode
                  // outputs that the user wants to annotate inline.
                  getVsCodeApi().postMessage({
                    type: "openMarkdownInEditor",
                    content: displayContent,
                    suggestedName: "ailancers-plan.md",
                  });
                }}
                title="Open this response as a new markdown document for inline annotation"
                aria-label="Open in editor"
              >
                ↗ Open in editor
              </button>
            )}
          </div>
          {/* Render images attached to user messages — was previously
              dropped because MessageList ignored msg.images */}
          {msg.images && msg.images.length > 0 && (
            <div className="message-images">
              {msg.images.map((img, ii) => (
                <img key={ii} src={`data:${img.mediaType};base64,${img.data}`} alt="Attached" />
              ))}
            </div>
          )}
          {msg.role === "assistant" && msg.toolCalls?.map((tc) => (
            <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
          ))}
          {displayContent && displayContent.startsWith("Error: __BILLING__") ? (
            <BillingCard message={displayContent} />
          ) : displayContent ? (
            <MarkdownBlock className="msg-content" content={displayContent} />
          ) : null}
          {msg.role === "assistant" && extractMemorySuggestion(displayContent) && (
            (() => {
              const suggestion = extractMemorySuggestion(displayContent)!;
              return (
                <div className="memory-suggestion-card" role="region" aria-label="Memory suggestion">
                  <div className="memory-suggestion-icon">💡</div>
                  <div className="memory-suggestion-body">
                    <div className="memory-suggestion-title">Add to memory?</div>
                    <div className="memory-suggestion-quote">{suggestion}</div>
                  </div>
                  <button
                    type="button"
                    className="memory-suggestion-btn"
                    onClick={() => {
                      getVsCodeApi().postMessage({
                        type: "saveMemorySuggestion",
                        suggestion,
                      });
                    }}
                    title="Append this suggestion to .ailancers/instructions.local.md (your gitignored personal rules) and open the file."
                  >
                    + Save to memory
                  </button>
                </div>
              );
            })()
          )}
          {msg.role === "assistant" && (msg.inputTokens != null || msg.outputTokens != null || (msg.costUsd != null && msg.costUsd > 0)) && (
            <div className="msg-meta">
              {msg.inputTokens != null && <span>{msg.inputTokens.toLocaleString()} in</span>}
              {msg.outputTokens != null && <span>{msg.outputTokens.toLocaleString()} out</span>}
              {msg.costUsd != null && msg.costUsd > 0 && <span>${msg.costUsd.toFixed(4)}</span>}
            </div>
          )}
        </div>
      );
      })}

      {/* ── Approve plan card ──
           Renders under the last assistant message when:
             • plan mode is on
             • we're not currently streaming (turn finished)
             • the last message is an assistant message that didn't error
             • the response was substantial (not just an early cancel)
           Two buttons:
             • Execute → App turns plan mode off + posts "Execute the plan above."
             • Keep planning → no-op, dismiss the card by editing-away */ }
      {(() => {
        if (!planMode || isStreaming) return null;
        if (!onApprovePlan) return null;
        const last = messages[messages.length - 1];
        if (!last || last.role !== "assistant") return null;
        const text = (last.content ?? "").trim();
        if (!text || text.startsWith("Error:") || text.length < 80) return null;
        return (
          <div className="approve-plan-card" role="region" aria-label="Plan ready for review">
            <div className="approve-plan-icon">📋</div>
            <div className="approve-plan-body">
              <div className="approve-plan-title">Plan ready</div>
              <div className="approve-plan-hint">
                Review the plan above. Execute will turn off plan mode and ask the agent
                to proceed with approvals as usual.
              </div>
            </div>
            <div className="approve-plan-actions">
              <button
                type="button"
                className="approve-plan-btn"
                onClick={() => {
                  // Hand the plan content to the host as a new untitled
                  // markdown doc. The user can annotate inline, save it as
                  // `.ailancers/plan.md` (or anywhere), and re-paste edited
                  // versions into chat. Independent of the Execute path.
                  getVsCodeApi().postMessage({
                    type: "openMarkdownInEditor",
                    content: last.content ?? "",
                    suggestedName: "ailancers-plan.md",
                  });
                }}
                title="Open the plan in a new markdown editor for inline annotation"
              >
                ↗ Open plan in editor
              </button>
              <button
                type="button"
                className="approve-plan-btn approve-plan-btn-primary"
                onClick={onApprovePlan}
                title="Turn off plan mode and execute the plan above"
              >
                ▶ Execute
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Active stream: one continuous AI block ── */}
      {isStreaming && (
        <div
          className="msg-row msg-assistant msg-streaming"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-busy="true"
        >
          <div className="msg-role">AI {elapsed > 0 && <span className="msg-elapsed">{formatElapsed(elapsed)}</span>}</div>

          {streamingThinking && streamingThinking.length > 0 && (
            <details className="thinking-block" open>
              <summary>
                <span className="thinking-icon">💭</span>
                <span className="thinking-label">Reasoning</span>
                <span className="thinking-meta">{streamingThinking.length.toLocaleString()} chars</span>
              </summary>
              <pre className="thinking-content">{streamingThinking}</pre>
            </details>
          )}

          {stream.map((item, idx) => {
            if (item.kind === "text") {
              const isLast = idx === stream.length - 1;
              return (
                <MarkdownBlock
                  key={`t${idx}`}
                  className={`msg-content${isLast ? " streaming-cursor" : ""}`}
                  content={item.content}
                />
              );
            }
            if (item.kind === "tool") {
              const approval = pendingApprovals.find((a) => a.toolCallId === item.data.toolCallId);
              return (
                <div key={item.data.toolCallId} className="msg-inline-tool">
                  <ToolCallDisplay toolCall={item.data} autoExpand={item.data.status === "running"} />
                  {approval && <ApprovalCard approval={approval} onDecision={onApprovalDecision || (() => {})} />}
                </div>
              );
            }
            if (item.kind === "approval") {
              // Only render orphan approvals (not already under a tool)
              if (stream.some((s) => s.kind === "tool" && s.data.toolCallId === item.data.toolCallId)) return null;
              return <ApprovalCard key={`a${item.data.toolCallId}`} approval={item.data} onDecision={onApprovalDecision || (() => {})} />;
            }
            return null;
          })}

          {stream.length === 0 && <div className="msg-content streaming-cursor">Thinking...</div>}
        </div>
      )}

      {/* ── Done ── */}
      {!isStreaming && agentUsage && (
        <div className="agent-complete-banner" role="status">
          <span className="done-check">&#10003;</span>
          Completed &middot; {agentUsage.turnCount} turns &middot; {agentUsage.toolCallCount} tools
          {agentUsage.inputTokens != null && agentUsage.outputTokens != null && (
            <> &middot; {agentUsage.inputTokens.toLocaleString()} in / {agentUsage.outputTokens.toLocaleString()} out</>
          )}
          &middot; ${agentUsage.costUsd.toFixed(4)}
        </div>
      )}

      <div ref={bottomRef} />
      {!stuckToBottom && (
        <button
          className="jump-to-bottom-btn"
          onClick={jumpToBottom}
          title="Jump to latest"
        >
          ↓ New
        </button>
      )}
    </div>
  );
}

function BillingCard({ message }: { message: string }) {
  // Parse: "Error: __BILLING__SUSPENDED__actual message" or "Error: __BILLING__CAP_REACHED__message"
  const match = message.match(/__BILLING__(SUSPENDED|CAP_REACHED)__(.+)/);
  const reason = match?.[1] || "SUSPENDED";
  const text = match?.[2] || "AI usage is suspended.";
  const isCap = reason === "CAP_REACHED";

  // Use VS Code's semantic warning/error tokens so the card renders correctly
  // in light + high-contrast themes too (was previously hex with 0x20 alpha
  // overlays that fell below WCAG AA in light theme).
  const accent = isCap
    ? "var(--vscode-editorWarning-foreground, #f59e0b)"
    : "var(--vscode-editorError-foreground, #ef4444)";
  const accentBg = isCap
    ? "var(--vscode-inputValidation-warningBackground, rgba(146, 64, 14, 0.2))"
    : "var(--vscode-inputValidation-errorBackground, rgba(127, 29, 29, 0.2))";

  return (
    <div role="alert" style={{
      background: accentBg,
      border: `1px solid ${accent}`,
      borderRadius: 8,
      padding: 16,
      margin: "8px 0",
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: accent }}>
        {isCap ? "⚠️ Daily Cap Reached" : "🚫 Insufficient Balance"}
      </div>
      <div style={{ fontSize: 13, color: "var(--vscode-foreground)", marginBottom: 12, lineHeight: 1.5 }}>
        {text}
      </div>
      <div style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", marginBottom: 12 }}>
        {isCap
          ? "Your daily AI usage limit has been reached. It will reset tomorrow, or ask your admin to increase the cap."
          : "Your wallet balance is empty. Top up your wallet on the Ailancers platform to continue using AI features."}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <a
          href="https://staging-backend.ailancers.com"
          target="_blank"
          rel="noopener"
          style={{
            padding: "8px 16px",
            background: accent,
            color: "var(--vscode-button-foreground, #fff)",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          {isCap ? "View Usage" : "Top Up Wallet"}
        </a>
        <div style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>
          After recharging, just send a new message — it will work automatically.
        </div>
      </div>
    </div>
  );
}
