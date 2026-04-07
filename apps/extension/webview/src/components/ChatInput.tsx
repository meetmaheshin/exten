import { useCallback, useRef, useState } from "react";
import type { AvailableModel, ImageAttachment } from "../types";

interface ChatInputProps {
  onSend: (content: string, images?: ImageAttachment[]) => void;
  onCancel: () => void;
  isStreaming: boolean;
  agentMode: boolean;
  agentType: "coder" | "qa" | "design";
  onToggleAgentMode: () => void;
  onSetAgentType: (type: "coder" | "qa" | "design" | "supervisor") => void;
  availableModels: AvailableModel[];
  selectedModel: string;
  onModelChange: (model: string) => void;
}

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

export function ChatInput({
  onSend, onCancel, isStreaming, agentMode, agentType, onToggleAgentMode, onSetAgentType,
  availableModels, selectedModel, onModelChange,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachedImages.length === 0) || isStreaming) return;
    onSend(trimmed || "(see attached image)", attachedImages.length > 0 ? attachedImages : undefined);
    setValue("");
    setAttachedImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, attachedImages, isStreaming, onSend]);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (!ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_IMAGE_SIZE) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        if (base64) {
          setAttachedImages((prev) => [
            ...prev,
            { data: base64, mediaType: file.type as ImageAttachment["mediaType"] },
          ]);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/") && ACCEPTED_TYPES.includes(item.type)) {
        const file = item.getAsFile();
        if (!file || file.size > MAX_IMAGE_SIZE) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(",")[1];
          if (base64) {
            setAttachedImages((prev) => [
              ...prev,
              { data: base64, mediaType: file.type as ImageAttachment["mediaType"] },
            ]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removeImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const placeholder = isStreaming
    ? (agentType === "qa" ? "QA Agent is reviewing..." : agentType === "design" ? "Design review in progress..." : agentType === "supervisor" ? "Supervisor is reviewing..." : "AI is working...")
    : agentMode
      ? (agentType === "qa" ? "Run QA review on your code..." : agentType === "design" ? "Review UI design quality..." : agentType === "supervisor" ? "Review and improve the current work..." : "Ask AI to code something...")
      : "Ask me anything...";

  return (
    <div className="input-area">
      {/* Image previews */}
      {attachedImages.length > 0 && (
        <div className="attached-images">
          {attachedImages.map((img, i) => (
            <div className="attached-image-preview" key={i}>
              <img src={`data:${img.mediaType};base64,${img.data}`} alt="Attached" />
              <button className="remove-image-btn" onClick={() => removeImage(i)} title="Remove">&times;</button>
            </div>
          ))}
        </div>
      )}
      {/* Row 1: Textarea with attach + send buttons */}
      <div className="input-wrapper">
        <button
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming}
          title="Attach screenshot (or paste from clipboard)"
        >
          &#128247;
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
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
            disabled={!value.trim() && attachedImages.length === 0}
            title={agentMode ? "Send as agent (Enter)" : "Send message (Enter)"}
          >
            {agentMode ? "\u26A1" : "\u2191"}
          </button>
        )}
      </div>
      {/* Row 2: Controls below textarea */}
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
            <button
              className={`agent-type-btn ${agentType === "design" ? "active" : ""}`}
              onClick={() => onSetAgentType("design")}
              disabled={isStreaming}
              title="Design reviewer: audits UI quality and suggests improvements"
            >
              Design
            </button>
            {/* Supervisor runs automatically after coding agent — no manual button needed */}
          </div>
        )}
        <span className="input-controls-spacer" />
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
        <span className="input-hint">
          {isStreaming ? "Stop" : "Enter \u2191"}
        </span>
      </div>
    </div>
  );
}
