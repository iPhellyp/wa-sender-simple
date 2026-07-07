import type { ReactNode } from "react";
import type { StatusTone } from "./StatusBadge";

type StatCardProps = {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: StatusTone;
};

export function StatCard({ label, value, helper, tone = "neutral" }: StatCardProps) {
  return (
    <article className={`stat-card stat-card-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {helper ? <div className="stat-helper">{helper}</div> : null}
    </article>
  );
}
