import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import warningIcon from "@/assets/icons/warning.png";
import { propsRead, propsWrite, snapshotCreate, worldClear, worldReset } from "@/shared/tauri";
import { api, errorText, hasSession, type ClientPackageMeta } from "@/shared/api";
import { QUOTA_UNLIMITED } from "@/shared/constants";
import { useRoomDetail } from "@/shared/useRoomDetail";
import { useRoomServerDir } from "@/shared/useRoomServerDir";
import { useAccountStore } from "@/stores/account";
import { useServerProcStore } from "@/stores/serverProc";
import type { PropertyLine } from "@/shared/types";

const BOOLEAN_PROPS = [
  { key: "enable-command-block", label: "命令方块" },
  { key: "spawn-animals", label: "生成动物" },
  { key: "spawn-monsters", label: "生成怪物" },
  { key: "spawn-npcs", label: "生成 NPC" },
  { key: "allow-flight", label: "允许飞行" },
  { key: "pvp", label: "允许 PVP" },
  { key: "allow-nether", label: "允许下界" },
] as const;

const NUMBER_PROPS = [
  { key: "max-players", label: "玩家容量", min: 1 },
  { key: "spawn-protection", label: "出生点保护", min: 0 },
  { key: "view-distance", label: "视距（区块）", min: 3 },
] as const;

const DIFFICULTY_OPTIONS = [
  { value: "peaceful", label: "和平" },
  { value: "easy", label: "简单" },
  { value: "normal", label: "普通" },
  { value: "hard", label: "困难" },
] as const;

/** 键缺失时的取值：与原版 server.properties 默认值一致，避免保存时把服务端行为改掉 */
const DEFAULTS: Record<string, string> = {
  "max-players": "20",
  "spawn-protection": "16",
  "view-distance": "10",
  difficulty: "easy",
  "enable-command-block": "false",
  "spawn-animals": "true",
  "spawn-monsters": "true",
  "spawn-npcs": "true",
  "allow-flight": "false",
  pvp: "true",
  "allow-nether": "true",
};

function parseProperties(lines: PropertyLine[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of lines) {
    if (!line.comment) map[line.key] = line.value;
  }
  return map;
}

/** 老版本配置里 difficulty 是 0-3 数字，统一转成可选项名称 */
const DIFFICULTY_ALIASES: Record<string, string> = {
  "0": "peaceful",
  "1": "easy",
  "2": "normal",
  "3": "hard",
};

function normalizeDifficulty(raw: string | undefined): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (DIFFICULTY_OPTIONS.some((option) => option.value === value)) return value;
  return DIFFICULTY_ALIASES[value] ?? "easy";
}

