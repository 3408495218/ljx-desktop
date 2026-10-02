import { usePreferencesStore, DEFAULT_SERVER_ADDRESS } from "@/stores/preferences";

export const DEFAULT_SERVER_PORT = 8080;

/**
 * 把用户输入的云服务器地址解析为 API 基地址。
 * 支持：IP / 域名（自动补 http:// 与默认端口）、host:port、完整 URL。
 */
export function resolveApiBaseUrl(raw: string): string {
  const addr = raw.trim();
  if (!addr) return `http://${DEFAULT_SERVER_ADDRESS}:${DEFAULT_SERVER_PORT}`;
  if (/^https?:\/\//i.test(addr)) return addr.replace(/\/+$/, "");
  if (addr.includes(":")) return `http://${addr}`;
  return `http://${addr}:${DEFAULT_SERVER_PORT}`;
}

/** P1 API 客户端统一入口：读取当前设置的服务器地址 */
export function currentApiBaseUrl(): string {
  return resolveApiBaseUrl(usePreferencesStore.getState().serverAddress);
}
