interface StatCardProps {
  value: string;
  label: string;
  color?: "blue" | "green" | "yellow" | "purple";
}

export function StatCard({ value, label, color = "blue" }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className={`stat-value ${color}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
