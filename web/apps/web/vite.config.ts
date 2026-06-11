import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const API_TARGET = process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:18765";

/** Backend route prefixes proxied to the Fastify server during `npm run dev`. */
const API_PREFIXES = [
  "api/v1",
  "health",
  "plans",
  "sources",
  "jobs",
  "parts",
  "printers",
  "printer-presets",
  "settings",
  "filaments",
  "integrations",
  "legal",
  "help",
  "kit-catalog",
  "manifest-registry",
  "manifest-templates",
  "community",
  "imports",
  "ws",
];

const proxy = Object.fromEntries(
  API_PREFIXES.map((prefix) => [
    `/${prefix}`,
    { target: API_TARGET, changeOrigin: true, ws: prefix === "ws" || prefix === "jobs" },
  ]),
);

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy,
  },
  envPrefix: ["VITE_"],
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
