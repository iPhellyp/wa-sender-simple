"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type InstanceSummary = {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  status: string;
  isDefault: boolean;
};

function readInstanceIdFromUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("instanceId") ?? "";
}

export function ActiveInstanceSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [urlInstanceId, setUrlInstanceId] = useState("");

  useEffect(() => {
    setUrlInstanceId(readInstanceIdFromUrl());
  }, [pathname]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/instances", { cache: "no-store" });
      const data = (await response.json()) as { instances?: InstanceSummary[] };
      setInstances(data.instances ?? []);
    })();
  }, []);

  const activeId = useMemo(() => {
    return urlInstanceId || instances.find((instance) => instance.isDefault)?.id || "";
  }, [instances, urlInstanceId]);

  const activeInstance = instances.find((instance) => instance.id === activeId) ?? null;

  function changeInstance(instanceId: string) {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");

    if (instanceId) {
      params.set("instanceId", instanceId);
    } else {
      params.delete("instanceId");
    }

    const query = params.toString();
    setUrlInstanceId(instanceId);
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  if (instances.length === 0) {
    return null;
  }

  return (
    <div className="instance-switcher">
      <span>
        <strong>Instancia ativa</strong>
        {activeInstance ? (
          <small>
            {activeInstance.roleLabel} | {activeInstance.status}
          </small>
        ) : null}
      </span>
      <select
        className="select compact-select"
        value={activeId}
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
