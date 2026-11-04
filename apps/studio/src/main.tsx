import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { designTokensCss } from "@layoutlens/shared";
import { App } from "./app/App";
import { ThemeProvider } from "./app/theme";
import { ReportStoreProvider } from "./data/report-store";
import { ScanJobsProvider } from "./data/scan-jobs";
import "./styles/global.css";

const tokens = document.createElement("style");
tokens.id = "ll-tokens";
tokens.textContent = designTokensCss();
document.head.prepend(tokens);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <ReportStoreProvider>
        <ScanJobsProvider>
          <App />
        </ScanJobsProvider>
      </ReportStoreProvider>
    </ThemeProvider>
  </StrictMode>,
);
