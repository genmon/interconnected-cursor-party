# Code Modernization & Improvement Suggestions

## High Priority

### 1. **Critical: Missing useEffect Dependencies**
**Location:** `src/presence/use-cursors.tsx:193-205`

```typescript
// Current - runs on EVERY render!
useEffect(() => {
  const myselfTransformed = myself ? transformCursor(myself) : null;
  // ...
});

// Should be:
useEffect(() => {
  const myselfTransformed = myself ? transformCursor(myself) : null;
  // ...
}, [myId, myself, otherUsers, within, windowDimensions, scrollDimensions]);
```

**Impact:** Performance issue - transforms cursors on every render instead of only when data changes.

### 2. **Memory Leak: setInterval Not Cleared**
**Location:** `src/server.ts:186-194`

The `setInterval` in `scheduleBroadcast()` is cleared inside its own callback, but if the object is destroyed before the interval fires, it leaks.

```typescript
// Better approach:
private broadcastTimeout: ReturnType<typeof setTimeout> | null = null;

async scheduleBroadcast() {
  if (this.broadcastTimeout) return;

  const now = Date.now();
  const ago = now - this.lastBroadcast;

  if (ago >= BROADCAST_INTERVAL) {
    this._broadcast();
  } else {
    this.broadcastTimeout = setTimeout(() => {
      this._broadcast();
      this.broadcastTimeout = null;
    }, BROADCAST_INTERVAL - ago);
  }
}
```

### 3. **WebSocket Reconnection Logic**
**Location:** `src/presence/presence-context.tsx`

The client doesn't handle reconnections when the WebSocket disconnects. Users lose cursors on network hiccups.

```typescript
// Add to usePartySocket options:
{
  onClose: (e) => {
    console.warn("Socket closed, will reconnect:", e.reason);
    // partysocket should auto-reconnect, but handle state reset
  },
  onOpen: () => {
    // Resend initial presence on reconnect
    if (synced && socket) {
      socket.send(encodeClientMessage({
        type: "update",
        presence: props.presence
      }));
    }
  }
}
```

## Medium Priority

### 4. **React Import Modernization**
**Location:** Multiple files

```typescript
// Old style:
import * as React from "react";
import { useState, useEffect } from "react";

// Modern style:
import { useState, useEffect } from "react";
```

Files to update:
- `src/cursors.tsx`
- `src/presence/use-cursors.tsx`
- `src/presence/cursor.tsx`
- `src/presence/other-cursors.tsx`
- `src/presence/Chat.tsx`
- `src/presence/Cursors.tsx`

### 5. **Performance: Throttle Cursor Updates**
**Location:** `src/presence/use-cursors.tsx:145-174`

Cursor position updates fire on every mousemove (potentially 100+ times/sec). Should throttle to ~30-60fps.

```typescript
import { throttle } from 'lodash-es'; // or implement custom

const throttledUpdate = useMemo(
  () => throttle((cursor: Cursor) => {
    updatePresence({ cursor });
  }, 16), // ~60fps
  [updatePresence]
);

useEffect(() => {
  // ...
  throttledUpdate(cursor);
}, [/* ... */]);
```

### 6. **Memoize Cursor Components**
**Location:** `src/presence/cursor.tsx`

Cursors re-render even when their props haven't changed.

```typescript
import { memo } from "react";

export default memo(function Cursor(props: {
  userId: string;
  fill: string;
  showChat: boolean;
}) {
  // ...
}, (prev, next) => {
  // Custom comparison if needed
  return prev.userId === next.userId &&
         prev.fill === next.fill &&
         prev.showChat === next.showChat;
});
```

### 7. **Remove Zustand Store Duplication**
**Location:** `src/presence/use-cursors.tsx` and `src/presence/presence-context.tsx`

Two separate stores (`usePresence` and `usePresenceWithCursors`) maintain duplicate state. Consider:

```typescript
// Extend usePresence to include transformed cursors
export const usePresence = create<PresenceStoreType>((set, get) => ({
  // ... existing state
  getTransformedCursors: (bounds: { x: number; y: number }) => {
    const state = get();
    // Transform cursors on-demand instead of storing transformed versions
  }
}));
```

### 8. **TypeScript: Enable Strict Null Checks**
**Location:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

This will catch bugs where `user?.presence?.cursor` might be undefined.

### 9. **Remove Commented Code**
**Location:** Multiple files

```typescript
// src/presence/cursor.tsx:43-46
/*const styles = {
  opacity: 1.0,
  zIndex: 1001,
};*/

// src/server.ts:120,166,215
//console.log("onConnect", this.party.id, connection.id, request.cf?.country);
```

Delete these instead of leaving them commented.

### 10. **Extract Magic Numbers**
**Location:** Multiple files

```typescript
// src/presence/Chat.tsx
const CHAT_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_LENGTH = 42;

// src/server.ts
const BROADCAST_INTERVAL_MS = 1000 / 60; // 60fps

// src/presence/cursor.tsx
const CURSOR_OFFSET_PX = 10;
```

