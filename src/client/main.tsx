import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ThemeProvider } from "./theme";
import { PlayerProfileProvider } from "./player-profile";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <PlayerProfileProvider><ThemeProvider><App /></ThemeProvider></PlayerProfileProvider>
  </BrowserRouter>,
);
