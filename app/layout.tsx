import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WA Sender Simple",
  description: "Envio controlado de mensagens WhatsApp com planilha Excel"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
