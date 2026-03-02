import { createContext, useContext } from 'react';

export interface MentionMember {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role_color?: string | null;
}

export interface MentionChannel {
  name: string;
  type: string;
}

export interface MentionRole {
  name: string;
  color: string | null;
}

export interface MentionContextValue {
  members: Map<string, MentionMember>;
  channels: Map<string, MentionChannel>;
  roles: Map<string, MentionRole>;
  serverTimezone?: string;
  currentUserId?: string;
  onUserClick?: (userId: string, rect: DOMRect) => void;
  onChannelClick?: (channelId: string) => void;
  onMOTDClick?: () => void;
}

const MentionContext = createContext<MentionContextValue>({
  members: new Map(),
  channels: new Map(),
  roles: new Map(),
});

export const MentionProvider = MentionContext.Provider;
export const useMentionContext = () => useContext(MentionContext);
