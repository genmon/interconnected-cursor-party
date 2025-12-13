# Presence Counter Implementation Plan

## Overview

Add a presence counter badge showing the number of currently connected users in the bottom-right corner of the page.

**Design Reference:**
```html
<div
  class="fixed right-2 bottom-2 rounded-full outline outline-1 outline-stone-400
         text-xs text-stone-400 px-2 py-1 font-sans"
>
  Here: {this.connectionsCount}
</div>
```

## Design Decisions

- **Always show** - Display even when alone (provides feedback that it's working)
- **Label:** "Here: {count}" - Exactly as shown in reference
- **Styling:** Match reference exactly (Tailwind classes converted to inline styles)
- **No tooltip** - Keep it simple
- **Quiet mode:** Hide counter when quiet mode is active

## Architecture Analysis

### Current State Management

**Available Data from `usePresence()` store:**
- `myself: User | null` - Current user's data
- `otherUsers: Map<string, User>` - All other connected users
- `synced: boolean` - Whether initial sync has completed

**Count Calculation:**
```typescript
const count = myself ? otherUsers.size + 1 : otherUsers.size;
```

**No additional state management needed** - all data is already available in the Zustand store.

## Implementation Plan

### Step 1: Create PresenceCounter Component

**File:** `src/presence/PresenceCounter.tsx` (new file)

```typescript
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

  // Tailwind classes converted to inline styles
  // fixed right-2 bottom-2 rounded-full outline outline-1 outline-stone-400
  // text-xs text-stone-400 px-2 py-1 font-sans
  const styles: React.CSSProperties = {
    position: "fixed",
    right: "8px",  // right-2 = 0.5rem = 8px
    bottom: "8px", // bottom-2 = 0.5rem = 8px
    borderRadius: "9999px", // rounded-full
    outline: "1px solid rgba(168, 162, 158, 1)", // outline outline-1 outline-stone-400
    fontSize: "12px", // text-xs
    color: "rgba(168, 162, 158, 1)", // text-stone-400
    paddingLeft: "8px",  // px-2 = 0.5rem = 8px
    paddingRight: "8px",
    paddingTop: "4px",   // py-1 = 0.25rem = 4px
    paddingBottom: "4px",
    fontFamily: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', // font-sans
    pointerEvents: "none" as const,
    userSelect: "none" as const,
    visibility: (quietMode ? "hidden" : "visible") as const,
    zIndex: 1000,
  };

  return <div style={styles}>Here: {count}</div>;
}
```

### Step 2: Add to Main Cursors Component

**File:** `src/presence/Cursors.tsx`

```typescript
import * as React from "react";
import useCursorTracking from "./use-cursors";
import OtherCursors from "./other-cursors";
import Chat from "./Chat";
import Highlights from "./Highlights";
import QuietMode from "./QuietMode";
import PresenceCounter from "./PresenceCounter"; // NEW

const ENABLE_CHAT = true;
const ENABLE_HIGHLIGHTS = true;
const ENABLE_PRESENCE_COUNTER = true; // NEW

export default function Cursors() {
  useCursorTracking("document");
  const [quietMode, setQuietMode] = React.useState(false);

  return (
    <>
      <OtherCursors showChat={ENABLE_CHAT} quietMode={quietMode} />
      {!quietMode && ENABLE_CHAT && <Chat />}
      {!quietMode && ENABLE_HIGHLIGHTS && <Highlights />}
      <QuietMode quietMode={quietMode} setQuietMode={setQuietMode} />
      {ENABLE_PRESENCE_COUNTER && <PresenceCounter quietMode={quietMode} />} {/* NEW */}
    </>
  );
}
```

## Advanced Features (Optional - Not Recommended)

These features would add complexity without clear user benefit. Keep it simple.

## Testing Plan

### Manual Testing

1. **Basic Display:**
   - [ ] Counter appears in bottom-right corner
   - [ ] Shows correct count (including self)
   - [ ] Tooltip shows room ID on hover

2. **Dynamic Updates:**
   - [ ] Count increases when new user joins (open new tab)
   - [ ] Count decreases when user leaves (close tab)
   - [ ] Updates in real-time

3. **Quiet Mode:**
   - [ ] Counter hides when quiet mode is active
   - [ ] Counter reappears when quiet mode is disabled

4. **Edge Cases:**
   - [ ] Works when you're the only user (shows "Here: 1")
   - [ ] Works on initial page load (waits for sync)
   - [ ] Handles network disconnections gracefully

5. **Styling:**
   - [ ] Matches design reference
   - [ ] Readable on different backgrounds
   - [ ] Doesn't overlap with other UI elements (chat, quiet mode button)

6. **Cross-browser:**
   - [ ] Chrome/Edge
   - [ ] Firefox
   - [ ] Safari
   - [ ] Mobile browsers

### Potential Issues

1. **Z-index conflicts:**
   - Chat component uses `zIndex: 1001` for active cursors
   - Counter should be below cursors but above page content
   - Solution: Use `zIndex: 1000`

2. **Position conflicts:**
   - Counter is bottom-right (`right: 8px, bottom: 8px`)
   - Chat can appear bottom-right when docked (`bottom: 24px, right: 32px`)
   - May overlap when chat is docked
   - Solution: Accept the overlap (chat is only visible when active) or test and adjust if needed

3. **Visibility on different backgrounds:**
   - Stone-400 color might not be visible on all backgrounds
   - No background in reference design, so may need adjustment based on testing

## Implementation Checklist

### Core Implementation
- [ ] Create `src/presence/PresenceCounter.tsx`
- [ ] Add counter to `src/presence/Cursors.tsx`
- [ ] Add feature flag `ENABLE_PRESENCE_COUNTER = true`
- [ ] Test basic functionality

### Testing
- [ ] Test with 1 user (shows "Here: 1")
- [ ] Test with 2+ users (open new tabs)
- [ ] Test quiet mode hides counter
- [ ] Test on different screen sizes
- [ ] Verify no console errors

## File Changes Summary

### New Files
- `src/presence/PresenceCounter.tsx` (new component)

### Modified Files
- `src/presence/Cursors.tsx` (add counter to render)

### No Changes Needed
- All existing files - no context or store changes required

## Estimated Time

- Implementation: **15 minutes**
- Testing: **10 minutes**
- **Total: ~25 minutes**
