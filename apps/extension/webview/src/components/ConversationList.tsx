import type { Conversation } from "../types";

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function ConversationList({ conversations, activeId, onSelect }: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">&#128172;</div>
        <div className="empty-state-text">No conversations yet. Start a new chat!</div>
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          className={`conv-item ${conv.id === activeId ? "active" : ""}`}
          onClick={() => onSelect(conv.id)}
        >
          <span className="conv-item-title">{conv.title || "Untitled"}</span>
          <span className="conv-item-date">{formatDate(conv.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}
