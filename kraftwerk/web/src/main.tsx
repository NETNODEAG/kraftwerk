import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./app";
import { PairingGate } from "./devices";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PairingGate>
      <App />
    </PairingGate>
  </StrictMode>
);
