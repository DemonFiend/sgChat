# Login Server Popup - Task Prompts for Local AI

Copy-paste these prompts to your local AI one at a time, in order. After each task completes, run the close command before moving to the next.

---

## TASK 1: Verify Server Metadata API Contract
**Bead ID**: `sgChat-Server-606`  
**Status**: Ready (no blockers)

### Copy-Paste This:
```
Review the server metadata API to confirm it provides these fields:
- serverName (string)
- bannerUrl (string | null)
- motd (string | null)
- welcomeMessage (string | null)
- timezone (string)

Check these locations:
1. Backend API endpoints in packages/api/src/routes/servers.ts
2. Existing types in packages/shared/src/types/index.ts
3. Frontend server store in packages/web/src/stores/

Tasks:
- Verify the API endpoint returns these fields
- Add TypeScript interface ServerPopupData to packages/shared/src/types/index.ts if missing
- Document the endpoint path and response shape
- If any fields are missing, identify what needs to be added to the backend

Context: This is for a login popup that displays server info. See features/login_server_popup/overview.bead and state.bead for requirements.

After completion, run: bd update sgChat-Server-606 --close
```

---

## TASK 2: Create serverPopup Zustand Store
**Bead ID**: `sgChat-Server-xrm`  
**Status**: Ready (no blockers)

### Copy-Paste This:
```
Create a new Zustand store for managing the server welcome popup state.

Reference: features/login_server_popup/state.bead

Requirements:
1. Create packages/web/src/stores/serverPopup.ts
2. Implement state interface:
   - isVisible: boolean
   - currentServerId: string | null
   - serverData: ServerPopupData | null

3. Implement actions:
   - showPopup(serverId: string): Fetch server data and show popup
   - hidePopup(): Hide popup without marking as dismissed
   - dismissPopup(): Hide popup and save to localStorage
   - reopenPopup(): Show popup regardless of dismissal state
   - setServerData(data: ServerPopupData): Update popup content

4. LocalStorage helpers:
   - Key format: serverPopup_dismissed_${serverId}
   - Save "true" when dismissed
   - Check before showing on login

5. Export the store as useServerPopupStore

Use the existing auth store (packages/web/src/stores/auth.ts) as a reference for Zustand patterns.

After completion, run: bd update sgChat-Server-xrm --close
```

---

## TASK 3: Build ServerWelcomePopup Component
**Bead ID**: `sgChat-Server-vys`  
**Status**: Blocked (requires Task 2 complete)

### Copy-Paste This:
```
Create the UI component for the server welcome popup.

Reference: features/login_server_popup/ui.bead and architecture.bead

Requirements:
1. Create packages/web/src/components/ui/ServerWelcomePopup.tsx
2. Component structure:
   - Overlay backdrop (dark, semi-transparent)
   - Modal container (600px wide, max-height 80vh, centered)
   - Header: server name + close button (X icon)
   - Banner: full-width image (16:9 aspect, fallback to gradient)
   - Server Time Display: HH:MM:SS format, updates every second, show timezone
   - MOTD Section: "Message of the Day" label, markdown support, scrollable
   - Welcome Message Section: "Welcome!" label, markdown support

3. Use the serverPopup store (from Task 2):
   - Get state: isVisible, serverData
   - Call dismissPopup() on close button click

4. Styling:
   - Use Tailwind CSS utilities
   - Match existing theme colors
   - Fade-in animation (200ms)
   - Mobile responsive (stack vertically)

5. Handle missing data gracefully:
   - No banner → gradient placeholder
   - No MOTD → "No message of the day"
   - No welcome message → "Welcome to {serverName}!"

Use existing modal components as reference (search for Modal in packages/web/src/components/).

After completion, run: bd update sgChat-Server-vys --close
```

---

## TASK 4: Hook Popup to Auth Login Events
**Bead ID**: `sgChat-Server-585`  
**Status**: Blocked (requires Task 3 complete)