## Low Priority / Nice to Have

### 11. **Add Error Boundaries**
**Location:** `src/cursors.tsx`

```typescript
class CursorErrorBoundary extends React.Component {
  componentDidCatch(error: Error) {
    console.error('Cursor Party error:', error);
    // Optionally report to error tracking service
  }

  render() {
    return this.props.children;
  }
}

function App() {
  return (
    <CursorErrorBoundary>
      <PresenceProvider>
        <Cursors />
      </PresenceProvider>
    </CursorErrorBoundary>
  );
}
```

### 12. **Input Sanitization for Chat**
**Location:** `src/presence/Chat.tsx:160-163`

```typescript
// Current allows any characters
if (event.key.length === 1) {
  setMessage((prev) => prev.length < 42 ? prev + event.key : prev);
}

// Better: sanitize input
const ALLOWED_CHARS = /^[\w\s.,!?@#$%&*()-+=]$/;
if (event.key.length === 1 && ALLOWED_CHARS.test(event.key)) {
  setMessage((prev) => prev.length < MAX_MESSAGE_LENGTH
    ? prev + event.key
    : prev
  );
}
```

### 13. **Rate Limiting on WebSocket Messages**
**Location:** `src/server.ts`

Add per-connection rate limiting to prevent abuse:

```typescript
export default class PresenceServer extends Server {
  private rateLimits = new Map<string, { count: number; resetAt: number }>();

  onMessage(connection: ConnectionWithUser, message: ...) {
    // Check rate limit (e.g., 60 messages per second)
    const limit = this.rateLimits.get(connection.id);
    const now = Date.now();

    if (limit) {
      if (now > limit.resetAt) {
        limit.count = 1;
        limit.resetAt = now + 1000;
      } else if (limit.count >= 60) {
        return; // Rate limited
      } else {
        limit.count++;
      }
    } else {
      this.rateLimits.set(connection.id, { count: 1, resetAt: now + 1000 });
    }

    // ... existing logic
  }
}
```

### 14. **CORS Configuration**
**Location:** `src/server.ts:22-27`

```typescript
// Current - allows all origins
const CORS = {
  "Access-Control-Allow-Origin": "*",
};

// Better - use WEBSITES allowlist
const CORS = (origin: string | null, allowedPatterns: string[]) => {
  // Check if origin matches WEBSITES patterns
  const allowed = origin && allowedPatterns.some(pattern =>
    new URLPattern(pattern).test(origin)
  );

  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Credentials": allowed ? "true" : "false",
  };
};
```

### 15. **Use React 18 Features**
**Location:** `src/cursors.tsx`

```typescript
// Current uses deprecated ReactDOM.render
import { render } from "react-dom";
render(<App />, cursorsRoot);

// Use React 18 createRoot
import { createRoot } from "react-dom/client";
const root = createRoot(cursorsRoot);
root.render(<App />);
```

### 16. **Touch Event Optimization**
**Location:** `src/presence/use-cursors.tsx:91-113`

Only add touch listeners on touch-capable devices:

```typescript
useEffect(() => {
  const isTouchDevice = 'ontouchstart' in window;

  window.addEventListener("mousemove", onMouseMove);

  if (isTouchDevice) {
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
  }

  return () => {
    window.removeEventListener("mousemove", onMouseMove);
    if (isTouchDevice) {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    }
  };
}, [within]);
```

### 17. **Build Script Error Handling**
**Location:** `scripts/build-client.mjs`

```javascript
// Add validation for environment variables
if (process.env.WEBSITES) {
  try {
    const websites = JSON.parse(process.env.WEBSITES);
    if (!Array.isArray(websites)) {
      throw new Error('WEBSITES must be a JSON array');
    }
    // Validate each pattern
    websites.forEach(site => {
      try {
        new URLPattern(site);
      } catch (e) {
        throw new Error(`Invalid URL pattern: ${site}`);
      }
    });
  } catch (error) {
    console.error('❌ Invalid WEBSITES configuration:', error.message);
    process.exit(1);
  }
}
```

### 18. **Add Logging Infrastructure**
**Location:** New file `src/utils/logger.ts`

```typescript
const DEBUG = process.env.NODE_ENV !== 'production';

export const logger = {
  debug: (...args: any[]) => DEBUG && console.log('[Cursor Party]', ...args),
  info: (...args: any[]) => console.info('[Cursor Party]', ...args),
  warn: (...args: any[]) => console.warn('[Cursor Party]', ...args),
  error: (...args: any[]) => console.error('[Cursor Party]', ...args),
};
```

### 19. **Dependency Updates**
**Location:** `package.json`

```bash
# Check for updates
npm outdated

# Notable updates to consider:
# - esbuild: ^0.27.1 → ^0.24.0 (latest)
# - zustand: ^4.4.7 → ^5.0.0 (breaking changes, review first)
# - @types/react: ^18.2.42 → ^18.3.x (latest)
```

### 20. **Add JSDoc for Public APIs**
**Location:** `src/presence/presence-context.tsx`

