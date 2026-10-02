import { api, type ContentType, type ReportContentItem, type RoomContentItem } from "./api";
import type { LocalContentEntry } from "./types";

/** 本地扫描结果 → 上报项 */
export function toReportItems(kind: ContentType, entries: LocalContentEntry[]): ReportContentItem[] {
  return entries.map((entry) => ({
    name: entry.name,
    type: kind,
    sizeBytes: entry.sizeBytes,
    enabled: entry.enabled,
  }));
}

function fromMirror(items: RoomContentItem[]): ReportContentItem[] {
  return items.map((item) => ({
    name: item.name,
    type: item.type,
    sizeBytes: item.sizeBytes,
    enabled: item.enabled,
  }));
}

/**
 * 上报单类清单。
 * 后端 PUT /contents 是整表替换（先清空该房间全部记录再写入），
 * 所以必须把平台镜像里「另一类」原样带上，否则扫描插件会把 Mod 清单一起清掉。
 */
export async function syncRoomContents(
  roomId: number,
  kind: ContentType,
  items: ReportContentItem[],
): Promise<RoomContentItem[]> {
  const mirror = await api.roomContents(roomId).catch(() => [] as RoomContentItem[]);
  const kept = fromMirror(mirror.filter((item) => item.type !== kind));
  return api.reportRoomContents(roomId, [...kept, ...items]);
}

/** 全量上报：插件 + Mod 一次提交，整表替换语义下唯一不会互相覆盖的写法 */
export async function syncAllRoomContents(
  roomId: number,
  groups: Array<{ kind: ContentType; entries: LocalContentEntry[] }>,
): Promise<RoomContentItem[]> {
  return api.reportRoomContents(
    roomId,
    groups.flatMap((group) => toReportItems(group.kind, group.entries)),
  );
}