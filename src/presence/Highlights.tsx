import { useEffect, useState } from "react";
import React from "react";
import { useShallow } from "zustand/react/shallow";
import { usePresence } from "./presence-context";
import Listener from "./highlights/Listener";
import Decorator from "./highlights/Decorator";

import { getElementChecksum } from "./highlights/rangy";

export default function Highlights() {
  const { otherSelections, updatePresence } = usePresence(
    useShallow((state) => {
      return {
        otherSelections: Array.from(state.otherUsers.values())
          .filter((user) => user.presence?.selection)
          .map((user) => user.presence?.selection!),
        updatePresence: state.updatePresence,
      };
    })
  );

  // The current selection, serialized
  const [selection, setSelection] = useState<string | null>(null);
  // Store the nodes that are enabled for highlights
  const [containers, setContainers] = useState<Record<string, Element>>({});

  // Build containers
  useEffect(() => {
    const enabled = document.querySelectorAll("[data-highlights]");
    const newContainers: Record<string, Element> = {};
    for (const element of enabled) {
      const checksum: string = getElementChecksum(element);
      newContainers[checksum] = element;
    }
    //console.log(newContainers);
    setContainers(newContainers);
  }, []);

  useEffect(() => {
    updatePresence({ selection });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  return (
    <>
      <Listener containers={containers} setSelection={setSelection} />
      <Decorator containers={containers} otherSelections={otherSelections} />
    </>
  );
}
