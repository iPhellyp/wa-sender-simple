import Link from "next/link";
import type { ReactNode } from "react";

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
};

export function ButtonLink({ href, children, variant = "primary" }: ButtonLinkProps) {
  const className = variant === "primary" ? "button" : `button ${variant}`;

  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}

