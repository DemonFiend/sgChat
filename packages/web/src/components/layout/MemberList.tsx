import { For, Show } from 'solid-js';
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

export function MemberList(props: MemberListProps) {
  return (
    <aside class="w-60 h-full bg-bg-secondary overflow-y-auto scrollbar-thin" aria-label="Member list">
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
