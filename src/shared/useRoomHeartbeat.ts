import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDiagnosticsStore } from "@/stores/diagnostics";
import { api } from "./api";
import { useInterval } from "./useInterval";
import * as tauri from "./tauri";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 房主开服期间维持房间在线（POST /api/rooms/{id}/heartbeat）。
 * 人数与名单都取本机服务端的真实在线玩家：服务端跑在房主机器上，平台看不到它，
 * 心跳是唯一通道——此前固定上报 0，导致房间卡片与「当前加入」页永远显示 0。
 *
 * 结构上与 {@link useRoomPresence} 是同一类（进入即上报 + 定时续期 + 离开清理），
 * 两者共用 {@link useInterval} 骨架；改动其中一个时请对照另一个。
 */
export function useRoomHeartbeat(roomId: number | null, active: boolean) {
  const enabled = roomId !== null && active;

  /**
   * 读本机服务端的真实在线名单并上报。
   * **周期心跳与「玩家进出」事件补报共用这一段** —— 事件里只发空名单会让人数瞬间掉成 0。
   */
  const beat = async (targetRoomId: number) => {
    let names: string[] = [];
    try {
      names = await tauri.serverPlayerNames();
    } catch {
      // 拿不到就按空名单报，离线判定由后端超时兜底
    }
    await api
      .heartbeat(targetRoomId, names.length, names)
      .then(() => useDiagnosticsStore.getState().markHeartbeat())
      .catch(() => {
        // 心跳失败不打扰用户：离线判定由后端超时兜底
      });
  };

  // 周期心跳走公共骨架（与 useRoomPresence 同一套，改动时请同步看另一边）
  useInterval(() => beat(roomId!), HEARTBEAT_INTERVAL_MS, enabled);

  useEffect(() => {
    if (!enabled) return;
    // 玩家进出时立即补一次心跳，不必等下一个 30 秒周期
    const un = listen("server://players", () => void beat(roomId!));
    return () => {
      void un.then((f) => f());
    };
  }, [roomId, enabled]);
}
