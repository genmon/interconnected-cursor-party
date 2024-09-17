/* eslint-disable @hasparus/tailwindcss/no-custom-classname */
import * as React from "react";
import { useState, useEffect } from "react";
import { usePresence } from "./presence-context";

export default function Chat() {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string>("");
  const color = usePresence((state) => state.myself?.presence.color);
  const { updatePresence, showCTA } = usePresence((state) => {
    // Go through state.otherUsers.message and set showCTA to true if any of them have a non-null, non-empty message
    const otherUsers = Array.from(state.otherUsers.values());
    let showCTA = false;
    for (const user of otherUsers) {
      if (user.presence?.message) {
        showCTA = true;
        break;
      }
    }

    return {
      updatePresence: state.updatePresence,
      showCTA,
    };
  });

  // Track window size and cursor position independently of the useCursorPresent functionality
  const [windowDimensions, setWindowDimensions] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({
        x: window.innerWidth,
        y: window.innerHeight,
      });
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Track the cursor position
  const [cursorPosition, setCursorPosition] = useState<{
    x: number;
    y: number;
  }>({ x: -1, y: -1 });
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setCursorPosition({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // We'll be updating the container styles with the cursor positions
  const [containerStyles, setContainerStyles] = useState<React.CSSProperties>(
    {}
  );
  useEffect(() => {
    if (cursorPosition.x === -1 || cursorPosition.y === -1) {
      setContainerStyles({
        position: "fixed",
        bottom: "16px",
        right: "24px",
      });
    } else {
      const top = cursorPosition.y + 8;
      const left = cursorPosition.x + 8;
      setContainerStyles({
        position: "fixed",
        top: 0,
        left: 0,
        transform: `translate(${left}px, ${top}px)`,
      });
    }
  }, [cursorPosition, windowDimensions]);

  // Create an event listener for the keyboard, with these rules
  // - if not listening and the user types '/' then start listening
  // - if listening and the user types 'Enter' then stop listening
  // - if listening and the user types 'Escape' then stop listening
  // - if listening and the user types any other key then append that key to the message
  // - if listening and the user types 'Backspace' then remove the last character from the message
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const handleKeyDown = (event: KeyboardEvent) => {
      // Reset any timeouts
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        setListening(false);
        setMessage((prev) => "");
      }, 10000);

      if (!listening) {
        if (event.key === "/") {
          setMessage((prev) => "");
          setListening(true);
        }
      } else {
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          if (event.key === "Enter") {
            setListening(false);
          } else if (event.key === "Escape") {
            setListening(false);
            setMessage((prev) => "");
          } else if (event.key === "Backspace") {
            setMessage((prev) => prev.slice(0, -1));
          } else if (event.key.length === 1) {
            setMessage((prev) => {
              return prev.length < 42 ? prev + event.key : prev;
            });
          }

          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [listening]);

  // When the message changes, send it to the server
  useEffect(() => {
    updatePresence({ message: message.length > 0 ? message : null });
  }, [message, updatePresence]);

  if (listening || message) {
    return (
      <div
        className="presence-cursor presence-cursor-chat"
        style={{
          ...containerStyles,
          ...{ "--color": color },
        }}
      >
        {message ? message : "..."}
      </div>
    );
  } else if (showCTA) {
    return (
      <div
        className="presence-cursor presence-cursor-cta"
        style={{
          ...containerStyles,
          ...{ "--color": color },
        }}
      >
        Type / to reply
      </div>
    );
  }

  return null;
}
