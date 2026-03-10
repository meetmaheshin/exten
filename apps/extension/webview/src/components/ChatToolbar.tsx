interface ChatToolbarProps {
  title: string;
  onNewChat: () => void;
  onToggleConversations: () => void;
  showingConversations: boolean;
}

export function ChatToolbar({
  title,
  onNewChat,
  onToggleConversations,
  showingConversations,
}: ChatToolbarProps) {
  return (
    <div className="toolbar">
      <button
        className="icon-btn"
        onClick={onToggleConversations}
        title={showingConversations ? "Back to chat" : "Conversation history"}
      >
        {showingConversations ? "\u2190" : "\u2630"}
      </button>
      <span className="toolbar-title">{title}</span>
      <div className="toolbar-actions">
        <button className="icon-btn" onClick={onNewChat} title="New conversation">
          +
        </button>
      </div>
    </div>
  );
}
