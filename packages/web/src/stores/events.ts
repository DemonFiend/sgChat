import { create } from 'zustand';
import { api } from '@/api';
import type { ServerEvent, RSVPStatus, CreateServerEventInput, UpdateServerEventInput } from '@sgchat/shared';

interface EventsState {
  events: ServerEvent[];
  currentMonth: string;
  selectedDay: number | null;
  isLoading: boolean;
  error: string | null;
  isHistory: boolean;
  serverId: string | null;
}

interface EventsActions {
  setServerId: (serverId: string) => void;
  setMonth: (month: string) => void;
  setSelectedDay: (day: number | null) => void;
  setHistory: (isHistory: boolean) => void;
  fetchEvents: (serverId: string, month: string) => Promise<void>;
  createEvent: (serverId: string, data: CreateServerEventInput) => Promise<void>;
  updateEvent: (serverId: string, eventId: string, data: UpdateServerEventInput) => Promise<void>;
  cancelEvent: (serverId: string, eventId: string) => Promise<void>;
  deleteEvent: (serverId: string, eventId: string) => Promise<void>;
  rsvpEvent: (serverId: string, eventId: string, status: RSVPStatus) => Promise<{ my_status: string; counts: { interested: number; tentative: number; not_interested: number } }>;
  invalidate: () => void;
  reset: () => void;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export const useEventsStore = create<EventsState & EventsActions>((set, get) => ({
  events: [],
  currentMonth: getCurrentMonth(),
  selectedDay: null,
  isLoading: false,
  error: null,
  isHistory: false,
  serverId: null,

  setServerId: (serverId) => set({ serverId }),

  setMonth: (month) => {
    set({ currentMonth: month, selectedDay: null });
    const { serverId } = get();
    if (serverId) get().fetchEvents(serverId, month);
  },

  setSelectedDay: (day) => set({ selectedDay: day }),

  setHistory: (isHistory) => {
    set({ isHistory });
    const { serverId, currentMonth } = get();
    if (serverId) get().fetchEvents(serverId, currentMonth);
  },

  fetchEvents: async (serverId, month) => {
    set({ isLoading: true, error: null });
    try {
      const endpoint = get().isHistory
        ? `/api/servers/${serverId}/events/history?month=${month}`
        : `/api/servers/${serverId}/events?month=${month}`;
      const data = await api.get<{ events: ServerEvent[] }>(endpoint);
      set({ events: data.events, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch events', isLoading: false });
    }
  },

  createEvent: async (serverId, data) => {
    await api.post(`/api/servers/${serverId}/events`, data);
    const { currentMonth } = get();
    await get().fetchEvents(serverId, currentMonth);
  },

  updateEvent: async (serverId, eventId, data) => {
    await api.patch(`/api/servers/${serverId}/events/${eventId}`, data);
    const { currentMonth } = get();
    await get().fetchEvents(serverId, currentMonth);
  },

  cancelEvent: async (serverId, eventId) => {
    await api.post(`/api/servers/${serverId}/events/${eventId}/cancel`);
    const { currentMonth } = get();
    await get().fetchEvents(serverId, currentMonth);
  },

  deleteEvent: async (serverId, eventId) => {
    await api.delete(`/api/servers/${serverId}/events/${eventId}`);
    const { currentMonth } = get();
    await get().fetchEvents(serverId, currentMonth);
  },

  rsvpEvent: async (serverId, eventId, status) => {
    const result = await api.put<{ my_status: string; counts: { interested: number; tentative: number; not_interested: number } }>(
      `/api/servers/${serverId}/events/${eventId}/rsvp`,
      { status },
    );
    // Update local event state
    set((state) => ({
      events: state.events.map((e) =>
        e.id === eventId
          ? { ...e, my_rsvp: status, rsvp_counts: result.counts }
          : e,
      ),
    }));
    return result;
  },

  invalidate: () => {
    const { serverId, currentMonth } = get();
    if (serverId) get().fetchEvents(serverId, currentMonth);
  },

  reset: () => set({
    events: [],
    currentMonth: getCurrentMonth(),
    selectedDay: null,
    isLoading: false,
    error: null,
    isHistory: false,
    serverId: null,
  }),
}));

export const eventsStore = {
  getState: () => useEventsStore.getState(),
  invalidate: () => useEventsStore.getState().invalidate(),
  reset: () => useEventsStore.getState().reset(),
};
