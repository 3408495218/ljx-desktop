import { useEffect, useState } from "react";
import { useLobbyStore } from "@/stores/lobby";
import { useAccountStore } from "@/stores/account";
import { usePreferencesStore } from "@/stores/preferences";
import { api, errorText } from "@/shared/api";
import { MC_VERSION_OPTIONS, MODE_OPTIONS } from "@/shared/constants";
import type { LobbyView } from "@/shared/types";
import gridIcon from "@/assets/icons/grid.png";
import starIcon from "@/assets/icons/star.png";
import pawIcon from "@/assets/icons/paw.png";
import searchIcon from "@/assets/icons/search.png";
import refreshIcon from "@/assets/icons/refresh.png";
import pagePrevIcon from "@/assets/icons/page-prev.png";
import pageNextIcon from "@/assets/icons/page-next.png";
import { RoomCard } from "./RoomCard";

const VIEW_TABS: Array<{ id: LobbyView; label: string; icon: string }> = [
  { id: "all", label: "全部", icon: gridIcon },
  { id: "favorite", label: "收藏", icon: starIcon },
  { id: "history", label: "足迹", icon: pawIcon },
];

export function LobbyPage({ onOpenRoom }: { onOpenRoom: (id: number) => void }) {
  const { view, filters, page, total, rooms, loading, error, setView, setFilters, setPage, refresh } =
    useLobbyStore();
  const soundOn = usePreferencesStore((s) => s.soundOn);
  const setSoundOn = usePreferencesStore((s) => s.setSoundOn);
  const accountReady = useAccountStore((s) => s.ready);
  const loggedIn = useAccountStore((s) => s.account !== null);
  /** 足迹清理的提交态与结果提示；与列表加载态分开，避免清空时整页闪「正在加载」 */
  const [footBusy, setFootBusy] = useState(false);
  const [footHint, setFootHint] = useState<string | null>(null);

  // 人数变化由后端 WebSocket 推送（见 App.tsx 的 connectLobbySocket）驱动，是毫秒级的；
  // 这里的轮询只是**兜底**：连接失败、断网或后端未升级时仍能更新，所以间隔放到 30 秒。
  // 静默模式：不切整页加载态、失败不清空列表，避免闪烁与误清空。
  useEffect(() => {
    if (!accountReady || !loggedIn) return;
    void refresh(true);
    const timer = window.setInterval(() => void refresh(true), 30_000);
    return () => window.clearInterval(timer);
  }, [accountReady, loggedIn, refresh]);

  // 切换视图后旧的清理提示不再适用
  useEffect(() => {
    setFootHint(null);
  }, [view]);

  async function removeFootprint(roomId: number) {
    if (footBusy) return;
    setFootBusy(true);
    setFootHint(null);
    try {
      await api.removeFootprint(roomId);
      await refresh();
    } catch (e) {
      setFootHint(errorText(e));
    } finally {
      setFootBusy(false);
    }
  }

  async function clearFootprints() {
    if (footBusy) return;
    if (!window.confirm("确定清空全部足迹吗？此操作不可撤销。")) return;
    setFootBusy(true);
    setFootHint(null);
    try {
      await api.clearFootprints();
      await refresh();
      setFootHint("已清空全部足迹");
    } catch (e) {
      setFootHint(errorText(e));
    } finally {
      setFootBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏：三视图 | 版本/玩法筛选 | 搜索 | 刷新 | 声音 | 分页 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ljx-border bg-ljx-bg px-4 py-2">
        {VIEW_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`flex items-center gap-1.5 px-1 py-0.5 text-[13px] ${
              view === t.id
                ? "text-ljx-accent"
                : "text-ljx-text2 hover:text-ljx-text"
            }`}
          >
            <img src={t.icon} alt="" className="h-4 w-4" draggable={false} />
            {t.label}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-ljx-border" />

        <select
          className="border border-ljx-border bg-ljx-deep px-2 py-1 text-[12px] text-ljx-text2"
          value={filters.mcVersion}
          onChange={(e) => setFilters({ mcVersion: e.target.value })}
        >
          <option value="">所有版本</option>
          {MC_VERSION_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        <select
          className="border border-ljx-border bg-ljx-deep px-2 py-1 text-[12px] text-ljx-text2"
          value={filters.mode}
          onChange={(e) => setFilters({ mode: e.target.value })}
        >
          <option value="">所有玩法</option>
          {MODE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          className="w-44 border border-ljx-border bg-ljx-deep px-2.5 py-1 text-[12px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent"
          placeholder="输入房间名称回车"
          value={filters.keyword}
          onChange={(e) => setFilters({ keyword: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") void refresh();
          }}
        />
        <button
          className="grid h-[26px] w-[30px] place-items-center bg-ljx-bg2 hover:brightness-110"
          title="搜索"
          onClick={() => void refresh()}
        >
          <img src={searchIcon} alt="" className="h-4 w-4" draggable={false} />
        </button>
        <button
          className="grid h-[26px] w-[30px] place-items-center bg-ljx-bg2 hover:brightness-110"
          title="刷新"
          onClick={() => void refresh()}
        >
          <img src={refreshIcon} alt="" className="h-4 w-4" draggable={false} />
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* 原版这里配的 sound-on/off.png 本身就是"开""关"两个汉字，与文字叠加会显示"开开"，
              故只保留文字，并把文案写清用途（避免"这个开关是干什么的"疑惑） */}
          <button
            className="px-1 text-[12px] text-ljx-text2 hover:text-ljx-text"
            title={
              soundOn
                ? "加入提醒提示音：开（有人进入我的房间时响一声）"
                : "加入提醒提示音：关"
            }
            onClick={() => setSoundOn(!soundOn)}
          >
            提示音：{soundOn ? "开" : "关"}
          </button>
          <button
            className="grid h-[26px] w-[26px] place-items-center text-ljx-text2 hover:text-ljx-text disabled:opacity-30"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            title="上一页"
          >
            <img src={pagePrevIcon} alt="" className="h-3 w-3" draggable={false} />
          </button>
          <span className="text-[12px] text-ljx-text2">
            {page}/{total}
          </span>
          <button
            className="grid h-[26px] w-[26px] place-items-center text-ljx-text2 hover:text-ljx-text disabled:opacity-30"
            disabled={page >= total}
            onClick={() => setPage(page + 1)}
            title="下一页"
          >
            <img src={pageNextIcon} alt="" className="h-3 w-3" draggable={false} />
          </button>
        </div>
      </div>

      {/* 足迹视图的清理条：单条移除在卡片上，整表清空走这里 */}
      {view === "history" && (
        <div className="flex items-center gap-3 border-b border-ljx-border bg-ljx-deep px-4 py-1.5">
          <span className="text-[12px] text-ljx-text3">浏览历史（悬停卡片可单条移除）</span>
          <button
            className="ml-auto border border-ljx-border px-2 py-[2px] text-[12px] text-ljx-text2 hover:border-ljx-accent hover:text-ljx-accent disabled:opacity-40"
            disabled={footBusy || rooms.length === 0}
            onClick={() => void clearFootprints()}
          >
            {footBusy ? "处理中…" : "清空全部足迹"}
          </button>
        </div>
      )}
      {footHint && (
        <p className="border-b border-ljx-border bg-ljx-deep px-4 py-1.5 text-[12px] text-ljx-accent">
          {footHint}
        </p>
      )}

      {/* 房间网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!accountReady ? (
          <div className="py-24 text-center text-[13px] text-ljx-text3">正在恢复登录状态…</div>
        ) : !loggedIn ? (
          <div className="py-24 text-center text-[13px] text-ljx-text3">
            登录后即可查看国服大厅
          </div>
        ) : loading && rooms.length === 0 ? (
          <div className="py-24 text-center text-[13px] text-ljx-text3">正在加载房间列表…</div>
        ) : error ? (
          <div className="py-24 text-center text-[13px] text-ljx-accent">{error}</div>
        ) : rooms.length === 0 ? (
          <div className="py-24 text-center text-[13px] text-ljx-text3">没有符合条件的房间</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                onOpen={onOpenRoom}
                onRemoveFootprint={view === "history" ? (id) => void removeFootprint(id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
