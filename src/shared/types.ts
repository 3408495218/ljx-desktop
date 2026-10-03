export interface RoomCardData {
  id: number;
  name: string;
  players: number;
  capacity: number;
  /**
   * 房主**生效**的 VIP 档位（过期按 0 处理）。
   * 后端仍会返回，但**当前不用于渲染** —— VIP 的可见效果就是房间卡片边框（见 border），
   * 之前额外在右上角挂过一个档位图标，属于多余信息，已按使用者反馈移除。
   */
  vip: number | null;
  /** 房主生效 VIP 档位的房间边框资源键（如 border-iron）；null 表示无边框 */
  border: string | null;
  /** 是否已购买置顶卡且未过期 */
  topCard: boolean;
  online: boolean;
  core: string;
  mcVersion: string;
  mode: string;
  cover: string | null;
}

/**
 * 「我的游戏」当前管理对象。
 *
 * - `room`  —— 平台上的房间：详情、心跳、内容同步都要 roomId（依赖后端）
 * - `local` —— 本机实例：离线开服用，**不注册到大厅、没有 roomId**
 *
 * 用带标签的联合类型，而不是 `number | null` 再拿 -1 之类的哨兵值表示"本地"——
 * 否则每个调用点都得先猜"这个数字是房间还是特殊值"，很容易漏判。
 */
export type ManageTarget = { kind: "room"; id: number } | { kind: "local" };

export type LobbyView = "all" | "favorite" | "history";

export interface LobbyFilters {
  /** 大厅筛选用的纯 Minecraft 版本号（如 1.20.4）；空串表示所有版本 */
  mcVersion: string;
  mode: string;
  keyword: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  total: number;
}

export type ServerPhase =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

export interface JavaInstall {
  path: string;
  version: string;
  source: string;
}

export interface ServerStartConfig {
  javaPath: string;
  jarPath: string;
  xmxMb: number;
  workDir: string;
}

export interface ConsoleLine {
  ts: number;
  raw: string;
  level: "info" | "warn" | "error";
  translated?: string;
}

export interface PropertyLine {
  key: string;
  value: string;
  comment: boolean;
}

/** 本地快照元数据（Rust 端 snapshot_list / snapshot_create 返回） */
export interface SnapshotMeta {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

/** 本地内容条目（Rust mods_list 返回）：来源是服务端 plugins / mods 目录 */
export interface LocalContentEntry {
  /** 展示名（去掉停用后缀），也是上报平台的键 */
  name: string;
  /** 磁盘上的真实文件名 */
  fileName: string;
  sizeBytes: number;
  enabled: boolean;
}

export type ContentKind = "plugin" | "mod";

/** 「当前加入」页的准备状态：等待 → 正在加入 → 已准备 */
export type PrepState = "waiting" | "joining" | "ready";

export interface AccountInfo {
  id: number;
  username: string;
  level: number;
  vip: number | null;
  coins: number;
  email: string | null;
  emailBound: boolean;
  /** 是否为访客身份：未登录时自动创建，用于承载房主权限 */
  anonymous: boolean;
}
