import type { AgentUsage } from "../types";

interface AgentStatusBarProps {
  turnNumber: number;
  toolCallCount: number;
  usage: AgentUsage | null;
  isActive: boolean;
  onCancel: () => void;
}

export function AgentStatusBar({ turnNumber, toolCallCount, usage, isActive, onCancel }: AgentStatusBarProps) {
  if (!isActive) return null;

  return (
    <div className="agent-status-bar">
      <div className="agent-status-info">
        <span className="agent-status-dot" />
        <span>Turn {turnNumber}</span>
        {toolCallCount > 0 && <span>{toolCallCount} tool calls</span>}
        {usage && <span>${usage.costUsd.toFixed(4)}</span>}
      </div>
      <button className="agent-stop-btn" onClick={onCancel} title="Stop agent">
        Stop
      </button>
    </div>
  );
}
