import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App.jsx";
import "./styles/theme.css";
import "./styles/glass.css";
import "./styles/app.css";

const container = document.getElementById("root");
createRoot(container).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}
