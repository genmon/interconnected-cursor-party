import * as React from "react";
import { createRoot } from "react-dom/client";
import PresenceProvider from "./presence/presence-context";
import Cursors from "./presence/Cursors";

declare const PARTYKIT_HOST: string;

const rainbow24 = [
  "#FF0000",
  "#FF4000",
  "#FF8000",
  "#FFC000",
  "#FFFF00",
  "#C0FF00",
  "#80FF00",
  "#40FF00",
  "#00FF00",
  "#00FF40",
  "#00FF80",
  "#00FFC0",
  "#00FFFF",
  "#00C0FF",
  "#0080FF",
  "#0040FF",
  "#0000FF",
  "#4000FF",
  "#8000FF",
  "#C000FF",
  "#FF00FF",
  "#FF00C0",
  "#FF0080",
  "#FF0040",
];

const chooseRandom = (arr: string[]) => {
  return arr[Math.floor(Math.random() * arr.length)];
};

const pageId = window?.location.href
  ? btoa(window.location.href.split(/[?#]/)[0])
  : "default";

function App() {
  return (
    <PresenceProvider
      host={PARTYKIT_HOST}
      room={pageId}
      presence={{ name: "Anonymous User", color: chooseRandom(rainbow24) }}
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