```typescript
/**
 * Provider component for multiplayer cursor presence.
 *
 * @param host - The PartyKit/Worker host URL
 * @param room - Unique room identifier (typically base64 encoded page URL)
 * @param presence - Initial presence state (name, color)
 * @param children - React children to render
 *
 * @example
 * ```tsx
 * <PresenceProvider
 *   host="cursor-party.workers.dev"
 *   room={btoa(window.location.href)}
 *   presence={{ name: "Anonymous", color: "#0000f0" }}
 * >
 *   <Cursors />
 * </PresenceProvider>
 * ```
 */
export default function PresenceProvider(props: { ... }) {
  // ...
}
```

## Architecture Improvements

### 21. **Separate Concerns**
Consider splitting `use-cursors.tsx` into:
- `hooks/useCursorTracking.ts` - Pure cursor position tracking
- `hooks/useCursorTransform.ts` - Transform logic
- `hooks/useWindowDimensions.ts` - Reusable dimension tracking

### 22. **Feature Flags**
Instead of `ENABLE_CHAT` and `ENABLE_HIGHLIGHTS` constants, use runtime configuration:

```typescript
// src/config.ts
export const config = {
  features: {
    chat: import.meta.env.VITE_ENABLE_CHAT !== 'false',
    highlights: import.meta.env.VITE_ENABLE_HIGHLIGHTS !== 'false',
  }
};
```

### 23. **Observability**
Add performance monitoring:

```typescript
// Track WebSocket latency
const start = performance.now();
socket.send(message);
socket.addEventListener('message', (event) => {
  const latency = performance.now() - start;
  if (latency > 100) {
    logger.warn('High latency:', latency);
  }
});
```

## Testing Suggestions

### 24. **Add Unit Tests**
Consider adding:
- Vitest for unit tests
- Testing Library for React components
- Mock WebSocket for presence tests

### 25. **Add E2E Tests**
Consider Playwright for testing:
- Multi-cursor interactions
- Chat functionality
- Reconnection behavior

## Documentation

### 26. **API Documentation**
Create `API.md` documenting:
- WebSocket message format
- Presence schema
- Client-side hooks
- Customization options

### 27. **Performance Guide**
Document performance characteristics:
- Expected WebSocket message rate
- Browser/device recommendations
- Scaling limits (how many concurrent cursors)

## Presence Counter Optional Features

These were suggested for the presence counter but deemed unnecessary complexity:

### 28. **Animated Count Changes**
Add scale animation when count changes:
```typescript
const [prevCount, setPrevCount] = useState(count);
const [isAnimating, setIsAnimating] = useState(false);

useEffect(() => {
  if (count !== prevCount) {
    setIsAnimating(true);
    setPrevCount(count);
    setTimeout(() => setIsAnimating(false), 300);
  }
}, [count, prevCount]);

const styles: React.CSSProperties = {
  // ... existing styles
  transform: isAnimating ? "scale(1.1)" : "scale(1)",
  transition: "transform 0.3s ease-out",
};
```

### 29. **Expandable User List**
Show list of users on hover:
```typescript
const [isExpanded, setIsExpanded] = useState(false);

return (
  <div
    onMouseEnter={() => setIsExpanded(true)}
    onMouseLeave={() => setIsExpanded(false)}
  >
    {isExpanded ? (
      <div>
        <div>Here: {count}</div>
        <ul>
          {Array.from(otherUsers.values()).map((user, i) => (
            <li key={i}>{user.presence.name}</li>
          ))}
        </ul>
      </div>
    ) : (
      `Here: ${count}`
    )}
  </div>
);
```

### 30. **Country Flags Display**
Show country flags of connected users:
```typescript
import countryCodeEmoji from "./country-code-emoji";

const flags = Array.from(otherUsers.values())
  .map(user => user.metadata.country)
  .filter(Boolean)
  .map(country => countryCodeEmoji(country!))
  .slice(0, 3);

return (
  <div>
    {flags.length > 0 && <span>{flags.join(" ")}</span>}
    Here: {count}
  </div>
);
```

### 31. **Click to Copy Room URL**
Copy current page URL to clipboard:
```typescript
const [copied, setCopied] = useState(false);

const handleClick = () => {
  navigator.clipboard.writeText(window.location.href);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
};

return (
  <div
    style={{ cursor: "pointer", pointerEvents: "auto" }}
    title={copied ? "Copied!" : "Click to copy URL"}
    onClick={handleClick}
  >
    Here: {count}
  </div>
);
```

**Recommendation:** None of these add significant value and increase complexity. Keep the counter simple.

---

## Priority Implementation Order

1. Fix missing useEffect dependencies (#1)
2. Fix memory leak (#2)
3. Add WebSocket reconnection (#3)
4. Modernize React imports (#4)
5. Throttle cursor updates (#5)
6. Everything else as time permits

## Estimated Impact

- **High Impact**: #1, #2, #3, #5 (performance & stability)
- **Medium Impact**: #4, #6, #7, #13 (code quality & security)
- **Low Impact**: Everything else (polish & maintainability)
