import { invoke } from "@tauri-apps/api/core";
import type {
  ContentKind,
  JavaInstall,
  LocalContentEntry,
  PropertyLine,
  ServerPhase,
  ServerStartConfig,
  SnapshotMeta,
} from "./types";

export async function serverStart(config: ServerStartConfig): Promise<void> {
  return invoke("server_start", { config });
}

export async function serverStop(): Promise<void> {
  return invoke("server_stop");
}

export async function serverStatus(): Promise<{ phase: ServerPhase; detail: string }> {
  return invoke("server_status");
}

/** 本机服务端当前在线人数（房间心跳上报的取值来源） */
export async function serverPlayers(): Promise<number> {
  return invoke("server_players");
}

/** 本机服务端当前在线名单（随心跳整体上报给平台） */
export async function serverPlayerNames(): Promise<string[]> {
  return invoke("server_player_names");
}

export async function consoleSend(cmd: string): Promise<void> {
  return invoke("console_send", { cmd });
}

export async function probeJava(): Promise<JavaInstall[]> {
  return invoke("probe_java");
}

export async function probePort(port: number): Promise<boolean> {
  return invoke("probe_port", { port });
}

export async function probeMc(): Promise<{ minecraftDir: string | null; hasLauncherProfiles: boolean }> {
  return invoke("probe_mc");
}

export async function propsRead(path: string): Promise<PropertyLine[]> {
  return invoke("props_read", { path });
}

export async function propsWrite(path: string, entries: PropertyLine[]): Promise<void> {
  return invoke("props_write", { path, entries });
}

/** 解析生效的服务端工作目录（workDir 优先，否则取 jar 所在目录） */
export async function resolveServerDir(jarPath: string, workDir: string): Promise<string> {
  return invoke("resolve_server_dir", { jarPath, workDir });
}

export async function snapshotList(workDir: string): Promise<SnapshotMeta[]> {
  return invoke("snapshot_list", { workDir });
}

export async function snapshotCreate(workDir: string, name: string): Promise<SnapshotMeta> {
  return invoke("snapshot_create", { workDir, name });
}

export async function snapshotDelete(workDir: string, name: string): Promise<void> {
  return invoke("snapshot_delete", { workDir, name });
}

/** 从快照恢复地图与配置，返回被还原的条目名 */
export async function snapshotRestore(workDir: string, name: string): Promise<string[]> {
  return invoke("snapshot_restore", { workDir, name });
}

/** 清空地图：删除世界存档目录，返回被删除的条目名 */
export async function worldClear(workDir: string): Promise<string[]> {
  return invoke("world_clear", { workDir });
}

/** 全部重置：清空地图 + 清除运行时配置与日志 */
export async function worldReset(workDir: string): Promise<string[]> {
  return invoke("world_reset", { workDir });
}

/** 打开系统默认的 Minecraft 启动器 */
export async function openMcLauncher(): Promise<void> {
  return invoke("open_mc_launcher");
}

/** 用系统默认浏览器打开 http/https 链接 */
export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

// ---------- 本地插件 / Mod：以服务端 plugins、mods 目录为准 ----------

/** 扫描本地目录，返回可上报平台的清单 */
export async function modsList(
  workDir: string,
  kind: ContentKind,
): Promise<LocalContentEntry[]> {
  return invoke("mods_list", { workDir, kind });
}

/** 把外部 jar 复制进本地目录，返回导入后的完整清单 */
export async function modsImport(
  workDir: string,
  kind: ContentKind,
  sources: string[],
): Promise<LocalContentEntry[]> {
  return invoke("mods_import", { workDir, kind, sources });
}

/** 删除本地文件，返回删除后的完整清单 */
export async function modsDelete(
  workDir: string,
  kind: ContentKind,
  fileName: string,
): Promise<LocalContentEntry[]> {
  return invoke("mods_delete", { workDir, kind, fileName });
}

/** 启用 / 停用（重命名 jar），返回更新后的完整清单 */
export async function modsSetEnabled(
  workDir: string,
  kind: ContentKind,
  fileName: string,
  enabled: boolean,
): Promise<LocalContentEntry[]> {
  return invoke("mods_set_enabled", { workDir, kind, fileName, enabled });
}

/** 选择本地 jar（可多选）；取消返回 null */
export async function pickFiles(title: string): Promise<string[] | null> {
  return invoke("pick_files", { title });
}

/** 选择目录；取消返回 null */
export async function pickFolder(title: string, startDir?: string): Promise<string | null> {
  return invoke("pick_folder", { title, startDir: startDir ?? null });
}

/** 下载房主上传的客户端压缩包到指定目录，返回落盘路径 */
export async function downloadClientPackage(
  baseUrl: string,
  roomId: number,
  token: string,
  destDir: string,
  fileName: string,
): Promise<string> {
  return invoke("download_client_package", { baseUrl, roomId, token, destDir, fileName });
}

/** 在资源管理器中打开目录 */
export async function openFolder(path: string): Promise<void> {
  return invoke("open_folder", { path });
}

// ---------- 客户端整合包（mrpack）：解析 / 一键构建并启动 ----------

/** 整合包元信息（由 Rust 侧解析 modrinth.index.json 得到） */
export interface MrpackInfo {
  name: string;
  gameVersion: string;
  /** neoforge / forge / fabric / quilt / vanilla */
  loader: string;
  loaderVersion: string;
  /** 覆盖文件数量（mods、config、options.txt 等） */
  overrideFiles: number;
  /** 需要额外联网下载的 mod 数量 */
  remoteFiles: number;
  /** 内容指纹：同一个包会复用同一份客户端目录 */
  packId: string;
}

/** 构建进度事件载荷（监听 client://build） */
export interface ClientBuildProgress {
  stage: "pack" | "extract" | "download" | "check" | "speed" | "eta" | "patch" | "launch" | "done" | "error" | string;
  element: string;
  downloaded: number;
  total: number;
  message: string;
}

export interface ClientBuildRequest {
  /** 整合包压缩包在本机的路径（.zip 或 .mrpack） */
  packPath: string;
  /** 离线模式下的游戏内昵称 */
  playerName?: string;
  /** 最大内存，如 "4G" */
  maxMemory?: string;
  /** 是否构建完立即启动；false = 只准备不启动 */
  launchAfterBuild?: boolean;
}

/**
 * 把房主的整合包下载到**平台管理的固定目录**（{appData}/ljx-client/packs），返回本地路径。
 * 与 downloadClientPackage 的区别：那个给玩家自己用（玩家选目录、下完打开文件夹）；
 * 这个下完直接交给「一键启动」去构建客户端，所以目录不由玩家指定。
 */
export function clientFetchPack(
  baseUrl: string,
  roomId: number,
  token: string,
  fileName: string,
): Promise<string> {
  return invoke("client_fetch_pack", { baseUrl, roomId, token, fileName });
}

/** 解析整合包，拿到版本/加载器/覆盖文件数等信息（不下载任何东西） */
export function clientPackInspect(packPath: string): Promise<MrpackInfo> {
  return invoke("client_pack_inspect", { packPath });
}

/**
 * 一键构建并启动：下载原版 + 加载器 + assets，铺入 overrides，然后启动游戏。
 * 进度通过 `client://build` 事件推送；返回 packId。
 * 注意：写入目录由 Rust 侧固定（{appData}/ljx-client/{packId}），前端不能指定。
 */
export function clientBuildAndLaunch(request: ClientBuildRequest): Promise<string> {
  return invoke("client_build_and_launch", { request });
}

/** 结束上一次启动的游戏进程 */
export function clientKillGame(): Promise<void> {
  return invoke("client_kill_game");
}
