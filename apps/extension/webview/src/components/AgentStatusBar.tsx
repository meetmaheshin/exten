import type { AgentUsage } from "../types";

interface AgentStatusBarProps {
  turnNumber: number;
  toolCallCount: number;
  usage: AgentUsage | null;
  isActive: boolean;
  agentType: "coder" | "qa" | "design";
  onCancel: () => void;
}

export function AgentStatusBar({ turnNumber, toolCallCount, usage, isActive, agentType, onCancel }: AgentStatusBarProps) {
  if (!isActive) return null;

  const label = agentType === "qa" ? "QA Agent" : agentType === "design" ? "Design Review" : "Coding Agent";

  return (
    <div className={`agent-status-bar ${agentType === "qa" ? "agent-status-qa" : agentType === "design" ? "agent-status-design" : ""}`}>
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
