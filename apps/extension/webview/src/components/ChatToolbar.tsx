import { getVsCodeApi } from "../vscodeApi";

interface ChatToolbarProps {
  title: string;
  onNewChat: () => void;
  onToggleConversations: () => void;
  onExport?: (format: "markdown" | "json") => void;
  showingConversations: boolean;
}

export function ChatToolbar({
  title,
  onNewChat,
  onToggleConversations,
  onExport,
  showingConversations,
}: ChatToolbarProps) {
  const handleOpenSettings = () => {
    getVsCodeApi().postMessage({ type: "openSettings" });
  };
  const handleOpenDocs = () => {
    getVsCodeApi().postMessage({ type: "openDocs" });
  };
  const handleSendFeedback = () => {
    getVsCodeApi().postMessage({ type: "sendFeedback" });
  };

  return (
    <div className="toolbar">
      <button
        className="icon-btn"
        onClick={onToggleConversations}
        title={showingConversations ? "Back to chat" : "Conversation history"}
      >
        {showingConversations ? "←" : "☰"}
      </button>
      <span className="toolbar-title">{title}</span>
      <div className="toolbar-actions">
        <button
          className="icon-btn"
          onClick={handleOpenSettings}
          title="Open Ailancers settings"
          aria-label="Open Ailancers settings"
        >
          {"⚙"}
        </button>
        <button
          className="icon-btn"
          onClick={handleOpenDocs}
          title="Open documentation"
          aria-label="Open documentation"
        >
          ?
        </button>
        <button
          className="icon-btn"
          onClick={handleSendFeedback}
          title="Send feedback"
          aria-label="Send feedback"
        >
          {"\u{1F4AC}"}
        </button>
        {onExport && !showingConversations && (
          <>
            <button
              className="icon-btn"
              onClick={() => onExport("markdown")}
              title="Export this conversation as Markdown"
            >
              ⤓
            </button>
          </>
        )}
        <button className="icon-btn" onClick={onNewChat} title="New conversation">
          +
        </button>
      </div>
    </div>
  );
}
