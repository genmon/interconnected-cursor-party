import * as React from "react";
import { createRoot } from "react-dom/client";
import PresenceProvider from "./presence/presence-context";
import Cursors from "./presence/Cursors";

declare const PARTYKIT_HOST: string;

const pageId = window?.location.href
  ? btoa(window.location.href.split(/[?#]/)[0])
  : "default";

function App() {
  return (
    <PresenceProvider
      host={PARTYKIT_HOST}
      room={pageId}
      presence={{
        name: "Anonymous User",
        color: "#0000f0",
      }}
    >
      <Cursors />
    </PresenceProvider>
  );
}

const cursorsRoot = document.createElement("div");
document.body.appendChild(cursorsRoot);
// cursors display is absolute and needs a top-level relative container
document.documentElement.style.position = "relative";
document.documentElement.style.minHeight = "100dvh";
// add a classname
cursorsRoot.classList.add("cursors-root");

// rangy has it's own weird module system, that
// waits for the DOM to be ready before loading
// so we need to wait for that before rendering our app
const root = createRoot(cursorsRoot);
root.render(<App />);
document.addEventListener("DOMContentLoaded", () => {
  root.render(<App />);
});
