import { useCallback, useEffect, useState } from "react";
import { api, errorText, type RoomDetailPayload } from "./api";
import { useLobbyStore } from "@/stores/lobby";

/**
 * 房间详情：GET /api/rooms/{id}，roomId 变化时自动重取。
 * pollMs > 0 时按该周期静默刷新：在线人数与名单由房主心跳驱动，
 * 不轮询的话「当前加入」页会一直停在进房那一刻的快照。
 */
export function useRoomDetail(roomId: number | null, pollMs = 0) {
  const [detail, setDetail] = useState<RoomDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (quiet: boolean) => {
      if (roomId === null) {
        setDetail(null);
        setError(null);
        return;
      }
      if (!quiet) setLoading(true);
      setError(null);
      try {
        setDetail(await api.roomDetail(roomId));
      } catch (e) {
        // 静默轮询失败时保留已有详情，别让一次网络抖动把整页清空
        if (!quiet) setDetail(null);
        setError(errorText(e));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [roomId],
  );

  const reload = useCallback(() => load(false), [load]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const timer = window.setInterval(() => void load(true), pollMs);
    return () => window.clearInterval(timer);
  }, [load, pollMs]);

  // 大厅推送命中当前房间时立即静默刷新：人数与「等待/游戏中」是毫秒级事件，
  // 没必要等下一次轮询（轮询保留，作为连接不可用时的兜底）
  const lastRoomEvent = useLobbyStore((s) => s.lastRoomEvent);
  useEffect(() => {
    if (lastRoomEvent && lastRoomEvent.roomId === roomId) void load(true);
  }, [lastRoomEvent, roomId, load]);

  return { detail, error, loading, reload };
}