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
}

export function MessageList({ messages, isStreaming, stream, pendingApprovals = [], onApprovalDecision, agentUsage }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const t0 = useRef(0);

  useEffect(() => {
    if (isStreaming) { t0.current = Date.now(); setElapsed(0); const i = setInterval(() => setElapsed(Math.floor((Date.now() - t0.current) / 1000)), 1000); return () => clearInterval(i); }
    setElapsed(0);
  }, [isStreaming]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, stream.length, isStreaming, agentUsage]);

  // Empty state
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="messages-container">
        <div className="empty-state">
          <div className="empty-state-icon">&#9997;</div>
          <div className="empty-state-text">Send a message to start your conversation with AI.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-container">
      {/* ── History ── */}
      {messages.map((msg, i) => (
        <div key={msg.id ?? `m${i}`} className={`msg-row ${msg.role === "user" ? "msg-user" : "msg-assistant"}`}>
          <div className="msg-role">{msg.role === "user" ? "YOU" : "AI"}</div>
          {msg.role === "assistant" && msg.toolCalls?.map((tc) => (
            <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
          ))}
          {msg.content && <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />}
          {msg.costUsd != null && msg.costUsd > 0 && <div className="msg-meta">${msg.costUsd.toFixed(4)}</div>}
        </div>
      ))}

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
    </div>
  );
}
