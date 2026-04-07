import { useEffect, useRef, useState } from "react";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ApprovalCard } from "./ApprovalCard";
import type { ChatMessage, PendingApproval, AgentUsage } from "../types";
import type { StreamEvent } from "../App";
import { renderMarkdown } from "../utils/markdown";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamTimeline: StreamEvent[];
  pendingApprovals?: PendingApproval[];
  onApprovalDecision?: (toolCallId: string, decision: "allow" | "allowAll" | "deny") => void;
  agentUsage?: AgentUsage | null;
}

export function MessageList({
  messages,
  isStreaming,
  streamTimeline,
  pendingApprovals = [],
  onApprovalDecision,
  agentUsage,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const streamStartRef = useRef<number>(0);

  useEffect(() => {
    if (isStreaming) {
      streamStartRef.current = Date.now();
      setElapsed(0);
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - streamStartRef.current) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
    setElapsed(0);
  }, [isStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamTimeline.length, pendingApprovals.length, agentUsage, isStreaming]);

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
      {/* ── History messages ── */}
      {messages.map((msg, i) => (
        <div key={msg.id ?? `msg-${i}`} className={`msg-row ${msg.role === "user" ? "msg-user" : "msg-assistant"}`}>
          <div className="msg-role">{msg.role === "user" ? "YOU" : "AI"}</div>

          {/* For saved assistant messages: render tool calls inline before text */}
          {msg.role === "assistant" && msg.toolCalls && msg.toolCalls.map((tc) => (
            <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
          ))}

          {msg.content && (
            <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
          )}

          {msg.costUsd != null && msg.costUsd > 0 && (
            <div className="msg-meta">${msg.costUsd.toFixed(4)}</div>
          )}
        </div>
      ))}

      {/* ── Active streaming: SINGLE continuous block from timeline ── */}
      {isStreaming && (
        <div className="msg-row msg-assistant msg-streaming">
          <div className="msg-role">
            AI
            {elapsed > 0 && <span className="msg-elapsed">{formatElapsed(elapsed)}</span>}
          </div>

          {/* Render timeline events in chronological order */}
          {streamTimeline.map((event, idx) => {
            if (event.kind === "text") {
              const isLast = idx === streamTimeline.length - 1;
              return (
                <div
                  key={`text-${idx}`}
                  className={`msg-content ${isLast ? "streaming-cursor" : ""}`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(event.content) }}
                />
              );
            }

            if (event.kind === "tool") {
              // Check if there's a pending approval for this tool
              const approval = pendingApprovals.find((a) => a.toolCallId === event.data.toolCallId);
              return (
                <div key={event.data.toolCallId}>
                  <ToolCallDisplay
                    toolCall={event.data}
                    autoExpand={event.data.status === "running" || event.data.status === "pending"}
                  />
                  {approval && (
                    <ApprovalCard
                      approval={approval}
                      onDecision={onApprovalDecision || (() => {})}
                    />
                  )}
                </div>
              );
            }

            if (event.kind === "approval") {
              // Only render if not already rendered under its tool call
              const hasToolInTimeline = streamTimeline.some(
                (e) => e.kind === "tool" && e.data.toolCallId === event.data.toolCallId
              );
              if (hasToolInTimeline) return null;
              return (
                <ApprovalCard
                  key={`approval-${event.data.toolCallId}`}
                  approval={event.data}
                  onDecision={onApprovalDecision || (() => {})}
                />
              );
            }

            return null;
          })}

          {/* If nothing in timeline yet, show thinking */}
          {streamTimeline.length === 0 && (
            <div className="msg-content streaming-cursor">Thinking...</div>
          )}
        </div>
      )}

      {/* ── Completion banner ── */}
      {!isStreaming && agentUsage && (
        <div className="agent-complete-banner">
          <span className="done-check">&#10003;</span>
          <span>Completed</span>
          <span className="done-stats">
            {agentUsage.turnCount} turns &middot; {agentUsage.toolCallCount} tools &middot; ${agentUsage.costUsd.toFixed(4)}
          </span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
