import { load } from "@tauri-apps/plugin-store";
import { currentApiBaseUrl } from "./serverConfig";

const STORE_FILE = "session.json";
const KEY_ACCESS = "accessToken";
/** 访客身份的独立存储键：与"记住密码"无关，避免每次启动都换一个新访客（那会丢失房间归属） */
const KEY_GUEST_ACCESS = "ljx.guest.access";
const KEY_GUEST_REFRESH = "ljx.guest.refresh";
const KEY_REFRESH = "refreshToken";

/** 后端统一响应 {code, message, data}；code=0 为成功 */
interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/** 统一的错误文案提取：ApiError 直接用 message，其他回退到字符串化 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 后端 ErrorCode 中与令牌相关的两个码 */
const UNAUTHENTICATED = 1104;
const REFRESH_TOKEN_INVALID = 1103;

/** 会话类错误：需要走"刷新一次，仍失败就彻底登出"的处理 */
function isSessionInvalid(code: number): boolean {
  return code === UNAUTHENTICATED || code === REFRESH_TOKEN_INVALID;
}
/** 网络层失败（未拿到合法响应体）时的本地错误码 */
const NETWORK_ERROR = -1;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AccountPayload {
  id: number;
  username: string;
  level: number;
  score: number;
  vipLevel: number;
  coins: number;
  email: string | null;
  quotas: Record<string, number>;
  /** 是否为访客（未登录时自动创建的匿名身份） */
  anonymous: boolean;
}

export interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  account: AccountPayload;
}

export interface RoomSummaryPayload {
  id: number;
  name: string;
  cover: string | null;
  players: number;
  capacity: number;
  vip: number;
  /** 房主生效 VIP 档位的房间边框资源键（如 border-iron）*/
  border: string;
  /** 是否已购买置顶卡且未过期 */
  topCard: boolean;
  online: boolean;
  core: string;
  mcVersion: string;
  mode: string;
}

export interface RoomDetailPayload {
  id: number;
  name: string;
  intro: string | null;
  core: string;
  mcVersion: string;
  mode: string;
  capacity: number;
  players: number;
  locked: boolean;
  noGuest: boolean;
  needEmail: boolean;
  qqGroupCode: string | null;
  /** 加群组件 idkey；非空表示已点亮加群按钮，房间展示可用加群入口 */
  qqGroupIdKey: string | null;
  cover: string | null;
  online: boolean;
  host: string | null;
  port: number | null;
  favoriteCount: number;
  ownerName: string;
  vip: number;
  mine: boolean;
  favorited: boolean;
  /** 插件 / Mod 清单是否对玩家可见；false 时玩家只看到总数，不列出文件 */
  pluginListVisible: boolean;
  modListVisible: boolean;
  /** 房主心跳上报的在线玩家名（服务端里真实的玩家）；用于判定成员是否「游戏中」 */
  playerNames: string[];
  /** 房间成员（进入房间即算，含尚未进入游戏的人）；players 即成员数 */
  members: MemberInfo[];
}

/** 房间成员：进入房间即计数（房主与玩家一致），inGame = 名字出现在服务端在线名单里 */
export interface MemberInfo {
  accountId: number;
  username: string;
  vip: number;
  level: number;
  inGame: boolean;
  owner: boolean;
  joinedAt: string;
}

/** 公告（公开接口，无需登录）；只暴露 id 与内容 */
export interface AnnouncementItem {
  id: number;
  content: string;
}

/** 公告响应：列表 + 轮播间隔（秒，后台「公告」面板可配，3-120） */
export interface AnnouncementListPayload {
  items: AnnouncementItem[];
  rotateSeconds: number;
}

/** 进入 / 续期 / 离开房间的返回值：成员视图 */
export interface PresencePayload {
  members: MemberInfo[];
  memberCount: number;
  capacity: number;
}

/** 收藏操作结果：一次返回按钮态与计数 */
export interface FavoriteStatePayload {
  favorited: boolean;
  favoriteCount: number;
}

export interface PagePayload<T> {
  items: T[];
  page: number;
  total: number;
}

export interface JoinPayload {
  host: string | null;
  port: number | null;
}

/** 内容类型：对应服务端工作目录下的 plugins / mods 两个目录 */
export type ContentType = "plugin" | "mod";

/** 平台侧的房间内容镜像；真实来源是房主本机目录，此处仅供玩家查看 */
export interface RoomContentItem {
  name: string;
  type: ContentType;
  sizeBytes: number;
  enabled: boolean;
  reportedAt: string;
}

