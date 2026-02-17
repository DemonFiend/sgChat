import { For, Show, createSignal, onMount } from 'solid-js';
import { clsx } from 'clsx';
import { Avatar } from '@/components/ui';

interface Member {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  role_color?: string | null;
  custom_status?: string | null;
}

interface MemberGroup {
  name: string;
  color?: string;
  members: Member[];
  ownerId?: string;
}

interface MemberListProps {
  groups: MemberGroup[];
  ownerId?: string;
  onMemberClick?: (member: Member) => void;
}

// Owner crown icon component
function OwnerBadge() {
  return (
    <span class="flex-shrink-0 text-warning" title="Server Owner">
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/>
      </svg>
    </span>
  );
}

const MIN_WIDTH = 180; // 11.25rem
const MAX_WIDTH = 400; // 25rem
const DEFAULT_WIDTH = 240; // 15rem (w-60)
const STORAGE_KEY = 'memberListWidth';

export function MemberList(props: MemberListProps) {
  const [width, setWidth] = createSignal(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = createSignal(false);

  // Load saved width from localStorage on mount
  onMount(() => {
    const savedWidth = localStorage.getItem(STORAGE_KEY);
    if (savedWidth) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
        setWidth(parsed);
      }
    }
  });

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width();

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = startX - e.clientX; // Inverted because we're dragging from the left edge
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Save to localStorage
      localStorage.setItem(STORAGE_KEY, width().toString());
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <aside
      class="h-full bg-bg-secondary overflow-y-auto scrollbar-thin relative"
      style={{ width: `${width()}px` }}
      aria-label="Member list"
    >
      {/* Resize Handle */}
      <div
        class={clsx(
          'absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-brand-primary/50 transition-colors z-10 group',
          isResizing() && 'bg-brand-primary'
        )}
        onMouseDown={handleMouseDown}
        title="Drag to resize member list"
      >
        {/* Wider hover area for easier grabbing */}
        <div class="absolute -left-1 -right-1 top-0 bottom-0" />
      </div>
      <div class="p-2">
        <For each={props.groups}>
          {(group) => (
            <Show when={group.members.length > 0}>
              <div class="mb-4">
                <h3
                  class="px-2 mb-1 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: group.color || 'var(--color-text-muted)' }}
                >
                  {group.name} — {group.members.length}
                </h3>

                <For each={group.members}>
                  {(member) => (
                    <button
                      onClick={() => props.onMemberClick?.(member)}
                      class={clsx(
                        'flex items-center gap-3 w-full px-2 py-1.5 rounded',
                        'hover:bg-bg-modifier-hover transition-colors text-left'
                      )}
                    >
                      <Avatar
                        src={member.avatar_url}
                        alt={member.display_name || member.username}
                        size="sm"
                        status={member.status}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="text-sm font-medium truncate"
                            style={{ color: member.role_color || 'var(--color-text-primary)' }}
                          >
                            {member.display_name || member.username}
                          </span>
                          <Show when={props.ownerId === member.id}>
                            <OwnerBadge />
                          </Show>
                        </div>
                        <Show when={member.custom_status}>
                          <span class="text-xs text-text-muted truncate block">
                            {member.custom_status}
                          </span>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          )}
        </For>
      </div>
    </aside>
  );
}
