import { useState } from "react";
import { BriefTab } from "./tabs/BriefTab";
import { ConsoleTab } from "./tabs/ConsoleTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { LibraryTab } from "./tabs/LibraryTab";
import { SnapshotTab } from "./tabs/SnapshotTab";

const TABS = [
  { id: "brief", label: "基本信息" },
  { id: "console", label: "控制台" },
  { id: "settings", label: "服务端设置" },
  { id: "plugin", label: "插件" },
  { id: "mod", label: "Mod" },
  { id: "snapshot", label: "快照" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export function RoomManagePage({ roomId }: { roomId: number }) {
  const [tab, setTab] = useState<TabId>("brief");

  // 本页定位是**本地服务端控制台**：只管启停、配置、插件、快照，
  // 不登记为房间成员。「进入房间」只有一个入口——国服大厅点房间卡片（JoinPage 的 useRoomPresence）。
  // 心跳仍在 App.tsx 应用级（它负责让房间保持"在线"，与"谁在房间里"是两件事）。

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-4 border-b border-ljx-border bg-ljx-bg px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] transition-colors ${
              tab === t.id
                ? "border-ljx-accent font-medium text-ljx-accent"
                : "border-transparent text-ljx-text2 hover:text-ljx-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "brief" && <BriefTab roomId={roomId} onOpenTab={setTab} />}
        {tab === "console" && <ConsoleTab />}
        {tab === "settings" && <SettingsTab roomId={roomId} />}
        {tab === "plugin" && <LibraryTab roomId={roomId} kind="plugin" />}
        {tab === "mod" && <LibraryTab roomId={roomId} kind="mod" />}
        {tab === "snapshot" && <SnapshotTab roomId={roomId} />}
      </div>
    </div>
  );
}
