import { create } from "zustand";
import type { JavaInstall, ServerPhase, ServerStartConfig } from "@/shared/types";
import * as tauri from "@/shared/tauri";
import { usePreferencesStore } from "@/stores/preferences";

interface ServerProcState {
  phase: ServerPhase;
  detail: string;
  javaList: JavaInstall[];
  config: ServerStartConfig;
  setPhase: (phase: ServerPhase, detail?: string) => void;
  setConfig: (config: Partial<ServerStartConfig>) => void;
  /** 从持久化偏好恢复服务端配置（工作目录依赖它，重启后必须还原） */
  hydrate: () => void;
  /** 用 Rust 侧状态校准前端：server://state 事件只在控制台挂载时被接收，
   *  切页签或从其它页拉起服务端会漏掉，漏掉后启停按钮就会与实际状态脱节 */
  refresh: () => Promise<void>;
  loadJava: () => Promise<void>;
  start: () => Promise<string | null>;
  stop: () => Promise<string | null>;
}

const DEFAULT_CONFIG: ServerStartConfig = {
  javaPath: "",
  jarPath: "",
  xmxMb: 2048,
  workDir: "",
};

export const useServerProcStore = create<ServerProcState>((set, get) => ({
  phase: "idle",
  detail: "",
  javaList: [],
  config: DEFAULT_CONFIG,
  setPhase: (phase, detail = "") => set({ phase, detail }),
  setConfig: (config) => {
    const next = { ...get().config, ...config };
    set({ config: next });
    usePreferencesStore.getState().setServerConfig(next);
  },
  hydrate: () => {
    set({ config: { ...DEFAULT_CONFIG, ...usePreferencesStore.getState().serverConfig } });
  },
  refresh: async () => {
    try {
      const status = await tauri.serverStatus();
      set({ phase: status.phase, detail: status.detail });
    } catch {
      // 查询失败就保留现值，后续事件或下一次查询会纠正
    }
  },
  loadJava: async () => {
    try {
      const javaList = await tauri.probeJava();
      set({ javaList });
      if (!get().config.javaPath && javaList.length > 0) {
        get().setConfig({ javaPath: javaList[0].path });
      }
    } catch (e) {
      set({ detail: String(e) });
    }
  },
  start: async () => {
    const { config } = get();
    if (!config.javaPath) return "请选择 Java 运行时";
    if (!config.jarPath) return "请填写服务端核心 jar 路径";
    try {
      await tauri.serverStart(config);
      return null;
    } catch (e) {
      return String(e);
    }
  },
  stop: async () => {
    try {
      await tauri.serverStop();
      return null;
    } catch (e) {
      return String(e);
    }
  },
}));
