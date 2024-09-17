import { useEffect } from "react";

import { deserializeRange } from "./rangy";

export default function Decorator({
  containers,
  otherSelections,
}: {
  containers: Record<string, Element>;
  otherSelections: string[];
}) {
  useEffect(() => {
    const ranges = [];
    for (const otherSelection of otherSelections) {
      // otherSelection is a serialized selection, with the pattern
      // serialized|serialized|serialized{checksum}
      // We need to extract the checksum and then iterate over the
      // serialized ranges
      const checksum = otherSelection.split("{")[1].split("}")[0];
      if (!containers[checksum]) continue;
      const container = containers[checksum];
      for (const serialized of otherSelection.split("{")[0].split("|")) {
        //console.log("deserializing", serialized, "in container", container);
        ranges.push(deserializeRange(serialized, container));
      }
    }
    //console.log("will decorate", ranges);

    // @ts-ignore
    CSS.highlights.clear();
    // @ts-ignore
    const highlight = new Highlight(...ranges);
    // @ts-ignore
    CSS.highlights.set("highlight-party", highlight);
  }, [otherSelections]);

  return null;
}