### Copy-Paste This:
```
Integrate the server welcome popup to show automatically on login.

Reference: features/login_server_popup/architecture.bead

Requirements:
1. Modify packages/web/src/layouts/MainLayout.tsx
2. Import ServerWelcomePopup component and useServerPopupStore
3. Add effect to listen for server login/switch events:
   - Use auth store to detect when user joins a server
   - Check localStorage: serverPopup_dismissed_${serverId}
   - If not dismissed, call showPopup(serverId)
   
4. Render ServerWelcomePopup at root level (above other content)

5. Handle edge cases:
   - Only show when authenticated
   - Hide popup on logout
   - Handle rapid server switching (500ms debounce)

Reference edge cases in features/login_server_popup/edge-cases.bead.

After completion, run: bd update sgChat-Server-585 --close
```

---

## TASK 5: Add Reopen Handler to ServerList
**Bead ID**: `sgChat-Server-2h6`  
**Status**: Blocked (requires Task 3 complete)

### Copy-Paste This:
```
Add click handler to server icons to reopen the welcome popup.

Reference: features/login_server_popup/reopen-logic.bead

Requirements:
1. Modify packages/web/src/components/layout/ServerList.tsx
2. Add click handler to server icon elements:
   - Left-click → call reopenPopup() from store
   - Right-click → preserve existing context menu behavior
   - Use e.stopPropagation() to prevent navigation

3. Implementation:
```typescript
const handleServerIconClick = (serverId: string, e: MouseEvent) => {
  e.stopPropagation();
  if (e.button === 2) return; // Right-click menu
  
  const { reopenPopup, currentServerId } = useServerPopupStore.getState();
  if (currentServerId === serverId) {
    reopenPopup();
  }
};
```

4. Add debouncing (300ms) to prevent rapid clicks
5. Only trigger if user is logged into that server

After completion, run: bd update sgChat-Server-2h6 --close
```

---

## TASK 6: Polish Popup Animations and Edge Cases
**Bead ID**: `sgChat-Server-7ev`  
**Status**: Blocked (requires Tasks 3, 4, 5 complete)

### Copy-Paste This:
```
Polish the popup with animations and handle all edge cases.

Reference: features/login_server_popup/edge-cases.bead and ui.bead

Requirements:
1. Add smooth animations:
   - Fade-in overlay and modal (200ms ease-in)
   - Fade-out on close (200ms ease-out)
   - Slide-up effect for modal (optional)

2. Handle edge cases from edge-cases.bead:
   - API failure → show error message with retry button
   - Missing data → show fallback content
   - User logout → immediately hide popup
   - Rapid server switching → cancel previous, debounce new
   - LocalStorage unavailable → gracefully degrade
   - Long content (>1000 chars) → scrollable with fade gradient
   - No timezone → default to UTC
   - Deleted servers → clean up orphaned localStorage entries

3. Mobile responsive:
   - Reduce width to 90vw on mobile
   - Stack sections vertically
   - Touch-friendly close button

4. Accessibility:
   - ESC key to close
   - Focus trap within modal
   - ARIA labels for screen readers

5. Test all scenarios:
   - First login (popup shows)
   - Dismiss and reload (stays dismissed)
   - Reopen via icon click
   - Switch servers
   - Missing data fields

After completion, run: bd update sgChat-Server-7ev --close
```

---

## How to Use This List

1. **Start with Task 1** - Copy the prompt and paste into your local AI
2. **Complete the task** - Let the AI implement the code
3. **Mark as complete** - Run `bd update sgChat-Server-606 --close`
4. **Move to Task 2** - Repeat the process
5. **Continue sequentially** until all tasks are done

## Check Progress Anytime
- `bd ready` - See which tasks are unblocked and ready
- `bd list` - View all tasks and their status
- `bd show <id>` - See details for a specific task

## To Close/Complete a Bead
```bash
bd update <bead-id> --close
```

Example:
```bash
bd update sgChat-Server-606 --close
```

Your local AI should understand to mark each bead as complete using the `bd update` command provided at the end of each prompt.
