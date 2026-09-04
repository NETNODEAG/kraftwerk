import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend-only dev server: `npm run dev` here, with `kraftwerk ui` (or any
// consumer's inspector server) running on 1981 to answer the API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1980,
    // Object form, so the Host header stays localhost:1980 (the string form
    // rewrites it to the target): the API's origin check compares Origin to
    // Host and would 403 every POST from the dev server otherwise.
    proxy: { "/api": { target: "http://localhost:1981", changeOrigin: false } },
  },
});
