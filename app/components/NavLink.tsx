"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  children: ReactNode;
};

function readInstanceIdFromUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("instanceId") ?? "";
}

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const [instanceId, setInstanceId] = useState("");
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const resolvedHref = instanceId ? `${href}?instanceId=${encodeURIComponent(instanceId)}` : href;

  useEffect(() => {
    setInstanceId(readInstanceIdFromUrl());
  }, [pathname]);

  return (
    <Link className={isActive ? "active" : undefined} href={resolvedHref} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
