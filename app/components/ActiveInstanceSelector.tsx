"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  appendInstanceIdToHref,
  getInstanceIdFromUrl,
  getStoredActiveInstanceId,
  setStoredActiveInstanceId
} from "@/src/lib/client/active-instance";

type InstanceSummary = {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  status: string;
  isDefault: boolean;
};

export function ActiveInstanceSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState("");

  useEffect(() => {
    const urlInstanceId = getInstanceIdFromUrl();
    const storedInstanceId = getStoredActiveInstanceId();
    const resolvedInstanceId = urlInstanceId || storedInstanceId;

    setActiveInstanceId(resolvedInstanceId);

  }, [pathname]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/instances", { cache: "no-store" });
      const data = (await response.json()) as { instances?: InstanceSummary[] };
      setInstances(data.instances ?? []);
    })();
  }, []);

  const activeId = useMemo(() => {
    return activeInstanceId || instances.find((instance) => instance.isDefault)?.id || "";
  }, [activeInstanceId, instances]);

  const activeInstance = instances.find((instance) => instance.id === activeId) ?? null;
  const urlInstanceId = getInstanceIdFromUrl();
  const hasInvalidUrlInstance = Boolean(urlInstanceId && instances.length > 0 && !activeInstance);

  useEffect(() => {
    const validUrlInstance = instances.find((instance) => instance.id === urlInstanceId);

    if (validUrlInstance) {
      setStoredActiveInstanceId(validUrlInstance.id);
      setActiveInstanceId(validUrlInstance.id);
    }
  }, [instances, urlInstanceId]);

  function changeInstance(instanceId: string) {
    setStoredActiveInstanceId(instanceId);
    setActiveInstanceId(instanceId);
    router.push(appendInstanceIdToHref(`${pathname}${typeof window !== "undefined" ? window.location.search : ""}`, instanceId));
  }

  if (instances.length === 0) {
    return null;
  }

  return (
    <div className="instance-switcher">
      <span>
        <strong>Instancia ativa</strong>
        {hasInvalidUrlInstance ? (
          <small>Instancia nao encontrada</small>
        ) : activeInstance ? (
          <small>
            {activeInstance.roleLabel} | {activeInstance.status}
          </small>
        ) : null}
      </span>
      <select
        className="select compact-select"
        value={activeId}
        aria-invalid={hasInvalidUrlInstance}
        onChange={(event) => changeInstance(event.target.value)}
      >
        {instances.map((instance) => (
          <option key={instance.id} value={instance.id}>
            {instance.name}
          </option>
        ))}
      </select>
    </div>
  );
}
