import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WA Sender Simple",
    short_name: "WA Sender",
    description: "Envio controlado de mensagens WhatsApp com operacao multi-instancia.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: "#0f172a",
    background_color: "#f8fafc",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
