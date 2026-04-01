import { createRoot } from "react-dom/client";
import "./base-tokens.css";
import "@blip/ui/tokens/tokens.css";
import "./website.css";
import { WebsiteApp } from "./WebsiteApp";

createRoot(document.getElementById("root")!).render(<WebsiteApp />);
