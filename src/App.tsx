import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAccountStore } from "@/stores/account";
import { usePreferencesStore } from "@/stores/preferences";
import { useServerProcStore } from "@/stores/serverProc";
import { APP_VERSION, OFFICIAL_QQ_GROUP } from "@/shared/constants";
import { api, type AnnouncementItem } from "@/shared/api";
import { useRoomHeartbeat } from "@/shared/useRoomHeartbeat";
import { useRoomPresence } from "@/shared/useRoomPresence";
import { playJoinChime } from "@/shared/chime";
import { connectLobbySocket } from "@/shared/lobbySocket";
import { useLobbyStore } from "@/stores/lobby";
import type { ManageTarget, ServerPhase } from "@/shared/types";
import houseLogo from "@/assets/icons/house-logo.png";
import downArrow from "@/assets/icons/down-arrow.png";
import gearIcon from "@/assets/icons/gear.png";
import { vipBadgeIcon } from "@/shared/shopIcons";
import { AccountDialog } from "@/features/account/AccountDialog";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { MallDialog } from "@/features/mall/MallDialog";
import { LobbyPage } from "@/features/lobby/LobbyPage";
import { CreatePage } from "@/features/create/CreatePage";
import { RoomManagePage } from "@/features/room-manage/RoomManagePage";
import { JoinPage } from "@/features/join/JoinPage";

type TabId = "lobby" | "create" | "join";

/** 房间会话在 localStorage 里的键（刷新后据此恢复"我在哪个房间"） */
const ROOM_SESSION_KEY = "ljx.roomSession";

const win = getCurrentWindow();

