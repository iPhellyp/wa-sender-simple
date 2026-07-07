import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusTone;
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function statusToneFromValue(status: string | null | undefined): StatusTone {
  if (["connected", "sent", "completed", "success"].includes(status ?? "")) {
    return "success";
  }

  if (["failed", "canceled", "error", "disconnected"].includes(status ?? "")) {
    return "danger";
  }

  if (["running", "sending", "scheduled", "connecting", "qr"].includes(status ?? "")) {
    return "info";
  }

  if (["paused", "pending", "draft"].includes(status ?? "")) {
    return "warning";
  }

  return "neutral";
}

