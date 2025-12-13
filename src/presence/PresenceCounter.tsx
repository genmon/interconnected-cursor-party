import * as React from "react";
import { usePresence } from "./presence-context";

export default function PresenceCounter({
  quietMode = false,
}: {
  quietMode: boolean;
}) {
  const { myself, otherUsers, synced } = usePresence((state) => ({
    myself: state.myself,
    otherUsers: state.otherUsers,
    synced: state.synced,
  }));

  // Don't show until we've synced
  if (!synced) return null;

  // Calculate total count (including self)
  const count = myself ? otherUsers.size + 1 : otherUsers.size;

  // Match QuietMode pill proportions and styling
  const styles: React.CSSProperties = {
    boxSizing: "border-box",
    paddingTop: "8px",
    paddingBottom: "8px",
    height: "calc(1.5rem + 16px)", // 40px total - matches QuietMode
    position: "fixed",
    bottom: "12px", // Match QuietMode's 12px margin
    right: "18px", // Match QuietMode's 18px margin
    borderRadius: "24px", // Match QuietMode
    minWidth: "4.4em", // Match QuietMode
    border: "1px solid rgba(168, 162, 158, 1)", // stone-400
    color: "rgba(168, 162, 158, 1)", // stone-400
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily:
      'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
    fontSize: "0.875rem", // 14px - matches QuietMode text
    fontWeight: 500, // Match QuietMode text weight
    paddingLeft: "calc(0.5rem + 8px)",
    paddingRight: "calc(0.5rem + 8px)",
    pointerEvents: "none" as const,
    userSelect: "none" as const,
    visibility: quietMode ? ("hidden" as const) : ("visible" as const),
    zIndex: 1000,
  };

  return <div style={styles}>Here: {count}</div>;
}
