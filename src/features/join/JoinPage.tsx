import { useEffect, useState } from "react";
import grassBlock from "@/assets/icons/grass-block.png";
import starIcon from "@/assets/icons/star.png";
import starFilledIcon from "@/assets/icons/star-filled.png";
import qqBanner from "@/assets/icons/qq-banner.png";
import backIcon from "@/assets/icons/back.png";
import {
  api,
  apiBaseUrl,
  currentAccessToken,
  errorText,
  type ClientPackageMeta,
  type RoomContentItem,
} from "@/shared/api";
import { copyText } from "@/shared/clipboard";
import { downloadClientPackage, openFolder, openMcLauncher, openUrl, pickFolder } from "@/shared/tauri";
import { qqGroupJoinUrl } from "@/shared/qqGroup";
import { useAccountStore } from "@/stores/account";
import { useLobbyStore } from "@/stores/lobby";
import { useRoomDetail } from "@/shared/useRoomDetail";
import { ClientLaunchDialog } from "./ClientLaunchDialog";
import type { PrepState } from "@/shared/types";

interface JoinPageProps {
  roomId: number | null;
  /** 被房间门槛挡下的原因（上锁 / 需要邮箱 / 禁止游客）；null 表示可以被放行 */
  blocked: { code: number; message: string } | null;
  /**
   * 是否已经拿到"能不能进"的结果。
   * 未拿到结果前**不能放行** —— 否则切房间后的空窗期里按钮会短暂可用，
   * 玩家能趁机拿走服务器地址（真实漏洞，已被使用者当场发现）。
   */
  enterChecked: boolean;
  onNeedAccount: () => void;
  /** 退出房间：清掉当前选中的房间，回到未选择状态 */
  onLeaveRoom: () => void;
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export function JoinPage({
  roomId,
  blocked,
  enterChecked,
  onNeedAccount,
  onLeaveRoom,
}: JoinPageProps) {
  /** 未确认可进入，或已被明确拒绝 —— 两种情况都不该允许复制地址/启动游戏 */
  const notEnterable = !enterChecked || blocked !== null;
  const account = useAccountStore((s) => s.account);
  // 轮询 5 秒：人数与「等待/游戏中」由房主心跳与玩家进出驱动，间隔太长会显得不更新
  const { detail, error, loading, reload } = useRoomDetail(roomId, 5_000);
  const [prep, setPrep] = useState<PrepState>("waiting");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contents, setContents] = useState<RoomContentItem[]>([]);
  const [pkg, setPkg] = useState<ClientPackageMeta | null>(null);
  const [downloading, setDownloading] = useState(false);
  /** 记住上次选的下载目录，重复启动时作为默认值 */
  const [pkgDir, setPkgDir] = useState<string | undefined>(undefined);
  /** 收藏按钮独立维护的提交态，避免连点时重复请求 */
  const [favBusy, setFavBusy] = useState(false);
  /** 「一键启动」弹窗开关 */
  const [autoLaunchOpen, setAutoLaunchOpen] = useState(false);

  // 切换房间时重置准备态，避免沿用上一个房间的地址与状态
  useEffect(() => {
    setPrep("waiting");
    setAddress(null);
    setLaunchError(null);
    setNotice(null);
    setContents([]);
    setPkg(null);
    setPkgDir(undefined);
  }, [roomId]);

