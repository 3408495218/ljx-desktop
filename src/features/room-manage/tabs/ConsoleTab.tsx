import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useConsoleStore } from "@/stores/consoleStore";
import { useServerProcStore } from "@/stores/serverProc";
import { XMX_OPTIONS } from "@/shared/constants";
import { consoleSend } from "@/shared/tauri";
import type { ServerPhase } from "@/shared/types";

const PHASE_LABELS: Record<ServerPhase, { text: string; cls: string }> = {
  idle: { text: "未运行", cls: "bg-ljx-deep text-ljx-text3" },
  starting: { text: "启动中", cls: "bg-ljx-gold/20 text-ljx-gold" },
  running: { text: "运行中", cls: "bg-ljx-green/25 text-[#7ed67e]" },
  stopping: { text: "停止中", cls: "bg-ljx-gold/20 text-ljx-gold" },
  failed: { text: "异常", cls: "bg-ljx-accent-deep/30 text-ljx-accent" },
};

export function ConsoleTab() {
  const { lines, history, translateOn, appendRaw, setTranslateOn, pushHistory } = useConsoleStore();
  const { phase, detail, javaList, config, setConfig, loadJava, start, stop, refresh } =
    useServerProcStore();
  const [cmd, setCmd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    void loadJava();
    // 挂载时先跟 Rust 对一次状态：从其它页签拉起服务端时 Starting 事件早于本组件挂载，
    // 不校准的话控制台会一直显示「未运行」，停止按钮也无从出现
    void refresh();
    // server://state 已在 App.tsx 的应用级监听（此处挂载才监听会漏掉切页后的事件）；
    // 这里只留控制台日志流，挂载时那次 refresh() 仍保留作校准
    const un1 = listen<{ raw: string }>("console://line", (e) => appendRaw(e.payload.raw));
    return () => {
      void un1.then((f) => f());
    };
  }, [appendRaw, loadJava, refresh]);

  useEffect(() => {
    if (lines.length > 0) virtuosoRef.current?.scrollToIndex({ index: lines.length - 1 });
  }, [lines.length]);

  async function onStart() {
    const err = await start();
    setError(err);
    // 失败说明前端状态与 Rust 不一致，立刻校准，否则按钮会一直卡在错的那一侧
    if (err) void refresh();
  }

  async function onStop() {
    const err = await stop();
    setError(err);
    if (err) void refresh();
  }

  async function send() {
    const value = cmd.trim();
    if (!value) return;
    try {
      await consoleSend(value);
      pushHistory(value);
      setCmd("");
      setHistoryIdx(-1);
    } catch (e) {
      setError(String(e));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      void send();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const idx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(idx);
      setCmd(history[idx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx < 0) return;
      const idx = historyIdx + 1;
      if (idx >= history.length) {
        setHistoryIdx(-1);
        setCmd("");
      } else {
        setHistoryIdx(idx);
        setCmd(history[idx]);
      }
    }
  }

  const phaseInfo = PHASE_LABELS[phase];
  const fieldCls =
    "border border-ljx-border bg-ljx-deep px-2 py-1 text-[12px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent";
  const label = "mb-1 block text-[11px] text-ljx-text3";

  return (
    <div className="flex h-full flex-col">
      {/* 启停工具栏 */}
      <div className="flex flex-wrap items-end gap-3 border-b border-ljx-border bg-ljx-bg px-4 py-2.5">
        <label className="block">
          <span className={label}>Java 运行时</span>
          <select
            className={`${fieldCls} w-52`}
            value={config.javaPath}
            onChange={(e) => setConfig({ javaPath: e.target.value })}
          >
            {javaList.length === 0 && <option value="">（未检测到，点击刷新）</option>}
            {javaList.map((j) => (
              <option key={j.path} value={j.path}>
                {j.version} — {j.source}
              </option>
            ))}
          </select>
        </label>
        <button
          className="mb-[1px] border border-ljx-border bg-ljx-bg2 px-2.5 py-[5px] text-[12px] text-ljx-text2 hover:text-ljx-text"
          onClick={() => void loadJava()}
        >
          重新检测
        </button>
        <label className="block flex-1">
          <span className={label}>服务端核心 jar 路径</span>
          <input
            className={`${fieldCls} w-full`}
            placeholder="例如 D:\servers\forge-1.7.10\forge.jar"
            value={config.jarPath}
            onChange={(e) => setConfig({ jarPath: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={label}>最大内存</span>
          <select
            className={fieldCls}
            value={config.xmxMb}
            onChange={(e) => setConfig({ xmxMb: Number(e.target.value) })}
          >
            {XMX_OPTIONS.map((x) => (
              <option key={x} value={x}>
                {x} MB
              </option>
            ))}
          </select>
        </label>
        <label className="block flex-1">
          <span className={label}>工作目录</span>
          <input
            className={`${fieldCls} w-full`}
            placeholder="留空则使用 jar 所在目录"
            value={config.workDir}
            onChange={(e) => setConfig({ workDir: e.target.value })}
          />
        </label>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 text-[12px] font-semibold ${phaseInfo.cls}`}>
            {phaseInfo.text}
          </span>
          {phase === "idle" || phase === "failed" ? (
            <button
              className="bg-ljx-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110"
              onClick={() => void onStart()}
            >
              启动服务端
            </button>
          ) : (
            <button
              className="bg-ljx-accent-deep px-4 py-1.5 text-[13px] font-semibold text-white hover:brightness-110"
              onClick={() => void onStop()}
            >
              停止服务端
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 border-b border-ljx-accent-deep bg-ljx-deep px-4 py-1.5 text-[12px] text-ljx-accent">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      {detail && !error && (
        <div className="border-b border-ljx-border bg-ljx-deep px-4 py-1.5 text-[12px] text-ljx-gold">
          {detail}
        </div>
      )}

      {/* 日志流：暖黑背景 */}
      <div className="min-h-0 flex-1 bg-ljx-console">
        <Virtuoso
          ref={virtuosoRef}
          data={lines}
          className="h-full"
          itemContent={(_, line) => (
            <div
              className={`selectable px-4 py-[1px] font-mono text-[12px] leading-5 ${
                line.level === "error"
                  ? "text-[#e8755f]"
                  : line.level === "warn"
                    ? "text-ljx-gold"
                    : "text-[#d8cfc4]"
              }`}
            >
              <span className="mr-2 text-[#7a6f63]">
                {new Date(line.ts).toLocaleTimeString("zh-CN", { hour12: false })}
              </span>
              {line.translated ?? line.raw}
              {line.translated && (
                <span className="ml-2 text-[#7a6f63]" title={line.raw}>
                  （原文已翻译）
                </span>
              )}
            </div>
          )}
        />
      </div>

      {/* 命令输入 */}
      <div className="flex items-center gap-2 border-t border-ljx-border bg-ljx-surface px-4 py-2">
        <input
          className="flex-1 border border-ljx-border bg-ljx-deep px-3 py-1.5 font-mono text-[13px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent"
          placeholder="输入命令后回车（上/下键切换历史）"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ljx-text2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[#e8664a]"
            checked={translateOn}
            onChange={(e) => setTranslateOn(e.target.checked)}
          />
          日志翻译
        </label>
      </div>
    </div>
  );
}
