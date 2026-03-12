import { useCallback, useRef, useState } from "react";
import type { AvailableModel } from "../types";

interface ChatInputProps {
  onSend: (content: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  agentMode: boolean;
  agentType: "coder" | "qa";
  onToggleAgentMode: () => void;
  onSetAgentType: (type: "coder" | "qa") => void;
  availableModels: AvailableModel[];
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export function ChatInput({
  onSend, onCancel, isStreaming, agentMode, agentType, onToggleAgentMode, onSetAgentType,
  availableModels, selectedModel, onModelChange,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue("");
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
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
  };

  const placeholder = isStreaming
    ? (agentType === "qa" ? "QA Agent is reviewing..." : "AI is working...")
    : agentMode
      ? (agentType === "qa" ? "Run QA review on your code..." : "Ask AI to code something...")
      : "Ask me anything...";

  return (
    <div className="input-area">
      <div className="input-controls">
        <button
          className={`mode-toggle ${agentMode ? "mode-agent" : "mode-chat"}`}
          onClick={onToggleAgentMode}
          disabled={isStreaming}
          title={agentMode ? "Agent mode: AI can edit files & run commands" : "Chat mode: conversation only"}
        >
          {agentMode ? "\u26A1 Agent" : "\u{1F4AC} Chat"}
        </button>
        {agentMode && (
          <div className="agent-type-toggle">
            <button
              className={`agent-type-btn ${agentType === "coder" ? "active" : ""}`}
              onClick={() => onSetAgentType("coder")}
              disabled={isStreaming}
              title="Coding agent: writes and edits code"
            >
              Code
            </button>
            <button
              className={`agent-type-btn ${agentType === "qa" ? "active" : ""}`}
              onClick={() => onSetAgentType("qa")}
              disabled={isStreaming}
              title="QA agent: reviews code for bugs & improvements"
            >
              QA
            </button>
          </div>
        )}
        {availableModels.length > 0 && (
          <select
            className="model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isStreaming}
            title="Select AI model"
          >
            {(() => {
              const codeModels = availableModels.filter((m) => m.category === "code");
              const chatModels = availableModels.filter((m) => m.category === "chat");
              const reasoningModels = availableModels.filter((m) => m.category === "reasoning");
              const uncategorized = availableModels.filter((m) => !m.category);
              return (
                <>
                  {codeModels.length > 0 && (
                    <optgroup label="Code">
                      {codeModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  )}
                  {chatModels.length > 0 && (
                    <optgroup label="Chat">
                      {chatModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  )}
                  {reasoningModels.length > 0 && (
                    <optgroup label="Reasoning">
                      {reasoningModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  )}
                  {uncategorized.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </>
              );
            })()}
          </select>
        )}
        <span className="input-controls-spacer" />
        <span className="input-hint">
          {isStreaming ? "Stop to cancel" : "Enter \u2191  Shift+Enter \u21B5"}
        </span>
      </div>
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
            {agentMode ? "\u26A1" : "\u2191"}
          </button>
        )}
      </div>
    </div>
  );
}
