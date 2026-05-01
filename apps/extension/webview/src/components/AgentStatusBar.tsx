import { useEffect, useState } from "react";
import type { AgentUsage } from "../types";

interface AgentStatusBarProps {
  turnNumber: number;
  toolCallCount: number;
  usage: AgentUsage | null;
  isActive: boolean;
  agentType: "coder" | "qa" | "design" | "planning" | "supervisor";
  onCancel: () => void;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AgentStatusBar({ turnNumber, toolCallCount, usage, isActive, agentType, onCancel }: AgentStatusBarProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isActive) { setElapsed(0); return; }
    const start = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  const label = agentType === "qa" ? "QA Agent"
    : agentType === "design" ? "Design Review"
    : agentType === "planning" ? "Planning Agent"
    : agentType === "supervisor" ? "Supervisor"
    : "Coding Agent";

  return (
    <div className={`agent-status-bar ${agentType === "qa" ? "agent-status-qa" : agentType === "design" ? "agent-status-design" : agentType === "planning" ? "agent-status-planning" : ""}`}>
      <div className="agent-status-info">
        <span className="agent-status-dot" />
        <span className="agent-status-label">{label}</span>
        <span>Turn {turnNumber}</span>
        {toolCallCount > 0 && <span>{toolCallCount} tool calls</span>}
        {usage && <span>${usage.costUsd.toFixed(4)}</span>}
        <span className="agent-status-timer">{formatTimer(elapsed)}</span>
      </div>
      <button className="agent-stop-btn" onClick={onCancel} title="Stop agent">
        Stop
      </button>
    </div>
  );
}
