import { useCallback, useEffect, useState } from "react";
import puzzleIcon from "@/assets/icons/puzzle.png";
import refreshIcon from "@/assets/icons/refresh.png";
import { api, errorText, hasSession } from "@/shared/api";
import { syncRoomContents, toReportItems } from "@/shared/roomContentsSync";
import { useRoomDetail } from "@/shared/useRoomDetail";
import { useRoomServerDir } from "@/shared/useRoomServerDir";
import { modsDelete, modsImport, modsList, modsSetEnabled, pickFiles } from "@/shared/tauri";
import { useServerProcStore } from "@/stores/serverProc";
import type { LocalContentEntry } from "@/shared/types";

interface LibraryTabProps {
  roomId: number;
  kind: "plugin" | "mod";
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/**
 * 本地插件 / Mod 管理：数据来源是房主本机服务端的 plugins、mods 目录。
 * 平台不参与分发，这里每次改动后把清单同步一份到平台，供进房玩家查看。
 */
export function LibraryTab({ roomId, kind }: LibraryTabProps) {
  const label = kind === "plugin" ? "插件" : "Mod";
  const dirName = kind === "plugin" ? "plugins" : "mods";
  const { detail, reload } = useRoomDetail(roomId);
  const { dir, error: dirError, refresh: refreshDir } = useRoomServerDir();
  const phase = useServerProcStore((s) => s.phase);
  const serverRunning = phase === "running" || phase === "starting" || phase === "stopping";

  const [entries, setEntries] = useState<LocalContentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  /** 玩家侧是否列出该清单；房主自己始终能看到完整列表，这里只控制对外展示 */
  const playerVisible =
    (kind === "plugin" ? detail?.pluginListVisible : detail?.modListVisible) ?? true;

  /** 把本地清单同步到平台；非房主或未登录时跳过 */
  const sync = useCallback(
    async (list: LocalContentEntry[]) => {
      if (!hasSession() || !detail?.mine) return;
      try {
        await syncRoomContents(roomId, kind, toReportItems(kind, list));
        setSyncedAt(new Date().toLocaleTimeString());
      } catch (e) {
        setError(`清单同步到平台失败：${errorText(e)}`);
      }
    },
    [roomId, kind, detail?.mine],
  );

  const load = useCallback(async () => {
    if (!dir) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await modsList(dir, kind);
      setEntries(list);
      await sync(list);
    } catch (e) {
      setEntries([]);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [dir, kind, sync]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 所有改动都走同一套收尾：刷新清单 → 同步平台 */
  async function apply(key: string, op: () => Promise<LocalContentEntry[]>, okText: string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const list = await op();
      setEntries(list);
      setMessage(okText);
      await sync(list);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function importJars() {
    if (!dir) return;
    setError(null);
    setMessage(null);
    let sources: string[] | null;
    try {
      sources = await pickFiles(`选择要导入的${label} jar（可多选）`);
    } catch (e) {
      setError(errorText(e));
      return;
    }
    if (!sources || sources.length === 0) return;
    await apply(
      "import",
      () => modsImport(dir, kind, sources),
      `已导入 ${sources.length} 个${label}`,
    );
  }

  async function toggle(entry: LocalContentEntry) {
    if (!dir) return;
    await apply(
      entry.fileName,
      () => modsSetEnabled(dir, kind, entry.fileName, !entry.enabled),
      `${entry.enabled ? "已停用" : "已启用"} ${entry.name}`,
    );
  }

  async function remove(entry: LocalContentEntry) {
    if (!dir) return;
    if (!window.confirm(`确认从本地 ${dirName} 目录删除 ${entry.name}？该操作不可恢复。`)) return;
    await apply(entry.fileName, () => modsDelete(dir, kind, entry.fileName), `已删除 ${entry.name}`);
  }

  /** 切换清单对玩家的可见性：只改平台登记，不动本机文件，房主侧列表始终完整 */
  async function togglePlayerVisible() {
    if (!detail?.mine || busy !== null) return;
    const next = !playerVisible;
    setBusy("visibility");
    setError(null);
    setMessage(null);
    try {
      await api.updateRoom(
        roomId,
        kind === "plugin" ? { pluginListVisible: next } : { modListVisible: next },
      );
      await reload();
      setMessage(`${label}清单已对玩家${next ? "显示" : "隐藏"}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const disabledCount = entries.filter((item) => !item.enabled).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[14px] font-bold text-ljx-text">
          <img src={puzzleIcon} alt="" className="h-4 w-4" draggable={false} />
          本地{label}（{entries.length}）
          {disabledCount > 0 && (
            <span className="text-[12px] font-normal text-ljx-text3">已停用 {disabledCount}</span>
          )}
          <span
            className={`text-[12px] font-normal ${playerVisible ? "text-ljx-green" : "text-ljx-gold"}`}
            title="玩家在「当前加入」页看到的状态"
          >
            玩家{playerVisible ? "可见" : "不可见"}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="border border-ljx-border bg-ljx-bg2 px-3 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text disabled:opacity-60"
            disabled={!detail?.mine || busy !== null}
            title={
              playerVisible
                ? "关闭后玩家只能看到总数，不列出文件名"
                : "打开后玩家可查看完整清单"
            }
            onClick={() => void togglePlayerVisible()}
          >
            {busy === "visibility" ? "提交中…" : playerVisible ? "对玩家隐藏" : "对玩家显示"}
          </button>
          <button
            className="border border-ljx-border bg-ljx-bg2 px-3 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text disabled:opacity-60"
            disabled={!dir || loading}
            onClick={() => {
              refreshDir();
              void load();
            }}
          >
            <span className="flex items-center gap-1.5">
              <img src={refreshIcon} alt="" className="h-3.5 w-3.5" draggable={false} />
              重新扫描
            </span>
          </button>
          <button
            className="bg-ljx-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
            disabled={!dir || busy !== null}
            onClick={() => void importJars()}
          >
            {busy === "import" ? "导入中…" : `导入${label}`}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 border border-ljx-border bg-ljx-surface px-3 py-2 text-[12px]">
        <span className="text-ljx-text3">目录</span>
        <span className="min-w-0 flex-1 truncate font-mono text-ljx-text2" title={dir ?? ""}>
          {dir ? `${dir}\\${dirName}` : "未定位到服务端工作目录"}
        </span>
        <span className="text-ljx-text3">
          {syncedAt ? `平台清单已同步 ${syncedAt}` : "平台清单尚未同步"}
        </span>
      </div>

      {dirError && (
        <p className="border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-gold">
          {dirError}
        </p>
      )}
      {serverRunning && (
        <p className="border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-gold">
          服务端正在运行，启停与删除可能因文件占用失败；改动在服务端重启后生效。
        </p>
      )}
      {error && (
        <p className="border border-ljx-accent-deep bg-ljx-deep px-3 py-2 text-[12px] text-ljx-accent">
          {error}
        </p>
      )}
      {message && (
        <p className="border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-green">
          {message}
        </p>
      )}

      <section className="border border-ljx-border bg-ljx-surface">
        <div className="flex border-b border-ljx-border px-4 py-2 text-[12px] font-semibold text-ljx-text3">
          <span className="flex-1">文件名</span>
          <span className="w-20 text-right">大小</span>
          <span className="w-16 text-right">状态</span>
          <span className="w-24 text-right">操作</span>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-[13px] text-ljx-text3">正在扫描本地目录…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-ljx-text3">
            本地 {dirName} 目录下没有 {label}
            <div className="mt-1 text-[12px] text-ljx-text3/70">
              点击右上角「导入{label}」把 jar 复制进该目录
            </div>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.fileName}
              className="flex items-center border-b border-ljx-border px-4 py-2.5 text-[13px]"
            >
              <span
                className={`min-w-0 flex-1 truncate ${entry.enabled ? "text-ljx-text" : "text-ljx-text3"}`}
                title={entry.fileName}
              >
                {entry.name}
              </span>
              <span className="w-20 text-right text-[12px] text-ljx-text3">
                {mb(entry.sizeBytes)}
              </span>
              <span
                className={`w-16 text-right text-[12px] ${entry.enabled ? "text-ljx-green" : "text-ljx-text3"}`}
              >
                {entry.enabled ? "启用" : "停用"}
              </span>
              <span className="flex w-24 justify-end gap-3">
                <button
                  className="text-ljx-accent hover:underline disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => void toggle(entry)}
                >
                  {entry.enabled ? "停用" : "启用"}
                </button>
                <button
                  className="text-ljx-accent hover:underline disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => void remove(entry)}
                >
                  删除
                </button>
              </span>
            </div>
          ))
        )}
      </section>

      <p className="text-[12px] leading-5 text-ljx-text3">
        平台只保存这份清单用于展示，不参与分发：文件始终以房主本机服务端的 {dirName}
        目录为准。停用通过重命名（X.jar → X.jar.disabled）实现，不改动文件内容，服务端重启后生效。
        玩家在「当前加入」页可查看这份清单；「对玩家隐藏」只影响玩家侧展示，关闭后玩家只看到总数。
      </p>
    </div>
  );
}