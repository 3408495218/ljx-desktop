/**
 * 「加入提醒提示音」：用 Web Audio 合成两声上行短音，**不引入任何音频文件资源**。
 *
 * 触发点见 App.tsx：有人进入**我自己的房间**（人数增加）时响一声，
 * 由「国服大厅」右上角的开/关按钮（title=加入提醒提示音）控制。
 *
 * 播放失败一律静默：WebView 在用户首次交互前会拦截音频、设备无音频输出等
 * 都不该影响业务主流程（提示音只是锦上添花）。
 */
export function playJoinChime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    // A5 → D6 上行两音，像一声轻轻的"叮咚"
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
    osc.onended = () => void ctx.close();
  } catch {
    // 静默忽略
  }
}
