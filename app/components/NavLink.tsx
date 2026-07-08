"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { appendInstanceIdToHref, getStoredActiveInstanceId } from "@/src/lib/client/active-instance";

type NavLinkProps = {
  href: string;
  children: ReactNode;
};

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const [instanceId, setInstanceId] = useState("");
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const resolvedHref = appendInstanceIdToHref(href, instanceId);

  useEffect(() => {
    setInstanceId(getStoredActiveInstanceId());

    function handleActiveInstanceChanged(event: Event) {
      const detail = (event as CustomEvent<{ instanceId?: string }>).detail;
      setInstanceId(detail?.instanceId ?? getStoredActiveInstanceId());
    }

    window.addEventListener("wa-sender-active-instance-changed", handleActiveInstanceChanged);
    return () => window.removeEventListener("wa-sender-active-instance-changed", handleActiveInstanceChanged);
  }, [pathname]);

  return (
    <Link className={isActive ? "active" : undefined} href={resolvedHref} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
