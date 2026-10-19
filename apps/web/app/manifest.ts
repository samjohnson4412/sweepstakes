import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SweepTrack",
    short_name: "SweepTrack",
    description: "Find, enter, and track sweepstakes, including mail-in entries.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: "#5b4bdb",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    // Android: "Share → SweepTrack" from any browser or app sends the link here.
    share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
  } as MetadataRoute.Manifest;
}