/** 房主上报的整表清单项 */
export interface ReportContentItem {
  name: string;
  type: ContentType;
  sizeBytes: number;
  enabled: boolean;
}

/** 客户端压缩包元数据（房主上传到平台，玩家下载后交给 PCL 导入） */
export interface ClientPackageMeta {
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
}

/** 商城目录项（仅展示；购买按钮由前端置灰） */
/** 商品：图标与效果都由后端发放（前端不硬编码商品列表） */
export interface ShopItemPayload {
  id: number;
  name: string;
  category: string;
  priceCoins: number;
  description: string;
  /** 资源键，如 top-card；图片打包在桌面端，用 shared/shopIcons 映射 */
  iconUrl: string | null;
  /** TOP_CARD / VIP / NONE */
  effectKind: string;
  /** 效果时长（天）；null 表示永久 */
  durationDays: number | null;
  vipLevel: number | null;
}

/** 商城目录 + 当前钻石余额 */
export interface ShopPayload {
  coins: number;
  vipLevel: number;
  vipName: string;
  vipExpiresAt: string | null;
  /** 只有道具（VIP 档位在 VipPayload 里，不在商品列表中重复出现） */
  items: ShopItemPayload[];
}

/** VIP 档位（档位名与价格；容量由服主自设，与档位无关） */
/** VIP 档位：VIP 的唯一来源；买了之后房间卡片边框随之变化 */
export interface VipPlanPayload {
  level: number;
  name: string;
  priceCoins: number;
  description: string | null;
  /** 客户端压缩包上传上限（MB），由后台设置 */
  packageMaxMb: number;
  /** 房间卡片外框图的资源键，如 border-iron */
  borderUrl: string | null;
  /** 档位图标；普通用户为 null（不显示） */
  iconUrl: string | null;
  /** 购买后的有效天数；null 或 0 表示永久（由后台设置） */
  durationDays: number | null;
}

/** VIP 一览：当前档位 + 钻石余额 + 全部档位 */
export interface VipPayload {
  currentLevel: number;
  currentName: string;
  coins: number;
  expiresAt: string | null;
  plans: VipPlanPayload[];
}

/** 购买结果：返回最新余额与效果说明，前端可直接提示 */
export interface PurchaseResult {
  coins: number;
  itemName: string;
  message: string;
  expiresAt: string | null;
}

