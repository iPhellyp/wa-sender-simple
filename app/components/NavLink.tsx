"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  children: ReactNode;
};

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  return (
    <Link className={isActive ? "active" : undefined} href={href} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
