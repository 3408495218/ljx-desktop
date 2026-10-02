import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  clientBuildAndLaunch,
  clientFetchPack,
  clientPackInspect,
  type ClientBuildProgress,
  type MrpackInfo,
} from "@/shared/tauri";
import { apiBaseUrl, currentAccessToken, errorText } from "@/shared/api";
import { useAccountStore } from "@/stores/account";
import type { ClientPackageMeta } from "@/shared/api";

/**
 * 「一键启动」：把房主的精简整合包补成完整客户端并启动。
 *
 * 背景：房主用 PCL 导出的整合包只有几 MB（仅含"基准版本 + 覆盖文件"），
 * 原版资源 / 加载器 / assets 要现下（合计约 700MB）。这个弹窗负责：
 *   下载整合包 → 解析展示 → 让玩家确认昵称与内存 → 自动补齐并启动。
 *
 * 进度通过 Rust 侧推送的 `client://build` 事件驱动，不做轮询。
 */

type Phase = "fetch" | "ready" | "building" | "done" | "error";

const MEMORY_OPTIONS = ["2G", "4G", "6G", "8G", "12G"];

export function ClientLaunchDialog({
  open,
  onClose,
  roomId,
  pkg,
}: {
  open: boolean;
  onClose: () => void;
  roomId: number;
  pkg: ClientPackageMeta | null;
}) {
  const account = useAccountStore((s) => s.account);
  const [phase, setPhase] = useState<Phase>("fetch");
  const [info, setInfo] = useState<MrpackInfo | null>(null);
  const [packPath, setPackPath] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClientBuildProgress | null>(null);
  /** 实时速度与预计剩余时间：crust_core 会单独推事件，不能当成"阶段"覆盖主文案 */
  const [speed, setSpeed] = useState<number | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState(account?.username ?? "");
  const [maxMemory, setMaxMemory] = useState("4G");
  // 用 ref 记住"这次会话是否已经开始构建"，避免切页签回来重复触发
  const startedRef = useRef(false);

  // 打开时：下载整合包 → 解析。关闭时复位。
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      if (!pkg) {
        setPhase("error");
        setError("房主还没有上传客户端整合包，无法一键启动。可以先用「下载整合包」手动导入。");
        return;
      }
      const token = currentAccessToken();
      if (!token) {
        setPhase("error");
        setError("登录状态已失效，请重新登录");
        return;
      }
      try {
        setPhase("fetch");
        setError(null);
        // Rust 侧会把整合包下到平台管理的固定目录（玩家不需要选目录）
        const local = await clientFetchPack(apiBaseUrl(), roomId, token, pkg.fileName);
        if (cancelled) return;
        setPackPath(local);
        const meta = await clientPackInspect(local);
        if (cancelled) return;
        setInfo(meta);
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setPhase("error");
          setError(errorText(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, roomId, pkg]);

  // 进度事件（只在构建期间注册）
  useEffect(() => {
    if (!open || phase !== "building") return;
    let dispose: (() => void) | null = null;
    void listen<ClientBuildProgress>("client://build", (event) => {
      const payload = event.payload;
      if (payload.stage === "speed") {
        setSpeed(Number(payload.message) || null);
        return;
      }
      if (payload.stage === "eta") {
        setEta(Number(payload.message) || null);
        return;
      }
      setProgress(payload);
      if (payload.stage === "error") {
        setPhase("error");
        setError(payload.message);
      } else if (payload.stage === "done") {
        setPhase("done");
      }
    }).then((un) => {
      dispose = un;
    });
    return () => {
      dispose?.();
    };
  }, [open, phase]);

  const percent = useMemo(() => {
    if (!progress || progress.total <= 0) return null;
    return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
  }, [progress]);

  if (!open) return null;

  async function start() {
    if (!packPath || startedRef.current) return;
    startedRef.current = true;
    setPhase("building");
    setError(null);
    setProgress(null);
    try {
      await clientBuildAndLaunch({
        packPath,
        playerName: playerName.trim() || undefined,
        maxMemory,
        launchAfterBuild: true,
      });
      // 真正的完成状态由 client://build 的 done 事件驱动；这里兜底
      setPhase((p) => (p === "error" ? p : "done"));
    } catch (e) {
      setPhase("error");
      setError(errorText(e));
      startedRef.current = false;
    }
  }

  const loaderLabel = info
    ? info.loader === "vanilla"
      ? "原版"
      : `${info.loader} ${info.loaderVersion}`
    : "";

  return (
    // 刻意不给遮罩绑定 onClose：构建期间误触空白会中断下载、还得重下一遍。
    // 关闭只能通过「取消」按钮，且在下载中会二次确认。
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60">
      <div className="w-[520px] max-w-[92vw] border border-ljx-border bg-ljx-surface p-5 shadow-2xl">
        <h3 className="text-[15px] font-semibold text-ljx-text">一键启动游戏</h3>
        <p className="mt-1 text-[12px] text-ljx-text3">
          房主的整合包是「精简版」（只有 mod 与配置），平台会自动补齐原版资源与加载器。若自动构建不适合你，可关闭本窗口后用「下载整合包」手动导入 PCL。
        </p>

        {/* 包信息 / 下载整合包阶段 */}
        {phase === "fetch" && (
          <p className="mt-4 text-[13px] text-ljx-text2">正在获取房主的整合包…</p>
        )}

        {info && (
          <div className="mt-4 border border-ljx-border bg-ljx-surface2 p-3 text-[12px] leading-6">
            <div className="font-semibold text-ljx-text">{info.name}</div>
            <div className="text-ljx-text2">
              Minecraft <span className="text-ljx-text">{info.gameVersion}</span> · 加载器{" "}
              <span className="text-ljx-text">{loaderLabel}</span> · 覆盖文件{" "}
              <span className="text-ljx-text">{info.overrideFiles}</span> 个
            </div>
            {info.remoteFiles > 0 && (
              <div className="text-ljx-text2">还需联网下载 {info.remoteFiles} 个 mod</div>
            )}
            <div className="mt-1 text-ljx-warn">
              首次启动需下载原版资源（约 700MB），之后会跳过已下载的部分。
            </div>
          </div>
        )}

        {/* 玩家配置 */}
        {(phase === "ready" || phase === "building" || phase === "done") && (
          <div className="mt-4 flex gap-3">
            <label className="flex-1 text-[11px] text-ljx-text3">
              游戏内昵称
              <input
                className="mt-1 w-full border border-ljx-border bg-ljx-bg px-2 py-1.5 text-[13px] text-ljx-text outline-none focus:border-ljx-accent"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                disabled={phase !== "ready"}
                placeholder="离线模式下的名字"
              />
            </label>
            <label className="w-[130px] text-[11px] text-ljx-text3">
              最大内存
              <select
                className="mt-1 w-full border border-ljx-border bg-ljx-bg px-2 py-1.5 text-[13px] text-ljx-text outline-none focus:border-ljx-accent"
                value={maxMemory}
                onChange={(e) => setMaxMemory(e.target.value)}
                disabled={phase !== "ready"}
              >
                {MEMORY_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* 进度 */}
        {(phase === "building" || phase === "done") && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-ljx-text2">
                {phase === "done"
                  ? "已启动，可以切到游戏窗口了"
                  : progress?.message ||
                    (progress?.stage === "check"
                      ? // 这一阶段是在按 SHA1 校验本地文件，已有的会跳过、不会重下
                        "正在校验已下载的文件（已有的会跳过，不会重复下载）"
                      : progress?.element
                        ? `正在下载 ${progress.element}`
                        : "准备中…")}
              </span>
              {percent !== null && <span className="text-ljx-text3">{percent}%</span>}
            </div>
            <div className="mt-2 h-1.5 w-full bg-ljx-surface2">
              <div
                className="h-full bg-ljx-accent transition-all"
                style={{ width: `${percent ?? (phase === "done" ? 100 : 8)}%` }}
              />
            </div>
            {progress && progress.downloaded > 0 && phase === "building" && (
              <div className="mt-1 flex gap-3 text-[11px] text-ljx-text3">
                <span>
                  {(progress.downloaded / 1024 / 1024).toFixed(1)} MB
                  {progress.total > 0
                    ? ` / ${(progress.total / 1024 / 1024).toFixed(1)} MB`
                    : " 已下载"}
                </span>
                {speed !== null && speed > 0 && (
                  // crust_core 的 Event::Speed 单位是 **bytes/s**（源码里是 chunk_bytes/elapsed_secs），
                  // 之前只除以 1024 却标成 MB/s，看起来像 288 MB/s，实际是 288 KB/s。
                  <span>速度 {(speed / 1024 / 1024).toFixed(2)} MB/s</span>
                )}
                {eta !== null && eta > 0 && (
                  <span>剩余约 {Math.ceil(eta / 60)} 分钟</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* 错误 */}
        {phase === "error" && error && (
          <div className="mt-4 border border-red-800/60 bg-red-950/40 p-3 text-[12px] text-red-300">
            {error}
          </div>
        )}

        {/* 资源来源与免责说明：资源全部来自官方源，平台不参与游戏本体分发 */}
        <div className="mt-4 border-t border-ljx-border pt-3 text-[11px] leading-5 text-ljx-text3">
          <div className="font-semibold text-ljx-text2">游戏资源说明</div>
          Minecraft 原版、NeoForge 等加载器与 Java 运行环境由{" "}
          <span className="text-ljx-text2">Mojang</span>、
          <span className="text-ljx-text2">NeoForge</span>、
          <span className="text-ljx-text2">Azul</span> 等官方源提供；
          本平台仅提供房间联机与整合包分发，<span className="text-ljx-text2">不提供游戏本体分发</span>。
        </div>

        <div className="mt-5 flex justify-end gap-2">
          {phase === "ready" && (
            <button className="bg-ljx-accent-deep px-4 py-1.5 text-[13px] font-bold text-white hover:brightness-110 disabled:opacity-60" onClick={() => void start()}>
              开始构建并启动
            </button>
          )}
          {phase === "building" && (
            <span className="self-center text-[12px] text-ljx-text3">
              下载期间请不要关闭本窗口
            </span>
          )}
          <button
            className="bg-ljx-surface2 px-4 py-1.5 text-[13px] text-ljx-text2 hover:brightness-110"
            onClick={() => {
              // 构建中关窗会中断下载，下次还得重来，所以这里再确认一次
              if (phase === "building") {
                const ok = window.confirm(
                  "下载/构建正在进行，关闭会中断它，下次需要重新下载未完成的部分。确定要关闭吗？",
                );
                if (!ok) return;
              }
              onClose();
            }}
          >
            {phase === "done" ? "关闭" : phase === "building" ? "中断并关闭" : "取消"}
          </button>
        </div>
      </div>
    </div>
  );
}
