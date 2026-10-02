import { create } from "zustand";

/**
 * 链路诊断状态：记录**每个环节最后一次成功的时间**。
 *
 * 「人数不对」这条链路上有 6 环（服务端日志 → 房主解析 → 心跳上报 → 平台存储 → 推送/轮询 → 展示），
 * 任一环断掉的表现都一样。设置里的「诊断」区块据此显示各环状态，
 * 一眼就能看出卡在哪一环，不必再逐个环节复现。
 */
interface DiagnosticsState {
  /** 大厅推送（WebSocket）是否已连接，以及状态最后变化的时间 */
  wsConnected: boolean;
  wsChangedAt: number | null;
  /** 最近一次成员上报（presence）成功：时间 / 房间 / 后端返回的成员数 */
  presenceAt: number | null;
  presenceRoomId: number | null;
  presenceMemberCount: number | null;
  /** 最近一次房间心跳上报成功（房主端维持房间在线） */
  heartbeatAt: number | null;
  /** 最近一次大厅列表拉取成功（推送之外的兜底来源） */
  lobbyRefreshAt: number | null;
  setWs: (connected: boolean) => void;
  markPresence: (roomId: number, memberCount: number) => void;
  markHeartbeat: () => void;
  markLobbyRefresh: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  wsConnected: false,
  wsChangedAt: null,
  presenceAt: null,
  presenceRoomId: null,
  presenceMemberCount: null,
  heartbeatAt: null,
  lobbyRefreshAt: null,
  setWs: (connected) => set({ wsConnected: connected, wsChangedAt: Date.now() }),
  markPresence: (roomId, memberCount) =>
    set({ presenceAt: Date.now(), presenceRoomId: roomId, presenceMemberCount: memberCount }),
  markHeartbeat: () => set({ heartbeatAt: Date.now() }),
  markLobbyRefresh: () => set({ lobbyRefreshAt: Date.now() }),
}));

/** 相对时间文案：刚刚 / N 秒前 / N 分钟前 / N 小时前 / 从未 */
export function sinceText(at: number | null): string {
  if (at === null) return "从未";
  const sec = Math.floor((Date.now() - at) / 1000);
  if (sec < 2) return "刚刚";
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  return `${Math.floor(sec / 3600)} 小时前`;
}