/** 平台登记的快照元数据（POST 登记 / DELETE 删除 / GET 列表） */
export interface SnapshotPayload {
  id: number;
  name: string;
  sizeBytes: number;
  createdAt: string;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let persistTokens = false;
let onSessionLost: (() => void) | null = null;
let refreshInFlight: Promise<boolean> | null = null;

/** 注册会话失效回调：刷新令牌也失效时通知上层清空账号态 */
export function onSessionExpired(handler: () => void) {
  onSessionLost = handler;
}

async function readPersisted(): Promise<SessionTokens | null> {
  try {
    const store = await load(STORE_FILE, { autoSave: true });
    const access = await store.get<string>(KEY_ACCESS);
    const refresh = await store.get<string>(KEY_REFRESH);
    return access && refresh ? { accessToken: access, refreshToken: refresh } : null;
  } catch {
    const access = localStorage.getItem(KEY_ACCESS);
    const refresh = localStorage.getItem(KEY_REFRESH);
    return access && refresh ? { accessToken: access, refreshToken: refresh } : null;
  }
}

async function persistSession(tokens: SessionTokens | null): Promise<void> {
  try {
    const store = await load(STORE_FILE, { autoSave: true });
    if (tokens) {
      await store.set(KEY_ACCESS, tokens.accessToken);
      await store.set(KEY_REFRESH, tokens.refreshToken);
    } else {
      await store.delete(KEY_ACCESS);
      await store.delete(KEY_REFRESH);
    }
  } catch {
    // 兜底路径：只在 Tauri store 不可用时走到（目前仅浏览器里预览前端会命中）。
    // 这里是 localStorage —— **在 Web 环境下可被 XSS 读取**，所以桌面端必须始终走上面的 store；
    // 这也是为什么前端不允许出现任何 dangerouslySetInnerHTML（已确认全项目 0 处）。
    if (tokens) {
      localStorage.setItem(KEY_ACCESS, tokens.accessToken);
      localStorage.setItem(KEY_REFRESH, tokens.refreshToken);
    } else {
      localStorage.removeItem(KEY_ACCESS);
      localStorage.removeItem(KEY_REFRESH);
    }
  }
}

/** 保存会话；persist=true 时写入磁盘，重启后仍保持登录（对应「记住密码」） */
/**
 * 读取本机保存的访客身份（与正式账号完全独立）。
 * 访客身份必须**持久保存**：房间的归属校验依赖 accountId，
 * 若每次启动都换新访客，之前建的房间就再也管不了了。
 */
export async function restoreGuestSession(): Promise<boolean> {
  try {
    const store = await load(STORE_FILE, { autoSave: true });
    const access = await store.get<string>(KEY_GUEST_ACCESS);
    const refresh = await store.get<string>(KEY_GUEST_REFRESH);
    if (access && refresh) {
      accessToken = access;
      refreshToken = refresh;
      persistTokens = true;
      return true;
    }
  } catch {
    const access = localStorage.getItem(KEY_GUEST_ACCESS);
    const refresh = localStorage.getItem(KEY_GUEST_REFRESH);
    if (access && refresh) {
      accessToken = access;
      refreshToken = refresh;
      persistTokens = true;
      return true;
    }
  }
  return false;
}

/** 保存访客身份（独立键，不会被"未勾记住密码"清理掉） */
export async function persistGuestSession(tokens: SessionTokens): Promise<void> {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  persistTokens = true;
  try {
    const store = await load(STORE_FILE, { autoSave: true });
    await store.set(KEY_GUEST_ACCESS, tokens.accessToken);
    await store.set(KEY_GUEST_REFRESH, tokens.refreshToken);
  } catch {
    localStorage.setItem(KEY_GUEST_ACCESS, tokens.accessToken);
    localStorage.setItem(KEY_GUEST_REFRESH, tokens.refreshToken);
  }
}

export function setSession(tokens: SessionTokens, persist = persistTokens) {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  persistTokens = persist;
  if (persist) void persistSession(tokens);
  else void persistSession(null);
}

export function clearSession() {
  accessToken = null;
  refreshToken = null;
  persistTokens = false;
  void persistSession(null);
}

/** 清掉磁盘上的令牌但保留内存会话（用于「不记住密码」时清理历史遗留） */
export async function purgePersistedSession(): Promise<void> {
  await persistSession(null);
}

export function hasSession(): boolean {
  return accessToken !== null;
}

/** 当前访问令牌；Rust 侧下载压缩包时需要用同一身份请求 */
export function currentAccessToken(): string | null {
  return accessToken;
}

/** 当前云服务器地址，供 Rust 侧拼接下载链接 */
export function apiBaseUrl(): string {
  return currentApiBaseUrl();
}

/** 启动时恢复持久化会话；返回是否存在可用的本地令牌（有效性由 me() 验证） */
export async function restoreSession(): Promise<boolean> {
  const saved = await readPersisted();
  if (!saved) return false;
  accessToken = saved.accessToken;
  refreshToken = saved.refreshToken;
  persistTokens = true;
  return true;
}

async function rawRequest<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${currentApiBaseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(NETWORK_ERROR, "无法连接云服务器，请检查设置中的服务器地址");
  }

  try {
    return (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(NETWORK_ERROR, `服务器返回异常（HTTP ${res.status}）`);
  }
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const envelope = await rawRequest<TokenPayload>("POST", "/api/auth/refresh", { refreshToken });
        if (envelope.code !== 0) return false;
        setSession({
          accessToken: envelope.data.accessToken,
          refreshToken: envelope.data.refreshToken,
        });
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * 会话已失效时的统一收尾：清内存与磁盘令牌 + 通知上层清空账号态（右上角不再显示已登录）。
 *
 * 之所以要抽出来：原先只有"刷新令牌也失败"这一条路径会清会话，
 * 而"刷新看似成功、重试后仍返回 1104"会走到最后那句 `if (envelope.code !== 0) throw`
 * —— 抛了错却**不清会话**，于是界面停在"右上角显示已登录、页面却报登录失效"的矛盾状态，
 * 而且用户重试永远失败（这就是"永远登录状态失效"的成因）。
 */
function abandonSession(): never {
  clearSession();
  onSessionLost?.();
  throw new ApiError(UNAUTHENTICATED, "登录状态已失效，请重新登录");
}

/** 带自动续期的请求：access 过期时用 refresh 换一次并重放 */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let envelope = await rawRequest<T>(method, path, body);
  if (isSessionInvalid(envelope.code)) {
    if (!(await tryRefresh())) {
      abandonSession();
    }
    envelope = await rawRequest<T>(method, path, body);
    // 刷新"成功"了但重试仍是会话无效（例如库被重建、账号已不存在）：
    // 这时必须同样清会话，否则界面会一直停在"显示已登录 + 页面报失效"的矛盾状态
    if (isSessionInvalid(envelope.code)) {
      abandonSession();
    }
  }
  if (envelope.code !== 0) throw new ApiError(envelope.code, envelope.message);
  return envelope.data;
}

/** 文件上传：与 request 同样的续期逻辑，但走 multipart 而非 JSON */
async function uploadRequest<T>(path: string, file: File): Promise<T> {
  const send = async (): Promise<Envelope<T>> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(`${currentApiBaseUrl()}${path}`, { method: "POST", headers, body: form });
    } catch {
      throw new ApiError(NETWORK_ERROR, "无法连接云服务器，请检查设置中的服务器地址");
    }
    try {
      return (await res.json()) as Envelope<T>;
    } catch {
      throw new ApiError(NETWORK_ERROR, `服务器返回异常（HTTP ${res.status}）`);
    }
  };

  let envelope = await send();
  if (isSessionInvalid(envelope.code)) {
    if (!(await tryRefresh())) {
      abandonSession();
    }
    envelope = await send();
    if (isSessionInvalid(envelope.code)) {
      abandonSession();
    }
  }
  if (envelope.code !== 0) throw new ApiError(envelope.code, envelope.message);
  return envelope.data;
}

