import * as React from "react";
import useCursorTracking from "./use-cursors";
import OtherCursors from "./other-cursors";
import Chat from "./Chat";
import Highlights from "./Highlights";
import QuietMode from "./QuietMode";
import PresenceCounter from "./PresenceCounter";

const ENABLE_CHAT = true;
const ENABLE_HIGHLIGHTS = true;
const ENABLE_PRESENCE_COUNTER = true;

export default function Cursors() {
  useCursorTracking("document");
  const [quietMode, setQuietMode] = React.useState(false);

  return (
    <>
      <OtherCursors showChat={ENABLE_CHAT} quietMode={quietMode} />
      {!quietMode && ENABLE_CHAT && <Chat />}
      {!quietMode && ENABLE_HIGHLIGHTS && <Highlights />}
      <QuietMode quietMode={quietMode} setQuietMode={setQuietMode} />
      {ENABLE_PRESENCE_COUNTER && <PresenceCounter quietMode={quietMode} />}
    </>
  );
}
