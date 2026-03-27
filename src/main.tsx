import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@mattmattmattmatt/base/site/styles/tokens.css";
import "./index.css";
import App from "./App.tsx";

document.documentElement.setAttribute("data-theme", "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
