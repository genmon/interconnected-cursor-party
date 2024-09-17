import { useEffect } from "react";

import {
  getAllRangesForSelection,
  isOrIsAncestorOf,
  serializeSelection,
} from "./rangy";

export default function Listener({
  containers,
  setSelection,
}: {
  containers: Record<string, Element>;
  setSelection: (selection: string | null) => void;
}) {
  const getContainer = (selection: Selection) => {
    for (const range of getAllRangesForSelection(selection)) {
      for (const element of Object.values(containers)) {
        if (isOrIsAncestorOf(element, range.commonAncestorContainer)) {
          return element;
        }
      }
    }
    return null;
  };

  const isEntirelyContained = (selection: Selection, element: Element) => {
    for (const range of getAllRangesForSelection(selection)) {
      if (!isOrIsAncestorOf(element, range.commonAncestorContainer)) {
        return false;
      }
    }
    return true;
  };

  useEffect(() => {
    if (Object.keys(containers).length === 0) return;

    const handleSelectionChange = () => {
      const selection = getSelection();
      if (!selection) {
        //console.log("no selection");
        setSelection(null);
        return;
      }
      if (selection.isCollapsed) {
        //console.log("selection collapsed");
        setSelection(null);
        return;
      }
      const container = getContainer(selection);
      if (!container) {
        //console.log("no container");
        setSelection(null);
        return;
      }
      if (!isEntirelyContained(selection, container)) {
        //console.log("selection not contained");
        setSelection(null);
        return;
      }
      const serialized = serializeSelection(
        selection,
        false, // include checksum
        container
      );
      setSelection(serialized);
      //console.log("selection changed", serialized);
    };
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [containers]);

  return null;
}
