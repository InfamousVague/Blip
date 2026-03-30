import { createRoot } from "react-dom/client";
import "@mattmattmattmatt/base/site/styles/tokens.css";
import "./index.css";
import { MenuBarApp } from "./MenuBarApp";

document.documentElement.setAttribute("data-theme", "dark");

createRoot(document.getElementById("menubar-root")!).render(<MenuBarApp />);
