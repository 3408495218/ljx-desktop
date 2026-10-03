import { useState } from "react";
import type { ManageTarget } from "@/shared/types";
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

/**
 * 「我的游戏」管理页，两种目标：
 * - `{kind:"room"}`  —— 平台房间：六个页签全可用（详情、内容同步都走 roomId）
 * - `{kind:"local"}` —— 本机实例：离线开服用，没有 roomId。
 *   **控制台**是唯一纯本地的页签（零后端请求），默认落在它上面；
 *   其余页签的数据都在平台上，保留标签但显示空态，而不是直接消失 ——
 *   让用户看得见功能存在、只是当前连不上，比凭空少几个页签更不容易困惑。
 *
 * 本页定位是**本地服务端控制台**，不登记为房间成员。「进入房间」只有大厅卡片一个入口
 * （见 JoinPage 的 useRoomPresence）；心跳在 App.tsx 应用级，且只对平台房间上报。
 */
export function RoomManagePage({ target }: { target: ManageTarget }) {
  const local = target.kind === "local";
  const roomId = target.kind === "room" ? target.id : null;
  const [tab, setTab] = useState<TabId>(local ? "console" : "brief");

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
        {tab === "console" ? (
          <ConsoleTab />
        ) : roomId === null ? (
          <NeedsPlatform tab={tab} />
        ) : (
          <>
            {tab === "brief" && <BriefTab roomId={roomId} onOpenTab={setTab} />}
            {tab === "settings" && <SettingsTab roomId={roomId} />}
            {tab === "plugin" && <LibraryTab roomId={roomId} kind="plugin" />}
            {tab === "mod" && <LibraryTab roomId={roomId} kind="mod" />}
            {tab === "snapshot" && <SnapshotTab roomId={roomId} />}
          </>
        )}
      </div>
    </div>
  );
}

/** 本机实例下的空态：这些页签的数据都在平台上，没有房间可达就没有数据源 */
function NeedsPlatform({ tab }: { tab: TabId }) {
  const label = TABS.find((t) => t.id === tab)?.label ?? "该功能";
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="border border-ljx-border bg-ljx-surface px-5 py-8 text-center">
        <p className="mb-2 text-[14px] font-bold text-ljx-text">
          「{label}」需要连接平台
        </p>
        <p className="text-[12px] leading-6 text-ljx-text2">
          当前是<span className="text-ljx-text">本机实例</span>
          ：只在本机运行服务端，没有登记到平台，所以没有房间详情可以读写。
          <br />
          <span className="text-ljx-text">控制台</span>
          与所有本机进程操作不受影响，可继续使用。
        </p>
        <p className="mt-3 text-[12px] leading-6 text-ljx-text3">
          要用这些功能，先确认「设置」里的服务器地址可达，再回到「创建游戏」
          用「创建游戏（发布到大厅）」建一个平台房间。
        </p>
      </div>
    </div>
  );
}
