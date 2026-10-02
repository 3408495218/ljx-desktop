import { useEffect, useState } from "react";
import grassBlock from "@/assets/icons/grass-block.png";
import qqBanner from "@/assets/icons/qq-banner.png";
import { useRoomDetail } from "@/shared/useRoomDetail";
import { useRoomServerDir } from "@/shared/useRoomServerDir";
import { useServerProcStore } from "@/stores/serverProc";
import { api, errorText, hasSession } from "@/shared/api";
import { CORE_VERSION_OPTIONS, MODE_OPTIONS } from "@/shared/constants";
import { copyText } from "@/shared/clipboard";
import { modsList, openMcLauncher, openUrl } from "@/shared/tauri";
import { syncAllRoomContents } from "@/shared/roomContentsSync";
import { qqGroupJoinUrl } from "@/shared/qqGroup";
import type { TabId } from "../RoomManagePage";
import { QqGroupDialog } from "../QqGroupDialog";

/** 三个互斥的编辑态：封面 / 房间信息 / 公网地址，避免入口点了都跳到同一个表单 */
type EditorMode = "cover" | "info" | "net";

export function BriefTab({
  roomId,
  onOpenTab,
}: {
  roomId: number;
  onOpenTab: (tab: TabId) => void;
}) {
  // 房间成员靠推送即时更新；这里加 10 秒轮询作为推送不可用时的兜底
  const { detail, error, loading, reload } = useRoomDetail(roomId, 10_000);
  const { dir } = useRoomServerDir();
  const phase = useServerProcStore((s) => s.phase);
  const start = useServerProcStore((s) => s.start);
  const serverRunning = phase === "running" || phase === "starting";

  const [hint, setHint] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [counts, setCounts] = useState({ plugin: 0, mod: 0 });
  const [qqOpen, setQqOpen] = useState(false);

  const [infoForm, setInfoForm] = useState({
    name: "",
    intro: "",
    version: "",
    mode: "",
    capacity: 1,
  });
  const [coverForm, setCoverForm] = useState({ coverUrl: "" });
  const [netForm, setNetForm] = useState({ host: "", port: 25565 });

  // 插件 / Mod 数量取平台侧的清单镜像（房主在本地页扫描后上报）
  useEffect(() => {
    if (!hasSession()) return;
    let alive = true;
    api
      .roomContents(roomId)
      .then((list) => {
        if (!alive) return;
        setCounts({
          plugin: list.filter((item) => item.type === "plugin").length,
          mod: list.filter((item) => item.type === "mod").length,
        });
      })
      .catch(() => {
        if (alive) setCounts({ plugin: 0, mod: 0 });
      });
    return () => {
      alive = false;
    };
  }, [roomId]);

  if (loading && !detail) {
    return <div className="grid h-full place-items-center text-[13px] text-ljx-text3">正在加载房间…</div>;
  }
  if (!detail) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-ljx-accent">
        {error ?? "房间不可用"}
      </div>
    );
  }

  const localPort = detail.port ?? 25565;
  /** 房间成员（进入房间即计数，与大厅卡片的人数同源）；inGame 表示是否已进入服务端 */
  const members = detail.members ?? [];
  /** 已点亮加群时才有链接；未点亮则只提供设置入口 */
  const qqUrl = qqGroupJoinUrl(detail.qqGroupIdKey);
  const currentVersion = `${detail.core}-${detail.mcVersion}`;
  /** 房间当前值可能不在预设选项里，补进去避免下拉框静默改成别的值 */
  const versionOptions: string[] = (CORE_VERSION_OPTIONS as readonly string[]).includes(currentVersion)
    ? [...CORE_VERSION_OPTIONS]
    : [currentVersion, ...CORE_VERSION_OPTIONS];
  const modeOptions: string[] = (MODE_OPTIONS as readonly string[]).includes(detail.mode ?? "")
    ? [...MODE_OPTIONS]
    : detail.mode
      ? [detail.mode, ...MODE_OPTIONS]
      : [...MODE_OPTIONS];

  async function launch() {
    setHint(null);
    // 房主视角：先把本机服务端拉起来，再引导客户端连接
    if (phase === "idle" || phase === "failed") {
      setLaunching(true);
      const err = await start();
      setLaunching(false);
      if (err) {
        setHint(`${err}。请在「控制台」配置 Java 运行时与核心 jar 路径`);
        onOpenTab("console");
        return;
      }
      setHint("服务端正在启动，启动完成后可再次点击以复制地址并打开客户端");
      onOpenTab("console");
      return;
    }
    if (phase === "starting" || phase === "stopping") {
      setHint("服务端正在启停中，请稍候…");
      onOpenTab("console");
      return;
    }
    // 已运行：复制本机地址并打开系统启动器
    const address = `127.0.0.1:${localPort}`;
    const copied = await copyText(address);
    try {
      await openMcLauncher();
      setHint(
        copied
          ? `已复制本机地址 ${address}，正在打开 Minecraft 启动器`
          : `本机地址 ${address}（复制失败，请手动输入），正在打开 Minecraft 启动器`,
      );
    } catch (e) {
      setHint(`已复制本机地址 ${address}，但打开启动器失败：${String(e)}`);
    }
  }

  function openEditor(mode: EditorMode) {
    setEditError(null);
    if (mode === "cover") {
      setCoverForm({ coverUrl: detail!.cover ?? "" });
    } else if (mode === "info") {
      setInfoForm({
        name: detail!.name,
        intro: detail!.intro ?? "",
        version: currentVersion,
        mode: detail!.mode ?? MODE_OPTIONS[0],
        capacity: detail!.capacity,
      });
    } else {
      setNetForm({ host: detail!.host ?? "", port: detail!.port ?? 25565 });
    }
    setEditor(mode);
  }

  /** 三个编辑态共用的收尾：关面板 → 拉最新详情 → 提示 */
  async function save(okText: string, body: Parameters<typeof api.updateRoom>[1]) {
    setSaving(true);
    setEditError(null);
    try {
      await api.updateRoom(roomId, body);
      setEditor(null);
      await reload();
      setHint(okText);
    } catch (e) {
      setEditError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveCover() {
    await save("封面已更新", { coverUrl: coverForm.coverUrl.trim() });
  }

  async function saveInfo() {
    if (!infoForm.name.trim()) {
      setEditError("请填写房间名称");
      return;
    }
    const [core, mcVersion] = splitVersion(infoForm.version);
    await save("房间信息已更新", {
      name: infoForm.name.trim(),
      intro: infoForm.intro,
      core,
      mcVersion,
      mode: infoForm.mode,
      capacity: Math.max(infoForm.capacity || 1, 1),
    });
  }

  async function saveNet() {
    const host = netForm.host.trim();
    const port = Number(netForm.port);
    if (!host) {
      setEditError("请填写公网地址（IP 或域名）");
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setEditError("端口需为 1-65535 之间的整数");
      return;
    }
    await save("公网地址已登记，玩家「当前加入」时即可拿到该地址", { host, port });
  }

  /** 扫描本机 plugins / mods 目录并整体上报：两类一次提交，避免整表替换互相清空 */
  async function syncContents() {
    if (!dir) {
      setHint("尚未定位到服务端工作目录，请先在「控制台」配置核心 jar 路径");
      return;
    }
    setSyncing(true);
    setHint(null);
    try {
      const [plugins, mods] = await Promise.all([
        modsList(dir, "plugin"),
        modsList(dir, "mod"),
      ]);
      const list = await syncAllRoomContents(roomId, [
        { kind: "plugin", entries: plugins },
        { kind: "mod", entries: mods },
      ]);
      setCounts({
        plugin: list.filter((item) => item.type === "plugin").length,
        mod: list.filter((item) => item.type === "mod").length,
      });
      setHint(`已同步到平台：插件 ${plugins.length} 个、Mod ${mods.length} 个`);
    } catch (e) {
      setHint(`清单同步失败：${String(e)}`);
    } finally {
      setSyncing(false);
    }
  }

  const fieldCls =
    "w-full border border-ljx-border bg-ljx-deep px-2.5 py-1.5 text-[13px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent";
  const labelCls = "mb-1 block text-[12px] text-ljx-text3";
  const ghostBtn =
    "border border-ljx-border bg-ljx-bg2 px-3 py-1 text-[12px] text-ljx-text2 hover:text-ljx-text disabled:opacity-60";

  /** 房主自测加群入口：链接由已保存的 idkey 拼出 */
  async function openQqGroupLink() {
    if (!qqUrl) return;
    try {
      await openUrl(qqUrl);
    } catch (e) {
      setHint(String(e));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 gap-5 overflow-hidden p-5">
        {/* 左：封面 + 名称 + QQ群 + 收藏 */}
        <div className="flex w-44 shrink-0 flex-col items-center gap-2">
          <img
            src={detail.cover || grassBlock}
            alt="房间封面"
            className="h-32 w-32 border-2 border-ljx-cardborder object-cover"
            draggable={false}
          />
          <span className="max-w-full truncate text-[15px] font-bold text-ljx-text">{detail.name}</span>
          <span className={`text-[12px] ${detail.online ? "text-ljx-green" : "text-ljx-text3"}`}>
            {detail.online ? `在线 ${detail.players}/${detail.capacity}` : "离线"}
          </span>
          {/* 已点亮：按钮直接跳腾讯加群页；未点亮：引导房主走三步设置 */}
          {qqUrl ? (
            <>
              <button
                className="hover:brightness-110"
                title={detail.qqGroupCode ? `加入QQ群 ${detail.qqGroupCode}` : "加入QQ群"}
                onClick={() => void openQqGroupLink()}
              >
                <img src={qqBanner} alt="加入QQ群" className="h-[22px]" draggable={false} />
              </button>
              <button
                className="text-[11px] text-ljx-text3 hover:text-ljx-accent"
                onClick={() => setQqOpen(true)}
              >
                修改加群设置
              </button>
            </>
          ) : (
            <button
              className="flex items-center gap-1 text-[12px] text-ljx-text3 hover:text-ljx-accent"
              title="点亮后房间会展示「加入QQ群」入口"
              onClick={() => setQqOpen(true)}
            >
              <img src={qqBanner} alt="" className="h-[18px] opacity-40" draggable={false} />
              点亮QQ加群
            </button>
          )}
          <span className="text-[12px] text-ljx-accent">收藏({detail.favoriteCount})</span>
        </div>

        {/* 中：介绍 / 版本 / 插件 / 模组 + 三个互斥编辑态 */}
        <div className="flex-1 overflow-y-auto">
          {editor === "cover" ? (
            <div className="space-y-3">
              <h3 className="text-[13px] font-bold text-ljx-text">修改封面</h3>
              <img
                src={coverForm.coverUrl.trim() || grassBlock}
                alt="封面预览"
                className="h-32 w-32 border-2 border-ljx-cardborder object-cover"
                draggable={false}
              />
              <label className="block">
                <span className={labelCls}>封面图片地址</span>
                <input
                  className={fieldCls}
                  placeholder="网络图片直链，如 https://…/cover.png"
                  value={coverForm.coverUrl}
                  maxLength={255}
                  onChange={(e) => setCoverForm({ coverUrl: e.target.value })}
                />
              </label>
              <p className="text-[12px] text-ljx-text3">
                留空表示保持原封面不变（暂不支持清空回默认草方块）。
              </p>
              <EditorActions
                saving={saving}
                onSave={() => void saveCover()}
                onCancel={() => setEditor(null)}
                error={editError}
              />
            </div>
          ) : editor === "info" ? (
            <div className="space-y-3">
              <h3 className="text-[13px] font-bold text-ljx-text">修改信息</h3>
              <label className="block">
                <span className={labelCls}>房间名称</span>
                <input
                  className={fieldCls}
                  value={infoForm.name}
                  maxLength={64}
                  onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={labelCls}>简介</span>
                <textarea
                  className={`${fieldCls} h-20 resize-none`}
                  value={infoForm.intro}
                  maxLength={500}
                  onChange={(e) => setInfoForm({ ...infoForm, intro: e.target.value })}
                />
              </label>
              <div className="flex gap-4">
                <label className="block flex-1">
                  <span className={labelCls}>游戏版本</span>
                  <input
                    className={fieldCls}
                    list="ljx-core-versions"
                    placeholder="选择或直接输入，如 Paper-1.20.4"
                    value={infoForm.version}
                    onChange={(e) => setInfoForm({ ...infoForm, version: e.target.value })}
                  />
                  {/* 可输入 + 下拉建议：固定选项之外还允许手输任意「核心-版本」 */}
                  <datalist id="ljx-core-versions">
                    {versionOptions.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </label>
                <label className="block w-32">
                  <span className={labelCls}>游戏属性</span>
                  <select
                    className={fieldCls}
                    value={infoForm.mode}
                    onChange={(e) => setInfoForm({ ...infoForm, mode: e.target.value })}
                  >
                    {modeOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block w-32">
                  <span className={labelCls}>玩家容量</span>
                  <input
                    type="number"
                    min={1}
                    className={fieldCls}
                    value={infoForm.capacity}
                    onChange={(e) =>
                      setInfoForm({ ...infoForm, capacity: Number(e.target.value) || 1 })
                    }
                  />
                </label>
              </div>
              <p className="text-[12px] text-ljx-text3">
                版本与属性仅作展示与筛选标记，实际服务端核心仍以本机运行的 jar 为准。
              </p>
              <EditorActions
                saving={saving}
                onSave={() => void saveInfo()}
                onCancel={() => setEditor(null)}
                error={editError}
              />
            </div>
          ) : editor === "net" ? (
            <div className="space-y-3">
              <h3 className="text-[13px] font-bold text-ljx-text">公网地址</h3>
              <p className="text-[12px] leading-5 text-ljx-text3">
                玩家「当前加入」时会拿到这个地址。内网穿透 / 端口映射后，把对外暴露的 IP 或域名
                与端口登记在这里。
              </p>
              <div className="flex gap-4">
                <label className="block flex-1">
                  <span className={labelCls}>公网地址（IP 或域名）</span>
                  <input
                    className={fieldCls}
                    placeholder="例如 123.45.67.89 或 play.example.com"
                    value={netForm.host}
                    maxLength={64}
                    onChange={(e) => setNetForm({ ...netForm, host: e.target.value })}
                  />
                </label>
                <label className="block w-32">
                  <span className={labelCls}>端口</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    className={fieldCls}
                    value={netForm.port}
                    onChange={(e) => setNetForm({ ...netForm, port: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>
              <p className="text-[12px] text-ljx-text3">
                本机自测地址仍为 <span className="font-mono">127.0.0.1:{localPort}</span>。
              </p>
              <EditorActions
                saving={saving}
                onSave={() => void saveNet()}
                onCancel={() => setEditor(null)}
                error={editError}
              />
            </div>
          ) : (
            <>
              <div className="mb-2 text-[13px] text-ljx-text2">
                <span className="mr-2 text-ljx-text3">介绍:</span>
                {detail.intro || "（未填写）"}
              </div>
              <div className="mb-2 text-[13px] text-ljx-text2">
                <span className="mr-2 text-ljx-text3">版本:</span>
                <span className="border border-ljx-border bg-ljx-deep px-2 py-0.5 text-ljx-text">
                  {detail.core}-{detail.mcVersion}
                </span>
                <span className="ml-2 text-ljx-text3">{detail.mode}</span>
              </div>
              <div className="mb-4 flex gap-6 text-[13px] text-ljx-text2">
                <span>
                  <span className="mr-1 text-ljx-text3">插件(</span>
                  {counts.plugin}
                  <span className="text-ljx-text3">)</span>
                </span>
                <span>
                  <span className="mr-1 text-ljx-text3">模组(</span>
                  {counts.mod}
                  <span className="text-ljx-text3">)</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={ghostBtn} onClick={() => openEditor("cover")}>
                  修改封面
                </button>
                <button className={ghostBtn} onClick={() => openEditor("info")}>
                  修改信息
                </button>
                <button className={ghostBtn} onClick={() => openEditor("net")}>
                  公网地址
                </button>
                <button
                  className={ghostBtn}
                  disabled={syncing}
                  title="扫描本机 plugins / mods 目录并上报平台镜像"
                  onClick={() => void syncContents()}
                >
                  {syncing ? "同步中…" : "同步插件/Mod清单"}
                </button>
              </div>
              <p className="mt-3 text-[12px] text-ljx-text3">
                房间号 #{detail.id} · 房主 {detail.ownerName} · 容量 {detail.capacity}
                {detail.host ? ` · 公网 ${detail.host}:${localPort}` : " · 未登记公网地址"}
              </p>
              <p className="mt-1 text-[12px] text-ljx-text3">
                本机地址：<span className="font-mono text-ljx-text2">127.0.0.1:{localPort}</span>
              </p>
            </>
          )}
        </div>

        {/* 右：房间成员（与大厅卡片人数同源）；状态列表示是否已进入游戏 */}
        <div className="w-64 shrink-0 border border-ljx-border bg-ljx-surface p-3">
          <div className="mb-2 flex text-[12px] font-semibold text-ljx-text2">
            <span className="flex-1">房间成员</span>
            <span className="w-16 text-right">状态</span>
          </div>
          <div className="space-y-1.5 text-[13px]">
            {members.length === 0 ? (
              <PlayerRow name="暂无成员" status="—" />
            ) : (
              members.map((member) => (
                <PlayerRow
                  key={member.accountId}
                  name={member.owner ? `${member.username} 房主` : member.username}
                  status={member.inGame ? "游戏中" : "等待"}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* 底部：本地服务端控制（进入房间请走「国服大厅」的房间卡片） */}
      <div className="border-t border-ljx-border bg-ljx-surface px-5 py-3">
        <p className="mb-2 text-[12px] text-ljx-text3">
          本页是本机服务端控制台；要进入游戏房间，请到「国服大厅」点击自己的房间卡片
        </p>
        {hint && <p className="mb-2 text-[12px] text-ljx-gold">{hint}</p>}
        <button
          className="w-full bg-ljx-accent py-2.5 text-[15px] font-bold text-white hover:brightness-110 disabled:opacity-60"
          disabled={launching}
          onClick={() => void launch()}
        >
          {launching ? "启动中…" : serverRunning ? "复制本机地址并打开客户端" : "启动服务端"}
        </button>
      </div>

      <QqGroupDialog
        open={qqOpen}
        roomId={roomId}
        currentCode={detail.qqGroupCode}
        currentIdKey={detail.qqGroupIdKey}
        onClose={() => setQqOpen(false)}
        onSaved={() => void reload()}
      />
    </div>
  );
}

function EditorActions({
  saving,
  onSave,
  onCancel,
  error,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  return (
    <>
      {error && <p className="text-[12px] text-ljx-accent">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          className="bg-ljx-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
          disabled={saving}
          onClick={onSave}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </>
  );
}

function PlayerRow({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center bg-ljx-deep px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-ljx-text3">{name}</span>
      <span className="w-16 text-right text-[12px] text-ljx-text3">{status}</span>
    </div>
  );
}

function splitVersion(combined: string): [string, string] {
  const index = combined.indexOf("-");
  if (index < 0) return [combined, ""];
  return [combined.slice(0, index), combined.slice(index + 1)];
}