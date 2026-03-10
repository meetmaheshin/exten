import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { ToolCallDisplay } from "./ToolCallDisplay";
import type { ChatMessage, ToolCallDisplay as ToolCallData } from "../types";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  activeToolCalls?: ToolCallData[];
}

export function MessageList({ messages, isStreaming, streamingContent, activeToolCalls = [] }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent, activeToolCalls.length]);

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
      {/* Show active tool calls during streaming */}
      {isStreaming && activeToolCalls.length > 0 && (
        <div className="tool-calls-group active">
          {activeToolCalls.map((tc) => (
            <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
          ))}
        </div>
      )}
      {isStreaming && streamingContent && (
        <MessageBubble
          message={{ role: "assistant", content: streamingContent }}
          isStreaming
        />
      )}
      {isStreaming && !streamingContent && activeToolCalls.length === 0 && (
        <div className="message">
          <div className="message-header">
            <span className="message-role assistant">AI</span>
          </div>
          <div className="message-body assistant streaming-cursor">&nbsp;</div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
