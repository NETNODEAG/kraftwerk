import { defineConfig } from "vite";

// The remote page (web/remote → dist-remote): what kraftwerk cloud serves at
// /_kw/ on its remote host — the pairing page and the service worker that
// tunnels the web UI to a machine through the relay. Built with the web UI
// and shipped in the npm package; the cloud serves the build of the version
// it pins. Two passes: the page, then (`--mode sw`) the worker as one classic
// script at a stable name — module workers are not everywhere yet.
export default defineConfig(({ mode }) =>
  mode === "sw"
    ? {
        build: {
          outDir: "dist-remote",
          emptyOutDir: false,
          target: "es2022",
          lib: { entry: "remote/sw.ts", formats: ["iife"], name: "kwRemoteWorker", fileName: () => "sw.js" },
        },
      }
    : {
        root: "remote",
        base: "/_kw/",
        build: { outDir: "../dist-remote", emptyOutDir: true, target: "es2022" },
      },
);
