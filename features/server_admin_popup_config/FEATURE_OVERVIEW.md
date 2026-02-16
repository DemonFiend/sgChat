# Server Admin Popup Configuration - Feature Overview

## What This Feature Does

The Server Admin Popup Configuration feature allows server administrators to customize a welcome popup that appears to users when they navigate to the Direct Messages (`/channels/@me`) page.

## User Experience Flow

### For Regular Users
1. **Login** → User signs in to the server
2. **Navigate to DMs** → User clicks the DM button or navigates to `/channels/@me`
3. **Popup Appears** → A styled popup displays server information, events, and messages
4. **Dismiss** → User can close the popup (dismissed state saved to localStorage)
5. **Return** → On subsequent visits, if user hasn't dismissed it manually, popup shows again

### For Administrators
1. **Access Settings** → Click server settings icon
2. **Open Popup Config Tab** → Select "Popup Config" from the sidebar
3. **Customize Content** → Configure:
   - Server name & icon
   - Banner image
   - Time format (12h/24h)
   - Message of the Day (MOTD)
   - Welcome message
   - Events list (title, time, description, color)
4. **Save** → Changes are saved to database and immediately available

## Key Components

### Backend Components
- **API Route**: `/api/server/popup-config` (GET, PUT)
  - Supports CRUD operations for popup configuration
  - Returns formatted popup data for display
- **Database**: `popup_config` JSONB column in `servers` table
- **Migration**: `001_add_popup_config.sql`

### Frontend Components
1. **ServerWelcomePopup** (`packages/web/src/components/ui/ServerWelcomePopup.tsx`)
   - Renders the popup modal with:
     - Server branding (icon, name, banner)
     - Live server time (updates every second)
     - MOTD (supports markdown)
     - Welcome message (supports markdown)
     - Events timeline with color coding
   - Features:
     - Keyboard navigation (Tab, Shift+Tab, Escape)
     - Focus trapping for accessibility
     - Smooth animations (fade in/out)
     - Error handling with retry button
     - Loading states

2. **ServerPopupConfigForm** (`packages/web/src/components/ui/ServerPopupConfigForm.tsx`)
   - Admin configuration interface
   - Form sections:
     - Basic Information (server name, icon)
     - Display Settings (banner, time format)
     - Messages (MOTD, welcome message with character limits)
     - Events (add/edit/delete events with color picker)
   - Features:
     - Unsaved changes warning
     - Character counters
     - Success/error feedback
     - Reset functionality

3. **ServerSettingsModal** (`packages/web/src/components/ui/ServerSettingsModal.tsx`)
   - Main settings modal with tabbed interface
   - Includes "Popup Config" tab (visible to admins/owners only)

### State Management
- **serverPopupStore** (`packages/web/src/stores/serverPopup.ts`)
  - Manages popup visibility state
  - Tracks dismissal state in localStorage
  - Handles API calls for popup data
  - Methods:
    - `showPopup(serverId)` - Display popup for server
    - `dismissPopup()` - Close and remember dismissal
    - `hidePopup()` - Close without remembering
    - `reopenPopup()` - Show again (clear dismissal)

- **serverConfigStore** (`packages/web/src/stores/serverConfig.ts`)
  - Manages configuration form state
  - Handles CRUD operations
  - Provides loading/error states

## Where Everything Is Located

### Popup Display Location
- **Page**: `/channels/@me` (Direct Messages page)
- **Trigger**: Automatically when authenticated user navigates to DM page
- **Timing**: 500ms debounce after navigation to prevent flickering
- **Condition**: Only shows if not previously dismissed (localStorage check)

### Configuration UI Location
- **Access Path**: Server Settings → Popup Config tab
- **Permission**: Requires `manage_server` permission (admin/owner)
- **Tab Position**: Second tab after "Overview"

## Technical Details

### Popup Behavior Logic

```typescript
// In MainLayout.tsx
createEffect(() => {
  const isAuthenticated = authStore.state().isAuthenticated;
  const isDM = isDMRoute(); // checks if path starts with '/channels/@me'
  
  if (isAuthenticated && isDM) {
    serverPopupStore.showPopup(server.id);
  }
});
```

**Key Points:**
- Only shows on `/channels/@me` route
- Does NOT show on server channel pages
- Respects user's dismissal preference (localStorage)
- Checks authentication before displaying

### Modal Centering Pattern

All modals now use consistent centering:
```tsx
<div class="flex-1 overflow-y-auto py-[60px] px-10">
  <div class="max-w-[740px] mx-auto">
    {/* Content here */}
  </div>
</div>
```