export function SettingsTab({ roomId }: { roomId: number }) {
  const { detail } = useRoomDetail(roomId);
  const { dir, error: dirError, refresh: refreshDir } = useRoomServerDir();
  const phase = useServerProcStore((s) => s.phase);
  const running = phase === "running" || phase === "starting" || phase === "stopping";

  const [props, setProps] = useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmText, setConfirmText] = useState("");
  const [pendingDanger, setPendingDanger] = useState<"world" | "all" | null>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerMsg, setDangerMsg] = useState<string | null>(null);
  const [dangerError, setDangerError] = useState<string | null>(null);

  const [pkg, setPkg] = useState<ClientPackageMeta | null>(null);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [pkgMsg, setPkgMsg] = useState<string | null>(null);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const pkgInputRef = useRef<HTMLInputElement>(null);

  const quotas = useAccountStore((s) => s.quotas);
  const pkgLimitMb = quotas.CLIENT_PKG_MB;

  const loadPkg = useCallback(async () => {
    if (!hasSession()) {
      setPkg(null);
      return;
    }
    try {
      setPkg(await api.clientPackageMeta(roomId));
      setPkgError(null);
    } catch (e) {
      setPkg(null);
      setPkgError(errorText(e));
    }
  }, [roomId]);

  useEffect(() => {
    void loadPkg();
  }, [loadPkg]);

  async function uploadPkg(file: File) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setPkgError("客户端压缩包仅支持 zip 格式");
      return;
    }
    const limitBytes =
      pkgLimitMb !== undefined && pkgLimitMb < QUOTA_UNLIMITED ? pkgLimitMb * 1048576 : null;
    if (limitBytes !== null && file.size > limitBytes) {
      setPkgError(
        `压缩包 ${(file.size / 1048576).toFixed(2)} MB 超出当前等级上限 ${pkgLimitMb} MB`,
      );
      return;
    }
    setPkgBusy(true);
    setPkgMsg(null);
    setPkgError(null);
    try {
      setPkg(await api.uploadClientPackage(roomId, file));
      setPkgMsg(`已上传 ${file.name}，玩家在「当前加入」页启动游戏时可下载`);
    } catch (e) {
      setPkgError(errorText(e));
    } finally {
      setPkgBusy(false);
      if (pkgInputRef.current) pkgInputRef.current.value = "";
    }
  }

  async function removePkg() {
    if (!window.confirm("确认删除已上传的客户端压缩包？玩家将无法再下载。")) return;
    setPkgBusy(true);
    setPkgMsg(null);
    setPkgError(null);
    try {
      await api.deleteClientPackage(roomId);
      setPkg(null);
      setPkgMsg("已删除客户端压缩包");
    } catch (e) {
      setPkgError(errorText(e));
    } finally {
      setPkgBusy(false);
    }
  }

  const propsPath = useMemo(() => (dir ? `${dir}\\server.properties` : null), [dir]);

  const load = useCallback(async () => {
    if (!propsPath) {
      setProps(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const map = parseProperties(await propsRead(propsPath));
      map.difficulty = normalizeDifficulty(map.difficulty);
      setProps(map);
    } catch (e) {
      setProps(null);
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propsPath]);

  useEffect(() => {
    void load();
  }, [load]);

  function valueOf(key: string): string {
    return props?.[key] ?? DEFAULTS[key] ?? "";
  }

  function boolOf(key: string): boolean {
    return valueOf(key) === "true";
  }

  async function save() {
    if (!propsPath || !props) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // 只写受管键：props_write 逐行替换并保留注释与其余配置
      const entries: PropertyLine[] = [
        ...NUMBER_PROPS.map((p) => ({ key: p.key, value: valueOf(p.key), comment: false })),
        { key: "difficulty", value: valueOf("difficulty"), comment: false },
        ...BOOLEAN_PROPS.map((p) => ({
          key: p.key,
          value: String(boolOf(p.key)),
          comment: false,
        })),
      ];
      await propsWrite(propsPath, entries);
      setSaveMsg("已写入 server.properties（注释与未修改项保持不变，重启服务端后生效）");
      await load();
    } catch (e) {
      setSaveMsg(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function requestDanger(kind: "world" | "all") {
    setPendingDanger(kind);
    setConfirmText("");
    setDangerMsg(null);
    setDangerError(null);
  }

  async function confirmDanger() {
    if (!pendingDanger || !dir) return;
    if (!detail || confirmText.trim() !== detail.name) {
      setDangerError("房间名称不匹配，操作已取消");
      return;
    }
    if (running) {
      setDangerError("服务端正在运行，请先停止服务端再执行危险操作");
      return;
    }
    setDangerBusy(true);
    setDangerError(null);
    setDangerMsg(null);
    try {
      // 危险操作前强制创建保护快照；快照失败则中止，绝不带着未备份的数据继续删
      const snapshotName = `pre-destroy-${new Date().toISOString().slice(0, 10)}`;
      try {
        await snapshotCreate(dir, snapshotName);
      } catch (e) {
        setDangerError(`保护快照创建失败，已中止操作：${String(e)}`);
        return;
      }
      const removed =
        pendingDanger === "world" ? await worldClear(dir) : await worldReset(dir);
      setDangerMsg(
        `${pendingDanger === "world" ? "清空地图" : "全部重置"}完成，已处理：${removed.join("、")}；保护快照：${snapshotName}`,
      );
      setPendingDanger(null);
      setConfirmText("");
      if (pendingDanger === "all") await load();
    } catch (e) {
      setDangerError(String(e));
    } finally {
      setDangerBusy(false);
    }
  }

  const fieldCls =
    "border border-ljx-border bg-ljx-deep px-2.5 py-1 text-[13px] text-ljx-text outline-none focus:border-ljx-accent";
  const labelCls = "flex items-center justify-between text-[13px] text-ljx-text2";

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
      <section className="border border-ljx-border bg-ljx-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-ljx-text">主要设置</h3>
          <div className="flex items-center gap-2">
            <span className="max-w-[320px] truncate text-[11px] text-ljx-text3" title={dir ?? propsPath ?? ""}>
              {dir ? `目录：${dir}` : "未定位到工作目录"}
            </span>
            <button
              className="border border-ljx-border bg-ljx-bg2 px-2.5 py-1 text-[12px] text-ljx-text2 hover:text-ljx-text"
              onClick={() => {
                refreshDir();
                void load();
              }}
            >
              重新加载
            </button>
          </div>
        </div>

        {dirError && (
          <p className="mb-3 border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-gold">
            {dirError}
          </p>
        )}
        {loading && <p className="text-[12px] text-ljx-text3">正在读取 server.properties…</p>}
        {loadError && !loading && (
          <p className="mb-3 border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-gold">
            未读取到 server.properties（服务端首次启动后会自动生成）：{loadError}
          </p>
        )}

        {props && (
          <>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              {NUMBER_PROPS.map((p) => (
                <label key={p.key} className={labelCls}>
                  {p.label}
                  <input
                    type="number"
                    min={p.min}
                    className={`${fieldCls} w-24`}
                    value={valueOf(p.key)}
                    onChange={(e) =>
                      setProps({ ...props, [p.key]: e.target.value.replace(/[^0-9]/g, "") })
                    }
                  />
                </label>
              ))}
              <label className={labelCls}>
                难度
                <select
                  className={`${fieldCls} w-24`}
                  value={valueOf("difficulty")}
                  onChange={(e) => setProps({ ...props, difficulty: e.target.value })}
                >
                  {DIFFICULTY_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              {BOOLEAN_PROPS.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-center gap-2 text-[13px] text-ljx-text2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[#e8664a]"
                    checked={boolOf(p.key)}
                    onChange={(e) => setProps({ ...props, [p.key]: String(e.target.checked) })}
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                className="bg-ljx-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "保存中…" : "保存设置"}
              </button>
              <button className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text">
                编辑插件配置
              </button>
            </div>
            {saveMsg && <p className="mt-2 text-[12px] text-ljx-gold">{saveMsg}</p>}
          </>
        )}
      </section>

      <section className="border border-ljx-border bg-ljx-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-bold text-ljx-text">客户端压缩包</h3>
          <span className="text-[12px] text-ljx-text3">
            当前等级上限：
            {pkgLimitMb === undefined
              ? "—"
              : pkgLimitMb >= QUOTA_UNLIMITED
                ? "不限"
                : `${pkgLimitMb} MB`}
          </span>
        </div>
        <p className="mb-3 text-[12px] leading-5 text-ljx-text3">
          本软件不参与客户端打包：房主把整理好的客户端 zip 上传到平台，玩家在「当前加入」页点击
          「启动游戏」时选择下载文件夹，再自行用 PCL 导入。
        </p>
        {pkg ? (
          <div className="flex items-center gap-3 border border-ljx-border bg-ljx-deep px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-ljx-text" title={pkg.fileName}>
              {pkg.fileName}
            </span>
            <span className="text-[12px] text-ljx-text3">
              {(pkg.sizeBytes / 1048576).toFixed(2)} MB
            </span>
            <button
              className="text-ljx-accent hover:underline disabled:opacity-50"
              disabled={pkgBusy}
              onClick={() => void removePkg()}
            >
              删除
            </button>
          </div>
        ) : (
          <p className="border border-ljx-border bg-ljx-deep px-3 py-2 text-[13px] text-ljx-text3">
            尚未上传客户端压缩包
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <input
            ref={pkgInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadPkg(file);
            }}
          />
          <button
            className="bg-ljx-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
            disabled={pkgBusy}
            onClick={() => pkgInputRef.current?.click()}
          >
            {pkgBusy ? "处理中…" : pkg ? "重新上传" : "选择 zip 上传"}
          </button>
          <button
            className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text disabled:opacity-60"
            disabled={pkgBusy}
            onClick={() => void loadPkg()}
          >
            刷新
          </button>
        </div>
        {pkgError && <p className="mt-2 text-[12px] text-ljx-accent">{pkgError}</p>}
        {pkgMsg && <p className="mt-2 text-[12px] text-ljx-green">{pkgMsg}</p>}
      </section>

      <section className="border border-ljx-accent-deep/60 bg-ljx-deep/40 p-5">
        <h3 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-ljx-accent">
          <img src={warningIcon} alt="" className="h-4 w-4" draggable={false} />
          危险区
        </h3>
        <p className="mb-3 text-[12px] text-ljx-text3">
          以下操作不可恢复。执行前将自动创建保护快照（ljx-snapshots 目录），快照失败则中止操作。
          {running && <span className="ml-1 text-ljx-accent">服务端正在运行，需先停止。</span>}
        </p>
        <div className="flex gap-2">
          <button
            className="border border-ljx-accent-deep bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white"
            onClick={() => requestDanger("world")}
          >
            清空地图
          </button>
          <button
            className="border border-ljx-accent-deep bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white"
            onClick={() => requestDanger("all")}
          >
            全部重置
          </button>
        </div>
        <p className="mt-3 text-[12px] leading-5 text-ljx-text3">
          清空地图：删除 world / world_nether / world_the_end。
          <br />
          全部重置：在清空地图基础上，额外删除 server.properties、ops / whitelist / banned
          名单与 logs、crash-reports。
        </p>
        {pendingDanger && (
          <div className="mt-3 border border-ljx-border bg-ljx-surface p-3">
            <p className="mb-2 text-[13px] text-ljx-text2">
              确认{pendingDanger === "world" ? "清空地图" : "全部重置"}？输入房间名称
              <span className="mx-1 font-mono text-ljx-accent">{detail?.name ?? "…"}</span>
              以确认：
            </p>
            <div className="flex gap-2">
              <input
                className={`${fieldCls} flex-1`}
                value={confirmText}
                placeholder="在此输入房间名称"
                onChange={(e) => setConfirmText(e.target.value)}
              />
              <button
                className="bg-ljx-accent-deep px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
                disabled={dangerBusy || confirmText.trim() !== (detail?.name ?? "")}
                onClick={() => void confirmDanger()}
              >
                {dangerBusy ? "执行中…" : "确认执行"}
              </button>
              <button
                className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2"
                onClick={() => setPendingDanger(null)}
              >
                取消
              </button>
            </div>
          </div>
        )}
        {dangerError && (
          <p className="mt-3 border border-ljx-accent-deep bg-ljx-surface px-3 py-2 text-[12px] text-ljx-accent">
            {dangerError}
          </p>
        )}
        {dangerMsg && (
          <p className="mt-3 border border-ljx-border bg-ljx-surface px-3 py-2 text-[12px] text-ljx-green">
            {dangerMsg}
          </p>
        )}
      </section>
    </div>
  );
}
