/**
 * Static SPA build for the ASP.NET Core single-app deployment.
 * Produces plain client-side assets into aspnet/Ringly.Api/wwwroot.
 * The default vite.config.ts (TanStack Start) is untouched.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(rootDir, "src");

export default defineConfig({
  root: path.resolve(rootDir, "spa"),
  publicDir: path.resolve(rootDir, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Server functions -> same-domain ASP.NET Core REST endpoints.
      {
        find: /^(\.\/|@\/lib\/)twilio\.functions$/,
        replacement: path.join(srcDir, "lib/twilio.functions.spa.ts"),
      },
      {
        find: /^(\.\/|@\/lib\/)auth\.functions$/,
        replacement: path.join(srcDir, "lib/auth.functions.spa.ts"),
      },
      { find: "@", replacement: srcDir },
      { find: "/src", replacement: srcDir },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  build: {
    outDir: path.resolve(rootDir, "aspnet/Ringly.Api/wwwroot"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    fs: { allow: [rootDir] },
  },
});