function WinControls() {
  const btn =
    "grid h-7 w-9 place-items-center text-ljx-text2 hover:bg-ljx-accent hover:text-white";
  return (
    <div className="flex items-stretch" data-tauri-drag-region={false}>
      <button className={btn} title="最小化" onClick={() => void win.minimize()}>
        <svg width="11" height="11" viewBox="0 0 11 11">
          <rect x="1" y="5" width="9" height="1" fill="currentColor" />
        </svg>
      </button>
      <button className={btn} title="最大化/还原" onClick={() => void win.toggleMaximize()}>
        <svg width="11" height="11" viewBox="0 0 11 11">
          <rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        className="grid h-7 w-9 place-items-center text-ljx-text2 hover:bg-[#c0392b] hover:text-white"
        title="关闭"
        onClick={() => void win.close()}
      >
        <svg width="11" height="11" viewBox="0 0 11 11">
          <path d="M1.5 1.5 L9.5 9.5 M9.5 1.5 L1.5 9.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabId>("lobby");
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mallOpen, setMallOpen] = useState(false);
  // 「我的游戏」的管理对象：平台房间 / 本机实例（离线开服）。
  // 用带标签的联合类型而不是 `number | null` + 哨兵值，调用点就不必猜语义。
  const [manageTarget, setManageTarget] = useState<ManageTarget | null>(null);
  // 持久化「我在哪个房间」：刷新页面、HMR 热更新都不该把我踢出房间——
  // 否则每次改代码/刷新都会 DELETE /presence，人数就归零了（本轮踩过）
  // 公告轮播（底部状态栏右侧）：无公告时回退显示官方 QQ 群文案
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  // 轮播间隔由后台配置（app_config.announcement_rotate_seconds），随公告一起下发
  const [rotateSeconds, setRotateSeconds] = useState(8);
  const [announcementIndex, setAnnouncementIndex] = useState(0);

  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(() => {
    const saved = window.localStorage.getItem(ROOM_SESSION_KEY);
    return saved === null ? null : Number(saved);
  });
  const account = useAccountStore((s) => s.account);
  const accountId = account?.id ?? null;
  const phase = useServerProcStore((s) => s.phase);
  const serverAddress = usePreferencesStore((s) => s.serverAddress);

  useEffect(() => {
    void (async () => {
      await usePreferencesStore.getState().init();
      // 服务端配置决定房间工作目录（快照 / 配置编辑 / 危险区），必须一并还原
      useServerProcStore.getState().hydrate();
      // 与 Rust 侧实际状态对一次：进程可能还在跑（例如前端刚重启），
      // 不校准的话 phase 会是 idle，心跳就不会启动
      void useServerProcStore.getState().refresh();
      await useAccountStore.getState().init();
    })();
  }, []);

  // 供推送回调读取最新的「我的房间」，避免为它重建 WebSocket 连接
  const manageRoomRef = useRef<number | null>(null);
  useEffect(() => {
    manageRoomRef.current = manageTarget?.kind === "room" ? manageTarget.id : null;
  }, [manageTarget]);

  // 大厅推送：人数 / 在线状态由后端在事务提交后推送到 /topic/lobby（毫秒级），
  // 不必等列表轮询。连接失败、断网或后端未升级时，LobbyPage 的轮询仍是兜底来源。
  // 注意：serverAddress 为空串是**正常状态**（用户从没配过地址），
  // resolveApiBaseUrl 会回落到默认 127.0.0.1:8080——所以这里绝不能因为"地址为空"就跳过连接，
  // 否则推送永远建不起来（本轮踩过）。仍然依赖 serverAddress：改地址后自动重连。
  useEffect(() => {
    return connectLobbySocket((event) => {
      // 公告变更：后台改完后立刻重拉（原来是 5 分钟轮询，最长要等一轮才看到）
      if (event.type === "ANNOUNCEMENT") {
        void api
          .announcements()
          .then((payload) => {
            setAnnouncements(payload.items);
            setRotateSeconds(payload.rotateSeconds);
          })
          .catch(() => {
            // 拉取失败不影响使用：底部回退显示 QQ 群文案，下一轮轮询还会再试
          });
        return;
      }

      // 播放提示音前先取旧值：判断"人数是不是真的增加了"（切页签、改名等事件不该响）
      const before = useLobbyStore
        .getState()
        .rooms.find((room) => room.id === event.roomId)?.players;
      useLobbyStore.getState().applyEvent(event);
      // 「加入提醒提示音」：有人进入我自己的房间时响一声；开关在「国服大厅」右上角
      if (
        usePreferencesStore.getState().soundOn &&
        event.type === "PLAYERS" &&
        manageRoomRef.current === event.roomId &&
        before !== undefined &&
        event.players > before
      ) {
        playJoinChime();
      }
    });
  }, [serverAddress]);

  // 服务端状态事件必须在应用级接收：它决定心跳的启用条件（phase）。
  // 只在控制台页监听的话，切走之后「服务端异常退出」这类事件就收不到，
  // phase 会停在 running——房间挂着「在线」，心跳却还在为一个早已死掉的服务端上报。
  useEffect(() => {
    const un = listen<{ phase: ServerPhase; detail: string }>("server://state", (e) => {
      useServerProcStore.getState().setPhase(e.payload.phase, e.payload.detail);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // 公告是公开接口（不需要登录）：进入应用拉一次 + 每 5 分钟轻刷。
  // 公告变更频率极低，不做实时推送；拉不到也不影响使用（底部回退 QQ 群文案）。
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await api.announcements();
        if (!cancelled) {
          setAnnouncements(payload.items);
          setRotateSeconds(payload.rotateSeconds);
        }
      } catch {
        // 忽略：公告拿不到时底部显示默认文案
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [serverAddress]);

  // 多条公告按后台配置的间隔轮播（默认 8 秒）；用取模兜底，公告被删掉后不会越界
  useEffect(() => {
    if (announcements.length <= 1) return;
    const timer = window.setInterval(
      () => setAnnouncementIndex((i) => (i + 1) % announcements.length),
      Math.max(3, rotateSeconds) * 1000,
    );
    return () => window.clearInterval(timer);
  }, [announcements.length, rotateSeconds]);

  // 登录后拉「我的游戏」：名下已有房间则页签自动切到「我的游戏」并进入管理页
  useEffect(() => {
    if (accountId === null) {
      setManageTarget((prev) => (prev?.kind === "local" ? prev : null));
      return;
    }
    let cancelled = false;
    // 用更新函数读旧值，避免再加一个 ref。
    // **本机实例是用户显式选择的**：后端恰好连上、拿到访客身份时不能把它顶掉，
    // 否则「离线开服中途后端恢复」会把用户直接踢出控制台。
    const keepLocal = (prev: ManageTarget | null) => (prev?.kind === "local" ? prev : undefined);
    void (async () => {
      try {
        const rooms = await api.myRooms();
        if (cancelled) return;
        setManageTarget(
          (prev) => keepLocal(prev) ?? (rooms.length > 0 ? { kind: "room", id: rooms[0].id } : null),
        );
      } catch {
        if (!cancelled) setManageTarget((prev) => keepLocal(prev) ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // 房间心跳必须在应用级：挂在「我的游戏」页里的话，房主一切到大厅 / 当前加入，
  // 上报就停了——房间仍显示「在线」（90 秒内不判离线），但玩家进出根本传不到平台，
  // 表现就是「人数永远是 0」。这里与当前页签无关，只要服务端在跑就持续上报。
  // 只有平台房间需要心跳（维持"在线"）。本机实例没有房间可上报，
  // 传 null 即可 —— 里面 `roomId !== null` 已是总开关。
  useRoomHeartbeat(
    manageTarget?.kind === "room" ? manageTarget.id : null,
    phase === "running" || phase === "starting",
  );

  // 「我在哪个房间」由 selectedRoomId 这个**会话状态**决定，而不是由某个页面是否挂载决定。
  // 之前把它挂在「当前加入」页里，结果切到大厅看卡片时 JoinPage 卸载 → 立刻 DELETE /presence
  // → 成员被删 → 卡片人数变 0（"看人数"这个动作反而把人数清零了）。
  // 现在切页签不影响上报，只有点「退出房间」（selectedRoomId 置空）才真正离开。
  // blocked：被房间门槛挡下（上锁 / 需要邮箱 / 禁止游客）时，"当前加入"页要明确拦下来。
  // 详情接口是公开的（看大厅要用），所以访客能打开页面，但必须知道自己进不去。
  const { blocked: presenceBlocked, checked: presenceChecked } = useRoomPresence(
    selectedRoomId,
    accountId !== null,
  );

  // 会话落盘：退出房间（置 null）时清掉，否则下次启动会误以为还在房间里
  useEffect(() => {
    if (selectedRoomId === null) {
      window.localStorage.removeItem(ROOM_SESSION_KEY);
    } else {
      window.localStorage.setItem(ROOM_SESSION_KEY, String(selectedRoomId));
    }
  }, [selectedRoomId]);

  const createLabel = manageTarget === null ? "创建游戏" : "我的游戏";

  function openRoom(roomId: number) {
    setSelectedRoomId(roomId);
    setTab("join");
  }

  function created(roomId: number) {
    setManageTarget({ kind: "room", id: roomId });
  }

  /** 「本机开服」：不建房间、不连后端，直接进控制台（离线也能开服） */
  function startLocal() {
    setManageTarget({ kind: "local" });
  }

  // 顶栏 VIP 徽章按档位取图：VIP3 是钻石档。
  // 此前这里写死了一张图（=金块），所以不管什么档位都显示金块。
  const vipBadgeSrc = account ? vipBadgeIcon(account.vip) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标题栏：房子 logo + 标题 | 商城 + 账号 + 窗口控制 */}
      <header
        className="flex items-center gap-3 bg-ljx-bg2 pl-2.5"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <img src={houseLogo} alt="" className="h-6 w-6" draggable={false} />
          <span className="text-[14px] font-medium text-ljx-text">我的世界垃圾侠</span>
        </div>
        <div className="ml-auto flex items-center gap-2" data-tauri-drag-region>
          <button
              className="border border-ljx-accent-deep px-2.5 py-[3px] text-[12px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white"
              onClick={() => setMallOpen(true)}
            >
              商城
            </button>
            <button
              className="ml-1 grid h-6 w-7 place-items-center opacity-75 hover:opacity-100"
              title="设置"
              data-tauri-drag-region
              onClick={() => setSettingsOpen(true)}
            >
              <img src={gearIcon} alt="设置" className="h-4 w-4" draggable={false} />
            </button>
          {account ? (
            <button
              className="flex items-center gap-1.5 hover:opacity-80"
              onClick={() => setAccountOpen(true)}
            >
              {account.vip !== null && (
                <span className="flex items-center gap-[3px] bg-ljx-deep px-1.5 py-[2px] text-[12px] text-ljx-gold">
                  {vipBadgeSrc && (
                    <img src={vipBadgeSrc} alt="" className="h-4 w-4" draggable={false} />
                  )}
                  VIP{account.vip}
                </span>
              )}
              <span className="bg-ljx-deep px-2 py-[2px] text-[12px] text-ljx-text2">
                LV{account.level}
              </span>
              <span className="text-[12px] text-ljx-text">{account.username}</span>
              <img src={downArrow} alt="" className="h-3 w-3 opacity-70" />
            </button>
          ) : (
            <button
              className="flex items-center gap-1.5 text-[12px] text-ljx-text hover:text-ljx-accent"
              onClick={() => setAccountOpen(true)}
            >
              未登录
              <img src={downArrow} alt="" className="h-3 w-3 opacity-70" />
            </button>
          )}
          <WinControls />
        </div>
      </header>

      {/* 主导航：橙色下划线页签 */}
      <nav className="flex gap-6 border-b border-ljx-border bg-ljx-bg px-4">
        {(
          [
            { id: "lobby", label: "国服大厅" },
            { id: "create", label: createLabel },
            { id: "join", label: "当前加入" },
          ] as Array<{ id: TabId; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-1 py-2 text-[13px] transition-colors ${
              tab === t.id
                ? "border-ljx-accent font-medium text-ljx-accent"
                : "border-transparent text-ljx-text2 hover:text-ljx-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "lobby" && <LobbyPage onOpenRoom={openRoom} />}
        {tab === "create" &&
          (manageTarget === null ? (
            <CreatePage
              onCreated={created}
              onStartLocal={startLocal}
              onNeedAccount={() => setAccountOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <RoomManagePage target={manageTarget} />
          ))}
        {tab === "join" && (
          <JoinPage
            blocked={presenceBlocked}
            enterChecked={presenceChecked}
            roomId={selectedRoomId}
            onNeedAccount={() => setAccountOpen(true)}
            onLeaveRoom={() => setSelectedRoomId(null)}
          />
        )}
      </main>

      {/* 状态栏 */}
      <footer className="flex items-center gap-4 bg-ljx-deep px-3 py-1 text-[11px]">
        <span className="text-ljx-text3">
          垃圾侠 {APP_VERSION} · 游戏资源由官方源提供，本平台不提供游戏分发
        </span>
        <span className="ml-auto truncate text-ljx-accent">
          {announcements.length > 0
            ? announcements[announcementIndex % announcements.length]?.content
            : `问题反馈，请加官方QQ群：${OFFICIAL_QQ_GROUP}`}
        </span>
      </footer>

      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MallDialog
        open={mallOpen}
        onClose={() => setMallOpen(false)}
        onNeedAccount={() => setAccountOpen(true)}
          manageRoomId={manageTarget?.kind === "room" ? manageTarget.id : null}
      />
    </div>
  );
}
