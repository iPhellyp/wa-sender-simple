import type { ReactNode } from "react";

type SectionCardProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  tone?: "default" | "danger";
};

export function SectionCard({
  title,
  description,
  actions,
  children,
  tone = "default"
}: SectionCardProps) {
  return (
    <section className={`section-card ${tone === "danger" ? "section-card-danger" : ""}`}>
      {title || description || actions ? (
        <div className="section-card-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="section-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