  // 房主本机目录的清单镜像与客户端压缩包元数据，仅用于展示
  useEffect(() => {
    if (roomId === null || !account) return;
    let alive = true;
    void (async () => {
      try {
        const list = await api.roomContents(roomId);
        if (alive) setContents(list);
      } catch {
        if (alive) setContents([]);
      }
      try {
        const meta = await api.clientPackageMeta(roomId);
        if (alive) setPkg(meta);
      } catch {
        if (alive) setPkg(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomId, account]);

  if (roomId === null) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-ljx-text3">
        请先在大厅选择一个房间
      </div>
    );
  }

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

  const plugins = contents.filter((item) => item.type === "plugin");
  const mods = contents.filter((item) => item.type === "mod");
  /** 房主心跳上报的在线名单；后端未升级时字段缺失，兜底成空数组 */
  /**
   * 房间成员（进入房间即算，含尚未进入游戏的人）。
   * 登记与续期在 App.tsx 应用级（依赖 selectedRoomId），这里只负责展示；
   * 后端推送命中本房间时 useRoomDetail 会立即静默刷新，所以这里天然是实时的。
   */
  const members = detail.members ?? [];
  const qqUrl = qqGroupJoinUrl(detail.qqGroupIdKey);
  /**
   * 被房主隐藏的清单后端不会下发明细，因此分组不能按「有条目」来过滤，
   * 否则隐藏后会整段消失、玩家不知道房间到底有没有装东西。
   */
  const contentGroups = [
    { label: "插件", items: plugins, visible: detail.pluginListVisible !== false },
    { label: "Mod", items: mods, visible: detail.modListVisible !== false },
  ].filter((group) => group.items.length > 0 || !group.visible);

  /** 第一段：向服务端登记加入，拿房主公网地址 */
  async function prepare() {
    if (!account) {
      onNeedAccount();
      return false;
    }
    setLaunchError(null);
    setNotice(null);
    setPrep("joining");
    try {
      const result = await api.joinRoom(detail!.id);
      if (!result.host) {
        setPrep("waiting");
        setLaunchError("房主尚未登记公网地址，请联系房主");
        return false;
      }
      setAddress(`${result.host}:${result.port ?? 25565}`);
      setPrep("ready");
      return true;
    } catch (e) {
      setPrep("waiting");
      setLaunchError(errorText(e));
      return false;
    }
  }

  /**
   * 下载房主的客户端压缩包：本软件不参与打包，只负责落盘并打开目录，
   * 玩家再自行用 PCL 导入。返回一句可展示的结果文案。
   */
  async function fetchClientPackage(): Promise<string> {
    if (!pkg) return "房主尚未上传客户端压缩包，可直接进入游戏";
    const token = currentAccessToken();
    if (!token) return "";
    const folder = await pickFolder("选择游戏压缩包的下载文件夹", pkgDir);
    if (!folder) return "已取消压缩包下载";
    setPkgDir(folder);
    setDownloading(true);
    try {
      await downloadClientPackage(apiBaseUrl(), detail!.id, token, folder, pkg.fileName);
      await openFolder(folder);
      return `已下载 ${pkg.fileName} 到 ${folder}，请在 PCL 中导入`;
    } finally {
      setDownloading(false);
    }
  }

  /** 第二段：可选下载客户端包，然后复制地址并打开系统启动器 */
  async function launch() {
    if (downloading) return;
    setLaunchError(null);
    setNotice(null);
    const ok = prep === "ready" || (await prepare());
    if (!ok || !address) return;

    let pkgNotice: string;
    try {
      pkgNotice = await fetchClientPackage();
    } catch (e) {
      setLaunchError(`客户端压缩包下载失败：${errorText(e)}`);
      return;
    }

    const copied = await copyText(address);
    try {
      await openMcLauncher();
    } catch (e) {
      setNotice(
        [pkgNotice, `已复制服务器地址 ${address}，但打开启动器失败：${String(e)}`].join("；"),
      );
      return;
    }
    setNotice(
      [
        pkgNotice,
        copied ? `已复制服务器地址 ${address}` : `服务器地址 ${address}（复制失败，请手动输入）`,
        "正在打开 Minecraft 启动器",
      ].join("；"),
    );
  }

  async function copyAddress() {
    if (!address) return;
    const ok = await copyText(address);
    setNotice(ok ? `已复制服务器地址 ${address}` : "复制失败，请手动选中地址复制");
  }

  /** 收藏 / 取消收藏（均为幂等）：成功后刷新详情，并同步大厅避免收藏页签停留在旧数据 */
  async function toggleFavorite() {
    if (!account) {
      onNeedAccount();
      return;
    }
    if (favBusy) return;
    setFavBusy(true);
    setLaunchError(null);
    try {
      if (detail!.favorited) await api.unfavorite(detail!.id);
      else await api.favorite(detail!.id);
      await reload();
      void useLobbyStore.getState().refresh();
    } catch (e) {
      setLaunchError(errorText(e));
    } finally {
      setFavBusy(false);
    }
  }

  /** 打开腾讯一键加群页；链接由服务端存的 idkey 拼出，未点亮时不展示入口 */
  async function openQqGroup() {
    if (!qqUrl) return;
    try {
      await openUrl(qqUrl);
    } catch (e) {
      setLaunchError(String(e));
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 三段式：封面 | 基本信息 | 玩家列表 */}
      <div className="flex min-h-0 flex-1 gap-8 px-8 py-6">
        {/* 左：封面 + 名称（原版 4:3 直角小图，名称居中于图下） */}
        <div className="flex w-40 shrink-0 flex-col items-center gap-2 pt-1">
          <img
            src={detail.cover || grassBlock}
            alt="房间封面"
            className="aspect-[4/3] w-full border-2 border-ljx-cardborder object-cover"
            draggable={false}
          />
          <span className="text-[14px] text-ljx-text">{detail.name}</span>
          <span className={`text-[12px] ${detail.online ? "text-ljx-green" : "text-ljx-text3"}`}>
            {detail.online
              ? `在线 ${detail.players}/${detail.capacity}`
              : `离线 · ${detail.players}/${detail.capacity}`}
          </span>
          {/* 房主点亮过加群按钮才展示入口；未点亮时整块不出现 */}
          {qqUrl && (
            <button
              className="hover:brightness-110"
              title={detail.qqGroupCode ? `加入QQ群 ${detail.qqGroupCode}` : "加入QQ群"}
              onClick={() => void openQqGroup()}
            >
              <img src={qqBanner} alt="加入QQ群" className="h-[22px]" draggable={false} />
            </button>
          )}
          <button
            className="flex items-center gap-1 text-[12px] text-ljx-text2 hover:text-ljx-text disabled:opacity-60"
            disabled={favBusy}
            title={detail.favorited ? "取消收藏" : "收藏房间"}
            onClick={() => void toggleFavorite()}
          >
            <img
              src={detail.favorited ? starFilledIcon : starIcon}
              alt=""
              className="h-3.5 w-3.5"
              draggable={false}
            />
            {detail.favorited ? "已收藏" : "收藏"}({detail.favoriteCount})
          </button>
        </div>

        {/* 中：基本信息 + 房主本机的插件 / Mod 清单 */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <h2 className="mb-3 w-fit text-[14px] text-ljx-accent underline">基本信息</h2>
          <div className="space-y-2 text-[13px] leading-6">
            <p className="text-ljx-text">介绍：</p>
            <p className="selectable text-ljx-text2">{detail.intro || "房主尚未填写简介"}</p>
            <p className="text-ljx-text">服务器核心：</p>
            <p className="selectable font-mono text-ljx-text2">
              {detail.core}-{detail.mcVersion}
            </p>
            <p className="text-ljx-text">客户端版本：</p>
            <p className="selectable font-mono text-ljx-text2">
              {detail.mcVersion}-{detail.core}
            </p>
            <p className="text-ljx-text2">
              包含插件{plugins.length}个 · 模组{mods.length}个
            </p>
            <p className="text-ljx-text2">
              客户端资源包：
              {pkg ? (
                <span className="selectable text-ljx-text">
                  {pkg.fileName}
                  <span className="ml-1 text-ljx-text3">（{mb(pkg.sizeBytes)}）</span>
                </span>
              ) : (
                <span className="text-ljx-text3">房主尚未上传，可直接进入游戏</span>
              )}
            </p>
            <p className="text-ljx-text2">
              房主：{detail.ownerName}
              {detail.vip > 0 && <span className="ml-1 text-ljx-gold">VIP{detail.vip}</span>}
            </p>
            {(detail.locked || detail.needEmail || detail.noGuest) && (
              <p className="text-ljx-text3">
                限制：
                {detail.locked && <span className="mr-2">已上锁</span>}
                {detail.needEmail && <span className="mr-2">需绑定邮箱</span>}
                {detail.noGuest && <span>禁止游客</span>}
              </p>
            )}
            {address && (
              <p className="text-ljx-text2">
                服务器地址：<span className="selectable font-mono text-ljx-text">{address}</span>
                <button className="ml-2 text-ljx-accent hover:underline" onClick={() => void copyAddress()}>
                  复制
                </button>
              </p>
            )}
            {launchError && <p className="text-ljx-accent">{launchError}</p>}
            {notice && <p className="text-ljx-gold">{notice}</p>}
          </div>

          {/* 清单镜像：文件在房主本机，这里只展示，不提供下载 */}
          <h2 className="mt-5 mb-2 w-fit text-[14px] text-ljx-accent underline">
            插件与 Mod 清单
          </h2>
          {contentGroups.length === 0 ? (
            <p className="text-[12px] text-ljx-text3">
              房主尚未同步清单（房主在「插件」/「Mod」页扫描后会自动上报）
            </p>
          ) : (
            <div className="space-y-1">
              {contentGroups.map((group) => (
                <div key={group.label}>
                  <p className="text-[12px] text-ljx-text3">
                    {group.visible
                      ? `${group.label}（${group.items.length}）`
                      : `${group.label}：房主已隐藏清单`}
                  </p>
                  {group.visible &&
                    group.items.map((item) => (
                      <div
                        key={`${item.type}-${item.name}`}
                        className="flex items-center gap-3 border-b border-ljx-border/60 py-[3px] text-[13px]"
                      >
                        <span
                          className={`min-w-0 flex-1 truncate ${
                            item.enabled ? "text-ljx-text2" : "text-ljx-text3 line-through"
                          }`}
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        <span className="w-20 text-right text-[12px] text-ljx-text3">
                          {mb(item.sizeBytes)}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右：玩家 | 状态（橙色下划线表头） */}
        <div className="w-[32%] shrink-0 self-stretch border border-ljx-border bg-ljx-bg2 px-3 py-2">
          <div className="flex border-b-2 border-ljx-accent pb-1 text-[13px] text-ljx-accent">
            <span className="flex-1">玩家</span>
            <span className="w-20 text-right">状态</span>
          </div>
          <div className="min-h-0 max-h-[calc(100%-1.75rem)] overflow-y-auto py-1">
            {members.length === 0 ? (
              <div className="flex py-[3px] text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ljx-text3">暂无成员</span>
                <span className="w-20 text-right text-ljx-text3">—</span>
              </div>
            ) : (
              members.map((member) => (
                <div key={member.accountId} className="flex py-[3px] text-[13px]">
                  <span
                    className="min-w-0 flex-1 truncate text-ljx-text2"
                    title={member.owner ? `${member.username}（房主）` : member.username}
                  >
                    {member.username}
                    {member.owner && <span className="ml-1 text-ljx-gold">房主</span>}
                  </span>
                  <span
                    className={`w-20 text-right ${member.inGame ? "text-ljx-green" : "text-ljx-text3"}`}
                  >
                    {member.inGame ? "游戏中" : "等待"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 底部启动条（原版广告位样式，重建版为启动入口） */}
      <div className="flex items-center gap-3 bg-black/45 px-3 py-2">
        <button
          className="grid h-8 w-8 shrink-0 place-items-center bg-white/10 hover:bg-white/20"
          title="退出房间"
          onClick={onLeaveRoom}
        >
          <img src={backIcon} alt="" className="h-4 w-4" draggable={false} />
        </button>
        {/* 被房间门槛挡下时：说明原因 + 给一个能立刻做的动作，而不是让玩家干瞪眼 */}
        {blocked ? (
          <span className="flex items-center gap-3 text-[12px]">
            <span className="text-ljx-accent">无法进入该房间：{blocked.message}</span>
            {blocked.code === 1307 && (
              <button
                className="border border-ljx-accent-deep px-2 py-[2px] text-[11px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white"
                onClick={onNeedAccount}
              >
                去登录 / 注册
              </button>
            )}
            {blocked.code === 1305 && (
              <button
                className="border border-ljx-accent-deep px-2 py-[2px] text-[11px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white"
                onClick={onNeedAccount}
              >
                去绑定邮箱
              </button>
            )}
          </span>
        ) : !enterChecked ? (
          // 还没拿到"能不能进"的结果：明确告诉玩家在检查，不要显示成"准备就绪"
          <span className="text-[12px] text-white/60">正在校验能否进入该房间…</span>
        ) : (
          <span className="text-[12px] text-white/80">
            {downloading
              ? "正在下载客户端压缩包…"
              : prep === "ready" && address
                ? `已准备就绪 · 服务器地址 ${address}`
                : pkg
                  ? "点击「一键启动」会自动补齐原版资源与加载器并启动游戏（首次约 700MB）"
                  : "准备就绪后点击启动，自动复制地址并打开客户端"}
          </span>
        )}
        <button
          className="ml-auto border border-white/30 px-4 py-1.5 text-[13px] text-white/90 hover:bg-white/10 disabled:opacity-50"
          // 进不去房间时也不该让你拿走地址：否则可以绕过准入直接连服务端
          disabled={!address || notEnterable}
          title={blocked !== null ? "无法进入该房间" : undefined}
          onClick={() => void copyAddress()}
        >
          复制地址
        </button>
        <button
          className="bg-ljx-accent-deep px-8 py-1.5 text-[13px] font-bold text-white hover:brightness-110 disabled:opacity-60"
          disabled={prep === "joining" || downloading || notEnterable}
          onClick={() => {
            // 房主上传了整合包 → 走「一键启动」：自动补齐原版资源与加载器后启动游戏
            // 没上传 → 退回原流程（复制服务器地址 + 打开本机启动器）
            if (pkg) {
              setAutoLaunchOpen(true);
            } else {
              void launch();
            }
          }}
        >
          {downloading
            ? "下载中…"
            : prep === "joining"
              ? "加入中…"
              : pkg
                ? "一键启动"
                : "启动游戏"}
        </button>
      </div>
    
      <ClientLaunchDialog
        open={autoLaunchOpen}
        onClose={() => setAutoLaunchOpen(false)}
        roomId={roomId}
        pkg={pkg}
      />
    </div>
  );
}