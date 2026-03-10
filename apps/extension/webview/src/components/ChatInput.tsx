import { useCallback, useRef, useState } from "react";
import type { AvailableModel } from "../types";

interface ChatInputProps {
  onSend: (content: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  agentMode: boolean;
  onToggleAgentMode: () => void;
  availableModels: AvailableModel[];
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export function ChatInput({
  onSend, onCancel, isStreaming, agentMode, onToggleAgentMode,
  availableModels, selectedModel, onModelChange,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize textarea
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
  };

  const placeholder = isStreaming
    ? "AI is working..."
    : agentMode
      ? "Ask AI to code something..."
      : "Ask me anything...";

  return (
    <div className="input-area">
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isStreaming}
          rows={1}
        />
        {isStreaming ? (
          <button className="cancel-btn" onClick={onCancel} title="Stop generation">
            &#9632;
          </button>
        ) : (
          <button
            className={`send-btn ${agentMode ? "agent-send" : ""}`}
            onClick={handleSend}
            disabled={!value.trim()}
            title={agentMode ? "Send as agent (Enter)" : "Send message (Enter)"}
          >
            {agentMode ? "\u{26A1}" : "\u2191"}
          </button>
        )}
      </div>
      <div className="input-footer">
        <div className="input-footer-left">
          <button
            className={`mode-toggle ${agentMode ? "mode-agent" : "mode-chat"}`}
            onClick={onToggleAgentMode}
            disabled={isStreaming}
            title={agentMode ? "Agent mode: AI can edit files & run commands" : "Chat mode: conversation only"}
          >
            {agentMode ? "\u{26A1} Agent" : "\u{1F4AC} Chat"}
          </button>
          {availableModels.length > 1 && (
            <select
              className="model-select"
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={isStreaming}
              title="Select AI model"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="input-hint">
          {isStreaming ? "Click stop to cancel" : "Enter to send, Shift+Enter for new line"}
        </span>
      </div>
    </div>
  );
}
