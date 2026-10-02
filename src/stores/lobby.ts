import { create } from "zustand";
import { api, errorText, type RoomSummaryPayload } from "@/shared/api";
import { PAGE_SIZE } from "@/shared/constants";
import type { LobbyEventPayload } from "@/shared/lobbySocket";
import { useDiagnosticsStore } from "@/stores/diagnostics";
import type { LobbyFilters, LobbyView, RoomCardData } from "@/shared/types";

interface LobbyState {
  view: LobbyView;
  filters: LobbyFilters;
  page: number;
  total: number;
  rooms: RoomCardData[];
  loading: boolean;
  error: string | null;
  setView: (view: LobbyView) => void;
  setFilters: (filters: Partial<LobbyFilters>) => void;
  setPage: (page: number) => void;
  /** silent=true 时不切换整页加载态，且失败不清空列表（用于进入大厅与定时轻刷） */
  refresh: (silent?: boolean) => Promise<void>;
  /** 最近一条大厅推送事件：房间详情页据此即时刷新（见 useRoomDetail） */
  lastRoomEvent: LobbyEventPayload | null;
  /** 应用一条推送事件：只更新对应房间的那张卡片，不整列表重拉 */
  applyEvent: (event: LobbyEventPayload) => void;
}

const DEFAULT_FILTERS: LobbyFilters = { mcVersion: "", mode: "", keyword: "" };

function toRoomCard(payload: RoomSummaryPayload): RoomCardData {
  return {
    id: payload.id,
    name: payload.name,
    players: payload.players,
    capacity: payload.capacity,
    vip: payload.vip > 0 ? payload.vip : null,
    border: payload.border ? payload.border : null,
    topCard: payload.topCard,
    online: payload.online,
    core: payload.core,
    mcVersion: payload.mcVersion,
    mode: payload.mode,
    cover: payload.cover,
  };
}

export const useLobbyStore = create<LobbyState>((set, get) => ({
  view: "all",
  filters: DEFAULT_FILTERS,
  page: 1,
  total: 1,
  rooms: [],
  loading: false,
  error: null,

  setView: (view) => {
    set({ view, page: 1 });
    void get().refresh();
  },
  setFilters: (filters) => {
    set({ filters: { ...get().filters, ...filters }, page: 1 });
    void get().refresh();
  },
  setPage: (page) => {
    set({ page });
    void get().refresh();
  },
  refresh: async (silent = false) => {
    const { view, filters, page } = get();
    if (silent) {
      set({ error: null });
    } else {
      set({ loading: true, error: null });
    }
    try {
      const result = await api.rooms({
        view,
        mcVersion: filters.mcVersion || undefined,
        mode: filters.mode || undefined,
        q: filters.keyword || undefined,
        page,
        size: PAGE_SIZE,
      });
      const total = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      set({
        rooms: result.items.map(toRoomCard),
        page: Math.min(page, total),
        total,
        loading: false,
      });
      useDiagnosticsStore.getState().markLobbyRefresh();
    } catch (e) {
      // 静默刷新失败时保留已有列表，避免一次网络抖动把大厅清空
      set(silent
        ? { loading: false, error: errorText(e) }
        : { rooms: [], total: 1, loading: false, error: errorText(e) });
    }
  },
  lastRoomEvent: null,
  applyEvent: (event) =>
    set((s) => ({
      // 只替换命中的那张卡片：卡片字段与推送事件同源，不需要回查详情
      rooms: s.rooms.map((room) =>
        room.id === event.roomId
          ? {
              ...room,
              players: event.players,
              capacity: event.capacity,
              online: event.online,
              core: event.core,
              mcVersion: event.mcVersion,
              mode: event.mode,
            }
          : room,
      ),
      lastRoomEvent: event,
    })),
}));