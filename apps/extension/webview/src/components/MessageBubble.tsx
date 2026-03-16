import { useCallback, useEffect, useRef } from "react";
import { renderMarkdown } from "../utils/markdown";
import type { ChatMessage } from "../types";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  const handleCopyClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("copy-btn")) {
      const code = target.getAttribute("data-code");
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          target.textContent = "Copied!";
          target.classList.add("copied");
          setTimeout(() => {
            target.textContent = "Copy";
            target.classList.remove("copied");
          }, 2000);
        });
      }
    }
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.addEventListener("click", handleCopyClick as EventListener);
      return () => el.removeEventListener("click", handleCopyClick as EventListener);
    }
  }, [handleCopyClick]);

  const rendered =
    message.role === "user"
      ? escapeHtml(message.content)
      : renderMarkdown(message.content);

  return (
    <div className="message">
      <div className="message-header">
        <span className={`message-role ${message.role}`}>
          {message.role === "user" ? "You" : "AI"}
        </span>
        {message.createdAt && (
          <span className="message-timestamp">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      {message.images && message.images.length > 0 && (
        <div className="message-images">
          {message.images.map((img, i) => (
            <img key={i} src={`data:${img.mediaType};base64,${img.data}`} alt="Attached" />
          ))}
        </div>
      )}
      <div
        ref={bodyRef}
        className={`message-body ${message.role} ${isStreaming ? "streaming-cursor" : ""}`}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
      {message.role === "assistant" && message.outputTokens != null && !isStreaming && (
        <div className="message-usage">
          <span>{message.inputTokens?.toLocaleString()} in</span>
          <span>{message.outputTokens.toLocaleString()} out</span>
          {message.costUsd != null && (
            <span>${message.costUsd.toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
