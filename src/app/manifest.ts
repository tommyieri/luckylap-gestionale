import type { MetadataRoute } from "next";

/* Aggiunto alla schermata Home: nome breve «LuckyLap», icona con le due «L», apertura a schermo intero. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LuckyLap · Gestionale",
    short_name: "LuckyLap",
    start_url: "/",
    display: "standalone",
    background_color: "#1d4b07",
    theme_color: "#1d4b07",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
