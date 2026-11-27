import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "meine Schranke",
    short_name: "meine Schranke",
    description: "Schrankenstatus und nächste Zugbewegungen im Blick.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef5fb",
    theme_color: "#18324a",
    lang: "de",
    categories: ["navigation", "travel"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