This ensures:
- Content is centered horizontally (`mx-auto`)
- Maximum width is constrained (`max-w-[740px]`)
- Content can scroll if needed (outer div has `overflow-y-auto`)
- Responsive padding

## Fixes Applied (Current Session)

### 1. **Added `.cursor/rules` to `.gitignore`**
   - Prevents Cursor IDE configuration from being committed

### 2. **Fixed Corrupted JSX in ServerSettingsModal**
   - **Issue**: Tab content rendering was broken with malformed JSX
   - **Fix**: Properly structured `<Show>` components for each tab
   - **Line**: ~250-290 in ServerSettingsModal.tsx

### 3. **Changed Popup Display Location**
   - **Old Behavior**: Popup shown on server pages, NOT on DM page
   - **New Behavior**: Popup shown on DM page (`/channels/@me`), NOT on server pages
   - **Reason**: User wants popup as a welcome/announcement when entering DMs
   - **File**: MainLayout.tsx, line ~195

### 4. **Fixed Modal Content Centering**
   - **Issue**: Modal content was left-aligned due to `max-w` directly on scroll container
   - **Fix**: Wrapped content in `<div class="max-w-[740px] mx-auto">` for proper centering
   - **Files Affected**:
     - ServerSettingsModal.tsx
     - UserSettingsModal.tsx
     - ServerPopupConfigForm.tsx (already correct)

## Database Schema

```sql
ALTER TABLE servers ADD COLUMN IF NOT EXISTS popup_config JSONB DEFAULT jsonb_build_object(
  'timeFormat', '24h',
  'events', '[]'::jsonb
);
```

### Popup Config Structure
```typescript
{
  serverName: string;
  serverIconUrl: string | null;
  bannerUrl: string | null;
  timeFormat: '12h' | '24h';
  motd: string | null;
  welcomeMessage: string | null;
  events: Array<{
    id: string;
    title: string;
    time: string; // ISO 8601 datetime
    description: string;
    color: string; // hex color
  }>;
}
```

## DM Button Behavior

**Current Implementation:**
```typescript
const handleDMClick = () => {
  navigate('/channels/@me');
};
```

The DM button correctly navigates to the DM landing page (`/channels/@me`), not to a specific DM chat. This allows the user to:
1. See their friends list
2. Choose which DM to open
3. See the welcome popup on arrival

## Deployment Instructions

These changes have been pushed to GitHub. To deploy:

```bash
# On Ubuntu server
cd /opt/sgchat/repo
git pull origin main
docker stop sgchat-api-1 && docker rm sgchat-api-1
docker build --no-cache -t sosiagaming/sgchat-api:latest -f docker/Dockerfile.api .
docker push sosiagaming/sgchat-api:latest

# Apply database migration
docker exec -i sgchat-postgres-1 psql -U sgchat -d sgchat -c "ALTER TABLE servers ADD COLUMN IF NOT EXISTS popup_config JSONB DEFAULT jsonb_build_object('timeFormat', '24h', 'events', '[]'::jsonb);"

# Then in Portainer: Stacks → sgchat → REDEPLOY
docker logs sgchat-api-1 2>&1 | head -15
```

**In Browser:**
- Press **Ctrl+Shift+R** to clear cache

## Testing Checklist

- [ ] Login and navigate to `/channels/@me`
- [ ] Verify popup appears with server information
- [ ] Close popup and verify it doesn't show again (localStorage)
- [ ] Clear localStorage and verify popup reappears
- [ ] Open Server Settings → Popup Config tab
- [ ] Modify configuration (name, MOTD, events)
- [ ] Save and verify changes persist
- [ ] Navigate to `/channels/@me` again and verify updated content
- [ ] Check that popup does NOT appear on server channel pages
- [ ] Verify modal content is centered in all settings modals

## Known Limitations

1. **Single Server Architecture**: Popup configuration is per-server (instance)
2. **localStorage Dismissal**: User dismissal is per-browser, not per-account
3. **No Analytics**: Currently no tracking of popup views/dismissals
4. **Static Events**: Events don't auto-remove after their date/time passes

## Future Enhancements

- [ ] Add role-based popup customization
- [ ] Support multiple popups with priority/scheduling
- [ ] Add rich media support (videos, embeds)
- [ ] Track analytics (views, dismissals, engagement)
- [ ] Auto-archive past events
- [ ] Add popup preview in admin panel
- [ ] Support per-channel or per-role visibility rules
