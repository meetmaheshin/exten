import { useEffect, useRef, useState } from "react";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ApprovalCard } from "./ApprovalCard";
import type { ChatMessage, ToolCallDisplay as ToolCallData, PendingApproval, AgentUsage } from "../types";
import { renderMarkdown } from "../utils/markdown";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  activeToolCalls?: ToolCallData[];
  pendingApprovals?: PendingApproval[];
  onApprovalDecision?: (toolCallId: string, decision: "allow" | "allowAll" | "deny") => void;
  agentUsage?: AgentUsage | null;
}

export function MessageList({
  messages,
  isStreaming,
  streamingContent,
  activeToolCalls = [],
  pendingApprovals = [],
  onApprovalDecision,
  agentUsage,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
  }, [messages.length, streamingContent, activeToolCalls.length, pendingApprovals.length, agentUsage]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="messages-container" ref={containerRef}>
        <div className="empty-state">
          <div className="empty-state-icon">&#9997;</div>
          <div className="empty-state-text">Send a message to start your conversation with AI.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-container" ref={containerRef}>
      {/* ── Existing messages (history) ── */}
      {messages.map((msg, i) => (
        <div key={msg.id ?? `msg-${i}`}>
          {msg.role === "user" ? (
            <div className="msg-row msg-user">
              <div className="msg-role">YOU</div>
              <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            </div>
          ) : (
            <div className="msg-row msg-assistant">
              <div className="msg-role">AI</div>
              {/* Tool calls inline before text */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="msg-tools-inline">
                  {msg.toolCalls.map((tc) => (
                    <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
                  ))}
                </div>
              )}
              {msg.content && (
                <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
              )}
              {msg.costUsd != null && msg.costUsd > 0 && (
                <div className="msg-meta">${msg.costUsd.toFixed(4)}</div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* ── Active streaming: one continuous AI block ── */}
      {isStreaming && (
        <div className="msg-row msg-assistant msg-streaming">
          <div className="msg-role">
            AI
            {elapsed > 0 && <span className="msg-elapsed">{formatElapsed(elapsed)}</span>}
          </div>

          {/* All tool calls, approvals, and text in one continuous flow */}
          {activeToolCalls.map((tc, idx) => {
            // Check if there's a pending approval for this tool call
            const approval = pendingApprovals.find((a) => a.toolCallId === tc.toolCallId);
            const isLatest = idx === activeToolCalls.length - 1 &&
              (tc.status === "running" || tc.status === "pending");

            return (
              <div key={tc.toolCallId} className="msg-inline-tool">
                <ToolCallDisplay toolCall={tc} autoExpand={isLatest} />
                {approval && (
                  <ApprovalCard
                    approval={approval}
                    onDecision={onApprovalDecision || (() => {})}
                  />
                )}
              </div>
            );
          })}

          {/* Approvals without matching tool calls (edge case) */}
          {pendingApprovals
            .filter((a) => !activeToolCalls.some((tc) => tc.toolCallId === a.toolCallId))
            .map((approval) => (
              <div key={approval.toolCallId} className="msg-inline-tool">
                <ApprovalCard
                  approval={approval}
                  onDecision={onApprovalDecision || (() => {})}
                />
              </div>
            ))}

          {/* Streaming text content */}
          {streamingContent ? (
            <div className="msg-content streaming-cursor" dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingContent) }} />
          ) : activeToolCalls.length === 0 && pendingApprovals.length === 0 ? (
            <div className="msg-content streaming-cursor">Thinking...</div>
          ) : null}
        </div>
      )}

      {/* ── Agent completion ── */}
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
