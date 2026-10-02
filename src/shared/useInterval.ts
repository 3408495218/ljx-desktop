import { useEffect, useRef } from "react";

/**
 * 周期执行一个任务：**启动时先立即执行一次**，之后每 intervalMs 执行一次，卸载时清理。
 *
 * 存在的意义：本项目有多处"进入即上报、之后定时续期"的逻辑（房间心跳、成员上报），
 * 它们的骨架完全相同 —— 立即跑一次 + 定时器 + 卸载清理 + 卸载后不再 setState。
 * 这类骨架抄两遍就容易改一处漏一处（本项目真实踩过：两个上报都曾因为挂在页面上而出错）。
 *
 * 只抽骨架、不抽业务：任务本身与清理动作仍由调用方提供，
 * 这样"要不要在清理时发离开请求""要不要额外监听事件"都由各自决定，不用塞进配置对象。
 *
 * @param task       要周期执行的任务；可以是异步，异常由调用方自行捕获
 * @param intervalMs 周期（毫秒）
 * @param enabled    false 时不启动（也不执行首次）
 * @param resetKey   变化时**立即重跑一次并重置计时器**。
 *                   典型用法：房间成员上报传 roomId —— 切换房间必须马上为新房间请求一次，
 *                   否则要靠下一个周期（30 秒）才更新，中间这段时间状态是错的（真实踩过）。
 */
export function useInterval(
  task: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
  resetKey?: unknown,
): void {
  // 用 ref 保存最新 task：避免把 task 放进依赖数组导致每次渲染都重建定时器
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void taskRef.current();
    };
    run();
    const timer = window.setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // resetKey 参与依赖：它的值一变就重跑（切房间、切目标等场景）
  }, [intervalMs, enabled, resetKey]);
}
