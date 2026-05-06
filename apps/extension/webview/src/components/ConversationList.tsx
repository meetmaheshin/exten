import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "../types";

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Fired when the user double-clicks a conversation title and submits a
   *  new value via Enter or blur. Empty/whitespace-only titles are dropped
   *  by this component before reaching the parent. */
  onRename?: (id: string, title: string) => void;
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

export function ConversationList({ conversations, activeId, onSelect, onRename }: ConversationListProps) {
  const [search, setSearch] = useState("");
  /** id of the conversation whose title is currently being edited inline. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Focus + select-all when entering edit mode so the user can immediately
  // type a new title.
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const commitRename = (id: string) => {
    const next = editValue.trim();
    setEditingId(null);
    if (next && onRename) onRename(id, next);
  };
  const cancelRename = () => {
    setEditingId(null);
    setEditValue("");
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [conversations, search]);

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
      <div className="conversation-search">
        <input
          type="text"
          className="conversation-search-input"
          placeholder="Search conversations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="conversation-search-clear"
            onClick={() => setSearch("")}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 24 }}>
          <div className="empty-state-text" style={{ fontSize: 12 }}>No conversations match "{search}"</div>
        </div>
      ) : (
        filtered.map((conv) => {
          const isEditing = editingId === conv.id;
          return (
            <div
              key={conv.id}
              className={`conv-item ${conv.id === activeId ? "active" : ""}`}
              onClick={() => { if (!isEditing) onSelect(conv.id); }}
              onDoubleClick={(e) => {
                if (!onRename) return;
                e.stopPropagation();
                setEditingId(conv.id);
                setEditValue(conv.title || "");
              }}
              role="button"
              tabIndex={0}
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  className="conv-item-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(conv.id); }
                    else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                  }}
                  onBlur={() => commitRename(conv.id)}
                />
              ) : (
                <span className="conv-item-title" title="Double-click to rename">{conv.title || "Untitled"}</span>
              )}
              <span className="conv-item-date">{formatDate(conv.createdAt)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