export interface RoomQuery {
  view?: "all" | "favorite" | "history";
  core?: string;
  mcVersion?: string;
  mode?: string;
  q?: string;
  page?: number;
  size?: number;
}

export interface CreateRoomBody {
  name: string;
  intro?: string | null;
  core: string;
  mcVersion: string;
  mode?: string;
  capacity: number;
  locked?: boolean;
  noGuest?: boolean;
  needEmail?: boolean;
  coverUrl?: string | null;
}

export interface UpdateRoomBody {
  name?: string;
  intro?: string;
  core?: string;
  mcVersion?: string;
  mode?: string;
  capacity?: number;
  locked?: boolean;
  noGuest?: boolean;
  needEmail?: boolean;
  coverUrl?: string;
  host?: string;
  port?: number;
  /** 控制玩家侧是否列出插件 / Mod 清单 */
  pluginListVisible?: boolean;
  modListVisible?: boolean;
}

function toQuery(query: RoomQuery): string {
  const params = new URLSearchParams();
  if (query.view) params.set("view", query.view);
  if (query.core) params.set("core", query.core);
  if (query.mcVersion) params.set("mcVersion", query.mcVersion);
  if (query.mode) params.set("mode", query.mode);
  if (query.q) params.set("q", query.q);
  if (query.page) params.set("page", String(query.page));
  if (query.size) params.set("size", String(query.size));
  return params.toString();
}

