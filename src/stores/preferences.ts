import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import type { ServerStartConfig } from "@/shared/types";

export const DEFAULT_SERVER_ADDRESS = "127.0.0.1";

/** 服务端启动配置默认值；持久化后重启仍能定位房间工作目录 */
export const DEFAULT_SERVER_CONFIG: ServerStartConfig = {
  javaPath: "",
  jarPath: "",
  xmxMb: 2048,
  workDir: "",
};

const STORE_FILE = "preferences.json";
const KEY_SERVER_ADDRESS = "serverAddress";
const KEY_REMEMBER_PASSWORD = "rememberPassword";
const KEY_LAST_USERNAME = "lastUsername";
const KEY_SERVER_CONFIG = "serverConfig";

interface PersistedPrefs {
  serverAddress: string | null;
  rememberPassword: boolean | null;
  lastUsername: string | null;
  serverConfig: ServerStartConfig | null;
}

function parseServerConfig(raw: string | null): ServerStartConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServerStartConfig>;
    return { ...DEFAULT_SERVER_CONFIG, ...parsed };
  } catch {
    return null;
  }
}

async function readPersisted(): Promise<PersistedPrefs> {
  try {
    const store = await load(STORE_FILE, { autoSave: true });
    return {
      serverAddress: (await store.get<string>(KEY_SERVER_ADDRESS)) ?? null,
      rememberPassword: (await store.get<boolean>(KEY_REMEMBER_PASSWORD)) ?? null,
      lastUsername: (await store.get<string>(KEY_LAST_USERNAME)) ?? null,
      serverConfig: (await store.get<ServerStartConfig>(KEY_SERVER_CONFIG)) ?? null,
    };
  } catch {
    // 浏览器预览环境无 tauri-plugin-store，退回 localStorage
    const remembered = localStorage.getItem(KEY_REMEMBER_PASSWORD);
    return {
      serverAddress: localStorage.getItem(KEY_SERVER_ADDRESS),
      rememberPassword: remembered === null ? null : remembered === "true",
      lastUsername: localStorage.getItem(KEY_LAST_USERNAME),
      serverConfig: parseServerConfig(localStorage.getItem(KEY_SERVER_CONFIG)),
    };
  }
}

async function persist(key: string, value: string | boolean | ServerStartConfig): Promise<void> {
  try {
    const store = await load(STORE_FILE, { autoSave: true });
    await store.set(key, value);
  } catch {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
}

interface PreferencesState {
  soundOn: boolean;
  /** 勾选后令牌落盘，重启仍保持登录；不勾选则每次启动需重新登录 */
  rememberPassword: boolean;
  lastUsername: string;
  serverAddress: string;
  /** 服务端启动配置；同时决定房间工作目录（快照 / 配置编辑 / 危险区） */
  serverConfig: ServerStartConfig;
  setSoundOn: (on: boolean) => void;
  setRememberPassword: (on: boolean) => void;
  setLastUsername: (username: string) => void;
  setServerAddress: (addr: string) => void;
  setServerConfig: (config: ServerStartConfig) => void;
  init: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  soundOn: true,
  rememberPassword: false,
  lastUsername: "",
  serverAddress: DEFAULT_SERVER_ADDRESS,
  serverConfig: DEFAULT_SERVER_CONFIG,
  setSoundOn: (on) => set({ soundOn: on }),
  setRememberPassword: (on) => {
    set({ rememberPassword: on });
    void persist(KEY_REMEMBER_PASSWORD, on);
  },
  setLastUsername: (username) => {
    set({ lastUsername: username });
    void persist(KEY_LAST_USERNAME, username);
  },
  setServerAddress: (addr) => {
    set({ serverAddress: addr });
    void persist(KEY_SERVER_ADDRESS, addr);
  },
  setServerConfig: (config) => {
    set({ serverConfig: config });
    void persist(KEY_SERVER_CONFIG, config);
  },
  init: async () => {
    const saved = await readPersisted();
    set({
      serverAddress: saved.serverAddress ?? DEFAULT_SERVER_ADDRESS,
      rememberPassword: saved.rememberPassword ?? false,
      lastUsername: saved.lastUsername ?? "",
      serverConfig: saved.serverConfig ?? DEFAULT_SERVER_CONFIG,
    });
  },
}));