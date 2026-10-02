import type { Metadata, Viewport } from "next";
import TransientUiManager from "@/components/TransientUiManager";
import LearningPrivacy from "@/components/LearningPrivacy";
import OfflineAuto from "@/components/OfflineAuto";
import "./learning-tools.css";
import "./globals.css";
import "./layout-alignment.css";
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: "Ruang Belajar",
  description: "Belajar dari database materi pribadi.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f3f8f5",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <TransientUiManager />
        <LearningPrivacy />
        <OfflineAuto />
        {children}
      </body>
    </html>
  );
}
