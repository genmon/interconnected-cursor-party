import * as React from "react";
import { usePresence } from "./presence-context";

const styles: Record<string, React.CSSProperties> = {
  container: {
    boxSizing: "border-box",
    padding: "8px",
    height: "calc(1.5rem + 16px)",
    position: "fixed",
    top: "12px",
    right: "18px",
    borderRadius: "24px",
    minWidth: "4.4em",
    backgroundColor: "rgba(255, 255, 255, 1)",
    border: "1px solid rgba(0, 0, 0, 1)",
    color: "black",
    display: "flex",
    justifyContent: "end",
    alignItems: "center",
    gap: "8px",
    fontFamily:
      'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
    fontWeight: 320,
  },
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    cursor: "pointer",
  },
  checkbox: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: "0",
  },
  toggleContainer: {
    position: "relative",
    width: "2.75rem",
    height: "1.5rem",
    backgroundColor: "#E5E7EB", // bg-gray-200
    borderRadius: "9999px",
    transition: "background-color 0.2s ease-in-out",
  },
  toggleContainerChecked: {
    backgroundColor: "#2563EB", // bg-blue-600
  },
  toggleHandle: {
    content: '""',
    position: "absolute",
    top: "2px",
    left: "2px",
    backgroundColor: "#FFFFFF",
    borderColor: "#D1D5DB", // border-gray-300
    borderWidth: "1px",
    borderRadius: "50%",
    height: "1.25rem",
    width: "1.25rem",
    transition: "transform 0.2s ease-in-out",
  },
  toggleHandleChecked: {
    transform: "translateX(100%)",
    borderColor: "#FFFFFF",
  },
  focusRing: {
    boxShadow: "0 0 0 2px #93C5FD", // ring-4 ring-blue-300
  },
  text: {
    marginLeft: "0.5rem",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#111827", // text-gray-900
  },
};
export default function QuietMode({
  quietMode,
  setQuietMode,
}: {
  quietMode: boolean;
  setQuietMode: (quietMode: boolean) => void;
}) {
  // We want to know whether it's busy
  const { isBusy } = usePresence((state) => {
    let isBusy = false;
    // Go through state.otherUsers.message and set isBlue to true if any of them have a non-null, non-empty message
    const otherUsers = Array.from(state.otherUsers.values());
    let showCTA = false;
    for (const user of otherUsers) {
      if (user.presence?.message) {
        isBusy = true;
        break;
      }
    }

    // Also show isBusy if there are > 10 users
    if (state.otherUsers.size > 10) {
      isBusy = true;
    }

    return {
      isBusy,
    };
  });

  const handleToggle = () => {
    setQuietMode(!quietMode);
  };

  // show quietMode EITHER if it's busy, or if quiet mode is already on
  // The quietMode button should have a nice transition between the two visibility modes
  const showQuietMode = quietMode || isBusy;
  const visibilityStyles = {
    opacity: showQuietMode ? 1 : 0,
    transition: "opacity 0.5s ease-in-out",
    pointerEvents: (showQuietMode
      ? "auto"
      : "none") as React.CSSProperties["pointerEvents"],
  };
  return (
    <div style={visibilityStyles}>
      <div style={styles.container}>
        <label style={styles.label}>
          <span style={styles.text}>Quiet mode</span>
          <input
            type="checkbox"
            checked={quietMode}
            onChange={handleToggle}
            style={styles.checkbox}
          />
          <div
            style={{
              ...styles.toggleContainer,
              ...(quietMode ? styles.toggleContainerChecked : {}),
            }}
          >
            <div
              style={{
                ...styles.toggleHandle,
                ...(quietMode ? styles.toggleHandleChecked : {}),
              }}
            />
          </div>
        </label>
      </div>
    </div>
  );
}
