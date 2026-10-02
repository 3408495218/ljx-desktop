export const PAGE_SIZE = 18;

export const APP_VERSION = "0.1.0";

export const OFFICIAL_QQ_GROUP = "121165105";

/**
 * 服务端核心 + 版本。**格式固定为「核心-版本」**：
 * 大厅筛选按**第一个** '-' 拆分（core / mcVersion），所以核心名与版本号里不要再出现 '-'。
 * 这里只列常见组合做「选择建议」——房间信息与创建表单都允许直接手输自定义值。
 */
export const CORE_VERSION_OPTIONS = [
  // Paper（当前最常用）
  "Paper-1.8.8", "Paper-1.12.2", "Paper-1.16.5", "Paper-1.18.2",
  "Paper-1.19.2", "Paper-1.19.4", "Paper-1.20.1", "Paper-1.20.4", "Paper-1.20.6",
  "Paper-1.21", "Paper-1.21.1", "Paper-1.21.4", "Paper-1.21.8",
  "Paper-1.21.9", "Paper-1.21.10", "Paper-1.21.11",
  // Spigot
  "Spigot-1.8.8", "Spigot-1.12.2", "Spigot-1.16.5", "Spigot-1.18.2",
  "Spigot-1.19.4", "Spigot-1.20.1", "Spigot-1.20.4", "Spigot-1.21.4",
  "Spigot-1.21.9", "Spigot-1.21.10", "Spigot-1.21.11",
  // Forge
  "Forge-1.7.10", "Forge-1.12.2", "Forge-1.16.5", "Forge-1.18.2",
  "Forge-1.19.2", "Forge-1.20.1", "Forge-1.21", "Forge-1.21.1",
  "Forge-1.21.9", "Forge-1.21.10", "Forge-1.21.11",
  // NeoForge（1.20.x 起从 Forge 分出的新分支）
  "NeoForge-1.20.4", "NeoForge-1.21", "NeoForge-1.21.1", "NeoForge-1.21.4", "NeoForge-1.21.8",
  "NeoForge-1.21.9", "NeoForge-1.21.10", "NeoForge-1.21.11",
  // Fabric
  "Fabric-1.16.5", "Fabric-1.18.2", "Fabric-1.19.2", "Fabric-1.20.1",
  "Fabric-1.20.4", "Fabric-1.21.1", "Fabric-1.21.4",
  "Fabric-1.21.9", "Fabric-1.21.10", "Fabric-1.21.11",
  // 混合端（Bukkit + Mod 双支持）与其它
  "KCauldron-1.7.10", "Thermos-1.7.10", "Mohist-1.12.2", "Mohist-1.16.5",
  "Mohist-1.18.2", "Mohist-1.20.1", "Arclight-1.20.1",
  "Purpur-1.20.4", "Purpur-1.21.4",
  "Purpur-1.21.9", "Purpur-1.21.10", "Purpur-1.21.11",
  // 原版服务端
  "原版-1.12.2", "原版-1.20.4", "原版-1.21.4",
] as const;

/**
 * 大厅「版本」筛选专用：**纯 Minecraft 版本号**，不再区分服务端核心
 * —— 同一版本可能有 Paper / Spigot / Forge 等多种实现，按版本筛更符合直觉。
 * 覆盖 1.6.4 → 26.3（2026 年起 Mojang 改用「年份.序号」版本号，如 26.1）。
 *
 * 注意：房间登记用的仍是「核心-版本」格式（`CORE_VERSION_OPTIONS`），
 * 两者用途不同，不要混用。
 */
export const MC_VERSION_OPTIONS = [
  "1.6.4", "1.7.10", "1.8.9", "1.9.4", "1.10.2", "1.11.2", "1.12.2",
  "1.13.2", "1.14.4", "1.15.2", "1.16.5", "1.17.1", "1.18.2",
  "1.19.2", "1.19.4", "1.20.1", "1.20.4", "1.20.6",
  "1.21", "1.21.1", "1.21.2", "1.21.3", "1.21.4", "1.21.5", "1.21.6",
  "1.21.7", "1.21.8", "1.21.9", "1.21.10", "1.21.11",
  "26.1", "26.2", "26.3",
] as const;

export const MODE_OPTIONS = [
  "生存", "创造", "冒险", "RPG", "科技", "空岛", "海岛",
] as const;

export const XMX_OPTIONS = [1024, 2048, 3072, 4096, 6144, 8192] as const;

export const CONSOLE_BUFFER_SIZE = 800;

/** 后端用 Integer.MAX_VALUE 表示「不限」（如容量、插件数量），展示时需转成文案 */
export const QUOTA_UNLIMITED = 2147483647;

export function formatQuotaLimit(value: number | undefined): string {
  if (value === undefined) return "—";
  return value >= QUOTA_UNLIMITED ? "不限" : String(value);
}

export const CREATE_RULES = [
  "服务端进程运行在房主本机，房主保持客户端在线即可维持房间在线状态",
  "房主即服主，可在控制台执行命令、自定义 OP",
  // 容量由房主自设、与 VIP 无关（VIP 影响的是客户端资源包上限，不是房间人数容量）
  "人数容量由房主自行设置",
  // 不写死具体 MB：等级与 VIP 档位的上限都能在后台改，写死数字迟早过期
  "客户端资源包大小上限按房主等级或 VIP 档位提升",
] as const;
