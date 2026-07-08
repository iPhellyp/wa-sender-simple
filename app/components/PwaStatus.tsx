"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptLike = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISSED_KEY = "wa_sender_install_dismissed_until";
const INSTALL_DISMISS_MS = 1000 * 60 * 60 * 24 * 7;

export function PwaStatus() {
  const [isOffline, setIsOffline] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptLike | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    function updateOnlineState() {
      setIsOffline(!window.navigator.onLine);
    }

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      const dismissedUntil = Number(window.localStorage.getItem(INSTALL_DISMISSED_KEY) ?? "0");

      if (dismissedUntil > Date.now()) {
        return;
      }

      setInstallPrompt(event as BeforeInstallPromptLike);
      setShowInstall(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice?.catch(() => null);
    setShowInstall(false);
    setInstallPrompt(null);
  }

  function dismissInstall() {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now() + INSTALL_DISMISS_MS));
    setShowInstall(false);
  }

  return (
    <>
      {isOffline ? (
        <div className="pwa-offline-banner" role="status">
          Sem conexao. As telas abertas continuam visiveis, mas acoes online podem falhar.
        </div>
      ) : null}
      {showInstall ? (
        <div className="pwa-install-card" role="dialog" aria-label="Instalar aplicativo">
          <span>Instalar WA Sender Simple neste dispositivo?</span>
          <div className="button-row">
            <button className="button compact-button" type="button" onClick={() => void installApp()}>
              Instalar
            </button>
            <button className="button secondary compact-button" type="button" onClick={dismissInstall}>
              Agora nao
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
