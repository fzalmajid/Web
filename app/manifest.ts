import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ruang Belajar",
    short_name: "Belajar",
    description: "Belajar dari database materi pribadi.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f8f5",
    theme_color: "#f3f8f5",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
