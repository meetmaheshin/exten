import type { AgentUsage } from "../types";

interface AgentStatusBarProps {
  turnNumber: number;
  toolCallCount: number;
  usage: AgentUsage | null;
  isActive: boolean;
  agentType: "coder" | "qa";
  onCancel: () => void;
}

export function AgentStatusBar({ turnNumber, toolCallCount, usage, isActive, agentType, onCancel }: AgentStatusBarProps) {
  if (!isActive) return null;

  const label = agentType === "qa" ? "QA Agent" : "Coding Agent";

  return (
    <div className={`agent-status-bar ${agentType === "qa" ? "agent-status-qa" : ""}`}>
      <div className="agent-status-info">
        <span className="agent-status-dot" />
        <span className="agent-status-label">{label}</span>
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
