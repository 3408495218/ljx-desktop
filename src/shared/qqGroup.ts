/** 腾讯 WPA 一键加群链接：idkey 是「点亮QQ加群」三步引导的最终产物 */
export function qqGroupJoinUrl(idKey: string | null | undefined): string | null {
  const key = idKey?.trim();
  return key ? `https://shang.qq.com/wpa/qunwpa?idkey=${encodeURIComponent(key)}` : null;
}

/** 原版第二步打开的腾讯「一键加群」页面，房主在这里复制组件代码 */
export const QQ_JOIN_PORTAL = "https://qun.qq.com/join.html";

/**
 * 从粘贴的 WPA 组件代码里取出 idkey。
 * 原版第三步粘贴的是完整 HTML 片段（形如
 * `<a target="_blank" href="//shang.qq.com/wpa/qunwpa?idkey=ee4f..."><img ...></a>`），
 * 但用户也可能只粘了 idkey 本身，两种都要认。
 */
export function extractIdKey(pasted: string): string | null {
  const text = pasted.trim();
  if (!text) return null;
  const fromHref = /[?&]idkey=([A-Za-z0-9_-]+)/.exec(text);
  if (fromHref) return fromHref[1];
  return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? text : null;
}