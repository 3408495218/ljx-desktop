import { useEffect, useState } from "react";
import { usePreferencesStore } from "@/stores/preferences";
import { useAccountStore } from "@/stores/account";
import { useLobbyStore } from "@/stores/lobby";
import { useDiagnosticsStore, sinceText } from "@/stores/diagnostics";
import { useServerProcStore } from "@/stores/serverProc";
import type { ServerPhase } from "@/shared/types";
import { clearSession } from "@/shared/api";
import { resolveApiBaseUrl } from "@/shared/serverConfig";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";

const PHASE_TEXT: Record<ServerPhase, string> = {
  idle: "未运行",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  failed: "异常",
};

function DiagRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${ok ? "bg-[#7ed67e]" : "bg-ljx-text3"}`}
      />
      <span className="w-24 shrink-0 text-ljx-text2">{label}</span>
      <span className="min-w-0 flex-1 truncate text-ljx-text3">{value}</span>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const serverAddress = usePreferencesStore((s) => s.serverAddress);
  const setServerAddress = usePreferencesStore((s) => s.setServerAddress);
  const [addr, setAddr] = useState(serverAddress);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>("idle");
  const diag = useDiagnosticsStore();
  const phase = useServerProcStore((s) => s.phase);
  const [, setTick] = useState(0);

  // 每秒重渲染一次，让「N 秒前」自己跳动——时间不动的话看不出某环节是不是停了
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (open) {
      setAddr(serverAddress);
      setError(null);
      setTest("idle");
    }
  }, [open, serverAddress]);

  if (!open) return null;

  async function testConnection() {
    if (!addr.trim()) return;
    setTest("testing");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    try {
      // 未登录时后端返回 401，能收到任何 HTTP 响应即说明地址可达且 CORS 放行
      await fetch(`${resolveApiBaseUrl(addr)}/api/me`, { signal: controller.signal });
      setTest("ok");
    } catch {
      setTest("fail");
    } finally {
      window.clearTimeout(timer);
    }
  }

  function save() {
    const trimmed = addr.trim();
    if (!trimmed) {
      setError("请输入服务器地址");
      return;
    }
    if (/\s/.test(trimmed)) {
      setError("地址不能包含空格");
      return;
    }
    if (trimmed !== serverAddress) {
      // 换服务器后旧会话与旧列表都无效，清空并让用户在新服务器重新登录
      clearSession();
      useAccountStore.setState({ account: null, quotas: {} });
      useLobbyStore.setState({ rooms: [], page: 1, total: 1, error: null });
    }
    setServerAddress(trimmed);
    onClose();
  }

  const inputCls =
    "w-full border border-ljx-border bg-ljx-deep px-3 py-2 text-[13px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-96 overflow-y-auto border border-ljx-border bg-ljx-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 text-center text-[16px] font-bold text-ljx-text">设置</div>

        <div className="mb-1 text-[13px] font-semibold text-ljx-text">云服务器</div>
        <p className="mb-2 text-[12px] leading-relaxed text-ljx-text3">
          平台后端地址。支持 IP / 域名（自动补 http:// 与端口 8080）或完整 URL。
        </p>
        <input
          className={inputCls}
          placeholder="例如 127.0.0.1 或 https://api.example.com"
          value={addr}
          onChange={(e) => {
            setAddr(e.target.value);
            setError(null);
            setTest("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        <p className="mt-2 text-[12px] text-ljx-text3">
          API 地址：
          <span className="selectable font-mono text-ljx-text2">
            {resolveApiBaseUrl(addr)}
          </span>
        </p>

        {error && (
          <div className="mt-3 border border-ljx-accent-deep bg-ljx-deep px-3 py-2 text-[12px] text-ljx-accent">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            className="flex-1 border border-ljx-border bg-ljx-bg2 py-2.5 text-[13px] text-ljx-text2 hover:text-ljx-text"
            onClick={() => void testConnection()}
          >
            测试连接
          </button>
          <button
            className="flex-1 bg-ljx-accent py-2.5 text-[14px] font-semibold text-white hover:brightness-110"
            onClick={save}
          >
            保存
          </button>
        </div>

        {test === "testing" && (
          <p className="mt-3 text-center text-[12px] text-ljx-text3">正在连接…</p>
        )}
        {test === "ok" && (
          <p className="mt-3 text-center text-[12px] text-[#7ed67e]">
            连接成功，服务器可达
          </p>
        )}
        {test === "fail" && (
          <p className="mt-3 text-center text-[12px] text-ljx-accent">
            无法连接到服务器，请检查地址与后端是否已启动
          </p>
        )}

        {/* 诊断：人数不更新时先看这里，能直接看出卡在链路的哪一环 */}
        <div className="mt-5 border-t border-ljx-border pt-4">
          <div className="mb-2 text-[13px] font-semibold text-ljx-text">诊断</div>
          <div className="space-y-[4px] text-[12px]">
            <DiagRow
              label="实时通道"
              ok={diag.wsConnected}
              value={`${diag.wsConnected ? "已连接" : "未连接"} · ${sinceText(diag.wsChangedAt)}`}
            />
            <DiagRow
              label="成员上报"
              ok={diag.presenceAt !== null}
              value={
                diag.presenceAt === null
                  ? "从未（未进入任何房间）"
                  : `房间 #${diag.presenceRoomId} · ${diag.presenceMemberCount ?? 0} 人 · ${sinceText(diag.presenceAt)}`
              }
            />
            <DiagRow label="房间心跳" ok={diag.heartbeatAt !== null} value={sinceText(diag.heartbeatAt)} />
            <DiagRow label="大厅列表" ok={diag.lobbyRefreshAt !== null} value={sinceText(diag.lobbyRefreshAt)} />
            <DiagRow label="本机服务端" ok={phase === "running"} value={PHASE_TEXT[phase]} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ljx-text3">
            人数不更新时依次看：「成员上报」是否在刷新（进入房间就靠它登记）→「房间心跳」是否正常
            （决定房间在不在线）→「实时通道」是否已连接（断线时由 30 秒轮询兜底）。
          </p>
        </div>
      </div>
    </div>
  );
}
