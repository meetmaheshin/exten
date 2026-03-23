import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ApprovalCard } from "./ApprovalCard";
import type { ChatMessage, ToolCallDisplay as ToolCallData, PendingApproval, AgentUsage } from "../types";

/** Format seconds as mm:ss */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

/** Get a human-readable current action from the latest tool call */
function getCurrentAction(toolCalls: ToolCallData[]): string {
  const running = toolCalls.filter((tc) => tc.status === "running" || tc.status === "pending");
  if (running.length === 0) return "Thinking...";
  const latest = running[running.length - 1];
  switch (latest.toolName) {
    case "read_file": return `Reading ${(latest.toolInput as { path?: string }).path || "file"}...`;
    case "write_file": return `Writing ${(latest.toolInput as { path?: string }).path || "file"}...`;
    case "edit_file": return `Editing ${(latest.toolInput as { path?: string }).path || "file"}...`;
    case "run_terminal": return "Running command...";
    case "search_files": return `Searching for "${(latest.toolInput as { pattern?: string }).pattern || ""}"...`;
    case "list_directory": return `Listing ${(latest.toolInput as { path?: string }).path || "."}...`;
    case "glob_files": return `Finding ${(latest.toolInput as { pattern?: string }).pattern || "files"}...`;
    default: return "Working...";
  }
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

export function MessageList({ messages, isStreaming, streamingContent, activeToolCalls = [], pendingApprovals = [], onApprovalDecision, agentUsage }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const streamStartRef = useRef<number>(0);

  // Elapsed timer during streaming
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

  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent, activeToolCalls.length, pendingApprovals.length, agentUsage]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="messages-container" ref={containerRef}>
        <div className="empty-state">
          <div className="empty-state-icon">&#9997;</div>
          <div className="empty-state-text">
            Send a message to start your conversation with AI.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-container" ref={containerRef}>
      {messages.map((msg, i) => (
        <div key={msg.id ?? `msg-${i}`}>
          {/* For assistant messages: show tool calls BEFORE the text */}
          {msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0 && (
            <div className="tool-calls-group">
              {msg.toolCalls.map((tc) => (
                <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
              ))}
            </div>
          )}
          <MessageBubble message={msg} />
        </div>
      ))}
      {/* During streaming: show tool calls FIRST, then approval cards, then text */}
      {isStreaming && activeToolCalls.length > 0 && (
        <div className="agent-activity">
          <div className="agent-activity-header">
            <span className="agent-activity-dot" />
            <span className="agent-activity-action">{getCurrentAction(activeToolCalls)}</span>
            <span className="agent-activity-stats">
              {activeToolCalls.length} tool{activeToolCalls.length !== 1 ? "s" : ""}
              {" · "}
              {formatElapsed(elapsed)}
            </span>
          </div>
          <div className="tool-calls-group active">
            {activeToolCalls.map((tc, idx) => {
              // Auto-expand the latest running tool call
              const isLatestRunning = idx === activeToolCalls.length - 1 &&
                (tc.status === "running" || tc.status === "pending");
              return (
                <ToolCallDisplay
                  key={tc.toolCallId}
                  toolCall={tc}
                  autoExpand={isLatestRunning}
                />
              );
            })}
          </div>
        </div>
      )}
      {/* Pending approval cards */}
      {pendingApprovals.map((approval) => (
        <ApprovalCard
          key={approval.toolCallId}
          approval={approval}
          onDecision={onApprovalDecision || (() => {})}
        />
      ))}
      {/* Streaming text appears AFTER tool calls */}
      {isStreaming && streamingContent && (
        <MessageBubble
          message={{ role: "assistant", content: streamingContent }}
          isStreaming
        />
      )}
      {/* Working indicator when streaming but nothing visible yet */}
      {isStreaming && !streamingContent && activeToolCalls.length === 0 && pendingApprovals.length === 0 && (
        <div className="message">
          <div className="message-header">
            <span className="message-role assistant">AI</span>
            {elapsed > 0 && <span className="agent-elapsed-badge">{formatElapsed(elapsed)}</span>}
          </div>
          <div className="message-body assistant streaming-cursor">Thinking...</div>
        </div>
      )}
      {/* Agent completion banner — shown when agent finishes */}
      {!isStreaming && agentUsage && (
        <div className="agent-complete-banner">
          <span className="done-check">&#10003;</span>
          <span>Agent completed</span>
          <span className="done-stats">
            {agentUsage.turnCount} turns &middot; {agentUsage.toolCallCount} tool calls &middot; ${agentUsage.costUsd.toFixed(4)}
          </span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