export const api = {
  /**
   * 访客注册：未登录时自动获取一个匿名房主身份（无需填任何东西）。
   * 用途：本软件定位是开服器，未登录也要能建房开服；而房间的归属校验
   * （改设置/删房/心跳/上传包）必须有一个 accountId，所以这里换一个匿名身份。
   */
  registerGuest: () => request<TokenPayload>("POST", "/api/auth/guest"),

  register: (username: string, password: string) =>
    request<TokenPayload>("POST", "/api/auth/register", { username, password }),
  login: (username: string, password: string) =>
    request<TokenPayload>("POST", "/api/auth/login", { username, password }),
  logout: () =>
    request<void>("POST", "/api/auth/logout", refreshToken ? { refreshToken } : {}),
  me: () => request<AccountPayload>("GET", "/api/me"),
  sendEmailCode: (email: string) => request<void>("POST", "/api/me/email/code", { email }),
  bindEmail: (email: string, code: string) =>
    request<AccountPayload>("PUT", "/api/me/email", { email, code }),

  rooms: (query: RoomQuery = {}) =>
    request<PagePayload<RoomSummaryPayload>>("GET", `/api/rooms?${toQuery(query)}`),
  myRooms: () => request<RoomSummaryPayload[]>("GET", "/api/rooms/mine"),
  createRoom: (body: CreateRoomBody) =>
    request<RoomDetailPayload>("POST", "/api/rooms", body),
  roomDetail: (id: number) => request<RoomDetailPayload>("GET", `/api/rooms/${id}`),
  updateRoom: (id: number, body: UpdateRoomBody) =>
    request<RoomDetailPayload>("PUT", `/api/rooms/${id}`, body),
  deleteRoom: (id: number) => request<void>("DELETE", `/api/rooms/${id}`),
  heartbeat: (id: number, players: number, playerNames: string[] = [], uptimeSec = 0) =>
    request<void>("POST", `/api/rooms/${id}/heartbeat`, { players, uptimeSec, playerNames }),

  /** 公告 + 轮播间隔（公开接口，无需登录）：底部状态栏轮播用；无公告时 items 为空数组 */
  announcements: () => request<AnnouncementListPayload>("GET", "/api/announcements"),

  /** 进入房间 / 续期（幂等）：登记为房间成员并返回成员列表 */
  enterRoom: (id: number) => request<PresencePayload>("PUT", `/api/rooms/${id}/presence`),
  /** 离开房间（幂等）；房间已被删除时后端返回 1301，前端应容错忽略 */
  leaveRoom: (id: number) => request<void>("DELETE", `/api/rooms/${id}/presence`),
  joinRoom: (id: number) => request<JoinPayload>("POST", `/api/rooms/${id}/join`),
  /** 点亮 / 取消点亮QQ加群：群号与组件凭据整体覆盖，都传 null 即取消点亮 */
  setQqGroup: (id: number, code: string | null, idKey: string | null) =>
    request<RoomDetailPayload>("POST", `/api/rooms/${id}/qq-group`, { code, idKey }),

  /** 收藏 / 取消收藏（均为幂等），返回最新的按钮态与计数 */
  favorite: (id: number) =>
    request<FavoriteStatePayload>("POST", `/api/rooms/${id}/favorite`),
  unfavorite: (id: number) =>
    request<FavoriteStatePayload>("DELETE", `/api/rooms/${id}/favorite`),

  /** 足迹清理：移除单条 / 清空（幂等）；足迹列表读取走 rooms({view:"history"}) */
  removeFootprint: (roomId: number) =>
    request<void>("DELETE", `/api/me/footprint/${roomId}`),
  clearFootprints: () => request<void>("DELETE", "/api/me/footprint"),

  /** 商城目录 + 当前钻石余额；本期无购买通道，前端购买按钮置灰 */
  shop: () => request<ShopPayload>("GET", "/api/commerce/shop"),
  /** VIP 档位一览 + 当前档位 */
  vip: () => request<VipPayload>("GET", "/api/commerce/vip"),

  /** 购买道具（目前仅置顶卡；置顶卡需传自己名下的 roomId） */
  purchaseItem: (itemId: number, roomId?: number) =>
    request<PurchaseResult>("POST", "/api/commerce/purchase", { itemId, roomId }),

  /** 购买 VIP 档位（VIP 唯一来源是档位表，不走商品 id） */
  purchaseVip: (level: number) =>
    request<PurchaseResult>("POST", "/api/commerce/vip/purchase", { level }),

  /** 兑换 CDK：返回最新钻石总数与本次所得 */
  redeemCdk: (code: string) =>
    request<{ coins: number; gained: number }>("POST", "/api/commerce/redeem", { code }),

  /** 房间插件 / Mod 清单镜像：真实来源是房主本机目录，登录即可读，供进房玩家查看 */
  roomContents: (roomId: number) =>
    request<RoomContentItem[]>("GET", `/api/rooms/${roomId}/contents`),
  /** 房主上报本机扫描结果：整表替换，本地删掉的文件在平台侧同步消失 */
  reportRoomContents: (roomId: number, items: ReportContentItem[]) =>
    request<RoomContentItem[]>("PUT", `/api/rooms/${roomId}/contents`, { items }),

  /** 客户端压缩包元数据（房主上传到平台，玩家下载后交给 PCL 导入）；未上传时为 null */
  clientPackageMeta: (roomId: number) =>
    request<ClientPackageMeta | null>("GET", `/api/rooms/${roomId}/client-package`),
  uploadClientPackage: (roomId: number, file: File) =>
    uploadRequest<ClientPackageMeta>(`/api/rooms/${roomId}/client-package`, file),
  deleteClientPackage: (roomId: number) =>
    request<void>("DELETE", `/api/rooms/${roomId}/client-package`),

  /** 平台快照元数据（P3）：按名称登记 / 删除，与本地 ljx-snapshots 对齐 */
  snapshotListMeta: (roomId: number) =>
    request<SnapshotPayload[]>("GET", `/api/rooms/${roomId}/snapshots`),
  snapshotCreateMeta: (roomId: number, name: string, sizeBytes: number) =>
    request<SnapshotPayload>("POST", `/api/rooms/${roomId}/snapshots`, { name, sizeBytes }),
  snapshotDeleteMeta: (roomId: number, name: string) =>
    request<SnapshotPayload[]>("DELETE", `/api/rooms/${roomId}/snapshots/${encodeURIComponent(name)}`),
};