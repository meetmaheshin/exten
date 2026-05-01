import { useEffect, useRef, useState } from "react";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ApprovalCard } from "./ApprovalCard";
import type { ChatMessage, PendingApproval, AgentUsage } from "../types";
import type { StreamItem } from "../App";
import { renderMarkdown } from "../utils/markdown";

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${(s % 60).toString().padStart(2, "0")}` : `${s}s`;
}

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  stream: StreamItem[];
  pendingApprovals?: PendingApproval[];
  onApprovalDecision?: (id: string, d: "allow" | "allowAll" | "deny") => void;
  agentUsage?: AgentUsage | null;
  /** Pull a user message back into the input for editing */
  onEditMessage?: (content: string) => void;
}

export function MessageList({ messages, isStreaming, stream, pendingApprovals = [], onApprovalDecision, agentUsage, onEditMessage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stuckToBottom, setStuckToBottom] = useState(true);
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
      {/* ── History ── */}
      {messages.map((msg, i) => {
        // For user messages, strip the auto-injected <editor_context> block when
        // showing it back to the user — they don't need to re-read the IDE state.
        let displayContent = msg.content;
        if (msg.role === "user" && displayContent.startsWith("<editor_context>")) {
          const end = displayContent.indexOf("</editor_context>");
          if (end !== -1) displayContent = displayContent.slice(end + "</editor_context>".length).trim();
        }
        return (
        <div key={msg.id ?? `m${i}`} className={`msg-row ${msg.role === "user" ? "msg-user" : "msg-assistant"}`}>
          <div className="msg-role">
            {msg.role === "user" ? "YOU" : "AI"}
            {msg.role === "user" && onEditMessage && (
              <button
                className="msg-edit-btn"
                onClick={() => onEditMessage(displayContent)}
                title="Edit & resend this message"
              >
                ✎ Edit
              </button>
            )}
          </div>
          {msg.role === "assistant" && msg.toolCalls?.map((tc) => (
            <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
          ))}
          {displayContent && displayContent.startsWith("Error: __BILLING__") ? (
            <BillingCard message={displayContent} />
          ) : displayContent ? (
            <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(displayContent) }} />
          ) : null}
          {msg.costUsd != null && msg.costUsd > 0 && <div className="msg-meta">${msg.costUsd.toFixed(4)}</div>}
        </div>
      );
      })}

      {/* ── Active stream: one continuous AI block ── */}
      {isStreaming && (
        <div className="msg-row msg-assistant msg-streaming">
          <div className="msg-role">AI {elapsed > 0 && <span className="msg-elapsed">{formatElapsed(elapsed)}</span>}</div>

          {stream.map((item, idx) => {
            if (item.kind === "text") {
              const isLast = idx === stream.length - 1;
              return <div key={`t${idx}`} className={`msg-content${isLast ? " streaming-cursor" : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.content) }} />;
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
        <div className="agent-complete-banner">
          <span className="done-check">&#10003;</span>
          Completed &middot; {agentUsage.turnCount} turns &middot; {agentUsage.toolCallCount} tools &middot; ${agentUsage.costUsd.toFixed(4)}
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

  return (
    <div style={{
      background: isCap ? "#92400e20" : "#7f1d1d20",
      border: `1px solid ${isCap ? "#f59e0b" : "#ef4444"}`,
      borderRadius: 8,
      padding: 16,
      margin: "8px 0",
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: isCap ? "#f59e0b" : "#ef4444" }}>
        {isCap ? "⚠️ Daily Cap Reached" : "🚫 Insufficient Balance"}
      </div>
      <div style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 12, lineHeight: 1.5 }}>
        {text}
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
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
            background: isCap ? "#f59e0b" : "#ef4444",
            color: "#fff",
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
