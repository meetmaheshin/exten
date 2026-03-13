import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { ApprovalCard } from "./ApprovalCard";
import type { ChatMessage, ToolCallDisplay as ToolCallData, PendingApproval } from "../types";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  activeToolCalls?: ToolCallData[];
  pendingApprovals?: PendingApproval[];
  onApprovalDecision?: (toolCallId: string, decision: "allow" | "allowAll" | "deny") => void;
}

export function MessageList({ messages, isStreaming, streamingContent, activeToolCalls = [], pendingApprovals = [], onApprovalDecision }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent, activeToolCalls.length, pendingApprovals.length]);

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
          <MessageBubble message={msg} />
          {/* Show tool calls from completed messages */}
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div className="tool-calls-group">
              {msg.toolCalls.map((tc) => (
                <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
              ))}
            </div>
          )}
        </div>
      ))}
      {/* Show streaming content if any */}
      {isStreaming && streamingContent && (
        <MessageBubble
          message={{ role: "assistant", content: streamingContent }}
          isStreaming
        />
      )}
      {/* Show active tool calls during streaming — inline in chat */}
      {isStreaming && activeToolCalls.length > 0 && (
        <div className="agent-activity">
          <div className="agent-activity-header">
            <span className="agent-activity-dot" />
            <span>Agent is working...</span>
          </div>
          <div className="tool-calls-group active">
            {activeToolCalls.map((tc) => (
              <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
            ))}
          </div>
        </div>
      )}
      {/* Show a working indicator when streaming but no content yet and no tool calls and no approvals */}
      {isStreaming && !streamingContent && activeToolCalls.length === 0 && pendingApprovals.length === 0 && (
        <div className="message">
          <div className="message-header">
            <span className="message-role assistant">AI</span>
          </div>
          <div className="message-body assistant streaming-cursor">&nbsp;</div>
        </div>
      )}
      {/* Show pending approval cards inline */}
      {pendingApprovals.map((approval) => (
        <ApprovalCard
          key={approval.toolCallId}
          approval={approval}
          onDecision={onApprovalDecision || (() => {})}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
