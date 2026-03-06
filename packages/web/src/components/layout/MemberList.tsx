import { useState, useEffect, useMemo, memo } from 'react';
import { clsx } from 'clsx';
import { Avatar } from '@/components/ui/Avatar';

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
  onMemberClick?: (member: Member, rect: DOMRect) => void;
  onMemberContextMenu?: (member: Member, e: React.MouseEvent) => void;
}

function OwnerBadge() {
  return (
    <span className="flex-shrink-0 text-warning" title="Server Owner">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
      </svg>
    </span>
  );
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = 'memberListWidth';

export function MemberList({ groups, ownerId, onMemberClick, onMemberContextMenu }: MemberListProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const savedWidth = localStorage.getItem(STORAGE_KEY);
    if (savedWidth) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) setWidth(parsed);
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = startX - e.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(STORAGE_KEY, width.toString());
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
      className="h-full bg-bg-secondary overflow-y-auto scrollbar-thin relative"
      style={{ width: `${width}px` }}
      aria-label="Member list"
    >
      {/* Resize Handle */}
      <div
        className={clsx(
          'absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-brand-primary/50 transition-colors z-10 group',
          isResizing && 'bg-brand-primary'
        )}
        onMouseDown={handleMouseDown}
        title="Drag to resize member list"
      >
        <div className="absolute -left-1 -right-1 top-0 bottom-0" />
      </div>

      <div className="p-2" role="listbox" aria-label="Members">
        {/* Member Search */}
        <MemberSearch groups={groups} ownerId={ownerId} onMemberClick={onMemberClick} onMemberContextMenu={onMemberContextMenu} />
      </div>
    </aside>
  );
}

// ── Member Search ─────────────────────────────────────────
function MemberSearch({
  groups,
  ownerId,
  onMemberClick,
  onMemberContextMenu,
}: {
  groups: MemberGroup[];
  ownerId?: string;
  onMemberClick?: (member: Member, rect: DOMRect) => void;
  onMemberContextMenu?: (member: Member, e: React.MouseEvent) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        members: group.members.filter(
          (m) =>
            m.username.toLowerCase().includes(q) ||
            (m.display_name && m.display_name.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.members.length > 0);
  }, [groups, searchQuery]);

  return (
    <>
      <div className="relative mb-2">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search members"
          className="w-full bg-bg-tertiary text-text-primary text-xs placeholder:text-text-muted rounded px-2 py-1.5 pl-8 outline-none focus:ring-1 focus:ring-accent/50 transition-shadow"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {filteredGroups.map((group) => {
        if (group.members.length === 0) return null;
        return (
          <div key={group.name} className="mb-4" role="group" aria-label={`${group.name} — ${group.members.length}`}>
            <h3
              className="px-2 mb-1 text-xs font-semibold uppercase tracking-wide"
              style={{ color: group.color || 'var(--color-text-muted)' }}
            >
              {group.name} — {group.members.length}
            </h3>

            {group.members.map((member) => (
              <MemberItem
                key={member.id}
                member={member}
                isOwner={ownerId === member.id}
                onMemberClick={onMemberClick}
                onMemberContextMenu={onMemberContextMenu}
              />
            ))}
          </div>
        );
      })}

      {searchQuery && filteredGroups.length === 0 && (
        <div className="px-2 py-4 text-center text-text-muted text-xs">
          No members found
        </div>
      )}
    </>
  );
}

interface MemberItemProps {
  member: Member;
  isOwner: boolean;
  onMemberClick?: (member: Member, rect: DOMRect) => void;
  onMemberContextMenu?: (member: Member, e: React.MouseEvent) => void;
}

const MemberItem = memo(function MemberItem({ member, isOwner, onMemberClick, onMemberContextMenu }: MemberItemProps) {
  return (
    <button
      role="option"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onMemberClick?.(member, rect);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMemberContextMenu?.(member, e);
      }}
      className={clsx(
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
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="text-sm font-medium truncate"
            style={{ color: member.role_color || 'var(--color-text-primary)' }}
          >
            {member.display_name || member.username}
          </span>
          {isOwner && <OwnerBadge />}
        </div>
        {member.custom_status && (
          <span className="text-xs text-text-muted truncate block">
            {member.custom_status}
          </span>
        )}
      </div>
    </button>
  );
});
