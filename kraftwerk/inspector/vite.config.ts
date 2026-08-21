import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend-only dev server: `npm run dev` here, with `kraftwerk ui` (or any
// consumer's inspector server) running on 4499 to answer the API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4498,
    proxy: { "/api": "http://localhost:4499" },
  },
});
