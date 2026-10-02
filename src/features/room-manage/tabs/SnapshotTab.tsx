import { useCallback, useEffect, useMemo, useState } from "react";
import warningIcon from "@/assets/icons/warning.png";
import { snapshotCreate, snapshotDelete, snapshotList, snapshotRestore } from "@/shared/tauri";
import { api, errorText, hasSession, type SnapshotPayload } from "@/shared/api";
import { useRoomDetail } from "@/shared/useRoomDetail";
import { useRoomServerDir } from "@/shared/useRoomServerDir";
import { useServerProcStore } from "@/stores/serverProc";
import type { SnapshotMeta } from "@/shared/types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function stamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function defaultName(): string {
  return `manual-${stamp()}`;
}

/** 恢复前的保护快照名：带秒，避免同一分钟内连续恢复撞名 */
function protectionName(): string {
  const now = new Date();
  return `pre-restore-${stamp(now)}${pad(now.getSeconds())}`;
}

export function SnapshotTab({ roomId }: { roomId: number }) {
  const { dir, error: dirError, refresh: refreshDir } = useRoomServerDir();
  const { detail } = useRoomDetail(roomId);
  const phase = useServerProcStore((s) => s.phase);
  const running = phase === "running" || phase === "starting" || phase === "stopping";

  const [items, setItems] = useState<SnapshotMeta[]>([]);
  const [meta, setMeta] = useState<SnapshotPayload[]>([]);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [name, setName] = useState(defaultName());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<SnapshotMeta | null>(null);
  const [confirmText, setConfirmText] = useState("");

  /** 平台登记按名称对齐本地快照，统一小写比较，避免大小写差异被当成两条 */
  const registered = useMemo(() => {
    const map = new Map<string, SnapshotPayload>();
    for (const item of meta) map.set(item.name.toLowerCase(), item);
    return map;
  }, [meta]);

  const loadMeta = useCallback(async () => {
    if (!hasSession()) {
      setMeta([]);
      setMetaError("未登录，平台登记不可用（快照仍保存在本机）");
      return;
    }
    try {
      setMeta(await api.snapshotListMeta(roomId));
      setMetaError(null);
    } catch (e) {
      setMeta([]);
      setMetaError(`平台登记不可用：${errorText(e)}`);
    }
  }, [roomId]);

  const load = useCallback(async () => {
    if (!dir) {
      setItems([]);
      return;
    }
    try {
      setItems(await snapshotList(dir));
      setError(null);
    } catch (e) {
      setItems([]);
      setError(String(e));
    }
  }, [dir]);

  const reloadAll = useCallback(async () => {
    await Promise.all([load(), loadMeta()]);
  }, [load, loadMeta]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  /** 登记到平台：失败不阻断本地操作，只提示，后续可用「同步登记」补齐 */
  async function registerMeta(target: SnapshotMeta): Promise<boolean> {
    if (!hasSession()) return false;
    try {
      const saved = await api.snapshotCreateMeta(roomId, target.name, target.sizeBytes);
      setMeta((prev) => [
        ...prev.filter((item) => item.name.toLowerCase() !== saved.name.toLowerCase()),
        saved,
      ]);
      setMetaError(null);
      return true;
    } catch (e) {
      setMetaError(`平台登记失败：${errorText(e)}`);
      return false;
    }
  }

  async function create() {
    if (!dir) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await snapshotCreate(dir, name.trim());
      const synced = await registerMeta(created);
      setMessage(
        `已创建快照 ${created.name}（${(created.sizeBytes / 1048576).toFixed(1)} MB）${
          synced ? "，已登记到平台" : "，平台登记未完成"
        }`,
      );
      setName(defaultName());
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: SnapshotMeta) {
    if (!dir) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await snapshotDelete(dir, target.name);
      let note = "";
      if (hasSession()) {
        try {
          setMeta(await api.snapshotDeleteMeta(roomId, target.name));
          setMetaError(null);
        } catch (e) {
          note = `（平台登记删除失败：${errorText(e)}）`;
        }
      }
      setMessage(`已删除快照 ${target.name}${note}`);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 双向对齐：本地有平台无 → 补登记；平台有本地无 → 清登记 */
  async function syncMeta() {
    if (!dir || !hasSession()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const localNames = new Set(items.map((item) => item.name.toLowerCase()));
      let added = 0;
      for (const item of items) {
        if (registered.has(item.name.toLowerCase())) continue;
        if (await registerMeta(item)) added += 1;
      }
      let removed = 0;
      for (const item of meta) {
        if (localNames.has(item.name.toLowerCase())) continue;
        setMeta(await api.snapshotDeleteMeta(roomId, item.name));
        removed += 1;
      }
      setMessage(`平台登记已同步：补登记 ${added} 条，清理失效 ${removed} 条`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function requestRestore(target: SnapshotMeta) {
    setPendingRestore(target);
    setConfirmText("");
    setError(null);
    setMessage(null);
  }

  async function confirmRestore() {
    if (!pendingRestore || !dir) return;
    if (confirmText.trim() !== (detail?.name ?? "")) {
      setError("房间名称不匹配，恢复已取消");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const guard = protectionName();
    try {
      // 恢复会覆盖当前地图，先强制留一个保护快照；失败则中止，避免回不到恢复前
      try {
        const created = await snapshotCreate(dir, guard);
        await registerMeta(created);
      } catch (e) {
        setError(`保护快照创建失败，已中止恢复：${String(e)}`);
        return;
      }
      const restored = await snapshotRestore(dir, pendingRestore.name);
      setMessage(
        `已从 ${pendingRestore.name} 恢复：${restored.join("、")}；保护快照：${guard}（重启服务端后生效）`,
      );
      setPendingRestore(null);
      setConfirmText("");
      await reloadAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const fieldCls =
    "border border-ljx-border bg-ljx-deep px-2.5 py-1 text-[13px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent";

  return (
    <div className="mx-auto max-w-3xl px-4 py-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="mr-auto text-[14px] font-bold text-ljx-text">快照</h3>
        <input
          className={`${fieldCls} w-56`}
          value={name}
          placeholder="快照名称（字母/数字/-/_/.）"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="bg-ljx-accent px-3.5 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
          disabled={busy || !dir || !name.trim()}
          onClick={() => void create()}
        >
          {busy ? "处理中…" : "创建快照"}
        </button>
        <button
          className="border border-ljx-border bg-ljx-bg2 px-3.5 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text disabled:opacity-60"
          disabled={busy || !dir || !hasSession()}
          title="按名称对齐本地快照与平台登记"
          onClick={() => void syncMeta()}
        >
          同步登记
        </button>
      </div>

      <p className="mb-3 text-[12px] text-ljx-text3">
        快照保存在房间工作目录的 <span className="font-mono">ljx-snapshots</span> 下，包含地图存档与关键配置
        （不含插件 jar）；平台只登记名称与体积，按名称与本地文件对齐。
        {dir && <span className="ml-1 font-mono">目录：{dir}</span>}
      </p>

      {dirError && (
        <p className="mb-3 border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-gold">
          {dirError}
          <button className="ml-2 text-ljx-text2 underline" onClick={() => refreshDir()}>
            重新解析
          </button>
        </p>
      )}
      {metaError && (
        <p className="mb-3 border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-gold">
          {metaError}
        </p>
      )}
      {error && (
        <p className="mb-3 border border-ljx-accent-deep bg-ljx-deep px-3 py-2 text-[12px] text-ljx-accent">
          {error}
        </p>
      )}
      {message && (
        <p className="mb-3 border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-green">
          {message}
        </p>
      )}

      <div className="border border-ljx-border bg-ljx-surface">
        <div className="flex items-center gap-3 border-b border-ljx-border px-4 py-2 text-[12px] font-semibold text-ljx-text3">
          <span className="flex-1">名称</span>
          <span className="w-20">大小</span>
          <span className="w-40">创建时间</span>
          <span className="w-16 text-center">登记</span>
          <span className="w-24" />
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-ljx-text3">
            暂无快照。危险操作执行前会自动创建保护快照。
          </div>
        ) : (
          items.map((s) => {
            const onPlatform = registered.has(s.name.toLowerCase());
            return (
              <div
                key={s.name}
                className="flex items-center gap-3 border-b border-ljx-border px-4 py-2.5 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-ljx-text">{s.name}</span>
                <span className="w-20 text-ljx-text3">{(s.sizeBytes / 1048576).toFixed(1)} MB</span>
                <span className="w-40 text-[12px] text-ljx-text3">{s.createdAt}</span>
                <span
                  className={`w-16 text-center text-[12px] ${
                    onPlatform ? "text-ljx-green" : "text-ljx-text3"
                  }`}
                >
                  {onPlatform ? "已登记" : "未登记"}
                </span>
                <div className="flex w-24 justify-end gap-2">
                  <button
                    className="text-ljx-accent hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => requestRestore(s)}
                  >
                    恢复
                  </button>
                  <button
                    className="text-ljx-accent hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void remove(s)}
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {pendingRestore && (
        <section className="mt-4 border border-ljx-accent-deep/60 bg-ljx-deep/40 p-4">
          <h4 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-ljx-accent">
            <img src={warningIcon} alt="" className="h-4 w-4" draggable={false} />
            恢复到 {pendingRestore.name}
          </h4>
          <p className="mb-2 text-[12px] leading-5 text-ljx-text3">
            恢复会用快照内容覆盖当前地图与配置（world / world_nether / world_the_end
            与关键配置文件），快照之后新增的内容将被丢弃。执行前会自动创建保护快照，可再恢复回来。
            {running && <span className="ml-1 text-ljx-accent">服务端正在运行，需先停止。</span>}
          </p>
          <div className="flex gap-2">
            <input
              className={`${fieldCls} flex-1`}
              value={confirmText}
              placeholder={`输入房间名称 ${detail?.name ?? ""} 以确认`}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            <button
              className="bg-ljx-accent-deep px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              disabled={busy || running || confirmText.trim() !== (detail?.name ?? "")}
              onClick={() => void confirmRestore()}
            >
              {busy ? "恢复中…" : "确认恢复"}
            </button>
            <button
              className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2"
              onClick={() => {
                setPendingRestore(null);
                setConfirmText("");
              }}
            >
              取消
            </button>
          </div>
        </section>
      )}
    </div>
  );
}