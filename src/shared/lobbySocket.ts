import { Client } from "@stomp/stompjs";
import { useDiagnosticsStore } from "@/stores/diagnostics";
import { apiBaseUrl } from "./api";

/** 后端 LobbyEvent 的 JSON 形态（见 lajixia-server 仓库的 src/main/java/com/ljx/server/ws/LobbyEvent.java） */
export interface LobbyEventPayload {
  /** ANNOUNCEMENT：公告有变化，客户端收到后重新拉一次公告（其余字段为空） */
  type: "ONLINE" | "OFFLINE" | "PLAYERS" | "ANNOUNCEMENT";
  roomId: number;
  name: string;
  players: number;
  capacity: number;
  online: boolean;
  core: string;
  mcVersion: string;
  mode: string;
}

const TOPIC = "/topic/lobby";

/** 由 API 基地址推出 WebSocket 端点：http → ws、https → wss */
export function lobbySocketUrl(): string {
  return apiBaseUrl().replace(/^http/, "ws") + "/ws/lobby";
}

/**
 * 订阅大厅推送，返回断开函数。
 *
 * 后端在事务提交后才推送 ONLINE / PLAYERS / OFFLINE（`LobbyBroadcaster`），
 * 所以人数变化是**毫秒级**到达，不必等轮询。
 *
 * 调用方仍应保留一个较慢的轮询兜底：连接失败、断网或后端未升级时，
 * 轮询是唯一的数据来源（推送是尽力而为，不保证送达）。
 */
export function connectLobbySocket(
  onEvent: (event: LobbyEventPayload) => void,
): () => void {
  const client = new Client({
    brokerURL: lobbySocketUrl(),
    reconnectDelay: 5_000,
    onConnect: () => {
      useDiagnosticsStore.getState().setWs(true);
      client.subscribe(TOPIC, (message) => {
        try {
          onEvent(JSON.parse(message.body) as LobbyEventPayload);
        } catch {
          // 解析不了的帧直接忽略：推送失败不应影响界面主流程
        }
      });
    },
    onWebSocketClose: () => useDiagnosticsStore.getState().setWs(false),
    onStompError: () => useDiagnosticsStore.getState().setWs(false),
  });
  client.activate();
  return () => {
    void client.deactivate();
  };
}
