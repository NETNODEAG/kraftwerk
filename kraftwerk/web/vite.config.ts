import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Frontend-only dev server: `npm run dev` here, with `kraftwerk ui` (or any
// consumer's inspector server) running on 1981 to answer the API — or point
// it at a workspace the daemon serves by its own port:
// KRAFTWERK_DEV_API=http://localhost:2001 npm run dev.
const api = process.env.KRAFTWERK_DEV_API || "http://localhost:1981";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.KRAFTWERK_DEV_PORT) || 1980,
    // Object form, so the Host header stays localhost:1980 (the string form
    // rewrites it to the target): the API's origin check compares Origin to
    // Host and would 403 every POST from the dev server otherwise.
    proxy: {
      "/api": { target: api, changeOrigin: false, ws: true },
      // Vibeables are served by the inspector server as static folders (not by
      // the SPA): without this the dev server answers /vibeables/<slug>/ with
      // index.html and the preview is blank.
      "/vibeables": { target: api, changeOrigin: false },
    },
  },
});
