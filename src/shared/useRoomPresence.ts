import { useEffect, useState } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics";
import { api, errorText, type PresencePayload } from "./api";
import { useInterval } from "./useInterval";

/** 续期周期：远小于后端 90 秒超时，允许两次丢包 */
const PRESENCE_INTERVAL_MS = 30_000;

/**
 * 房间成员存在性：进入「当前加入」页即登记为成员，停留期间每 30 秒续期，离开页面时移除。
 *
 * 平台既看不到房主的服务端、也看不到玩家的客户端，所以「谁在这个房间里」只能由
 * 客户端自己上报。后端 90 秒未收到续期即视为离开——覆盖崩溃 / 断网 / 强杀。
 *
 * @param roomId  当前查看的房间；null 表示未选择房间
 * @param enabled 通常传「已登录」：未登录时后端返回 1104，不必发无用请求
 * @returns `presence`：最近一次的成员视图；`blocked`：被房间门槛挡下的原因（无则 null）；
 *          `checked`：是否已经拿到过结果 —— **未拿到结果前不能当作"可以进入"**
 *
 * 为什么要返回 blocked：房间详情接口是公开的（看大厅要用），所以访客能打开这个页面。
 * 但"能不能真正进去"由 presence 决定。之前这里 catch 掉错误不告诉上层，
 * 结果访客看到界面一切正常、以为已经进房了 —— 必须把拦截原因显式暴露出来。
 *
 * 结构上与 {@link useRoomHeartbeat} 是同一类（进入即上报 + 定时续期 + 离开清理），
 * 两者共用 {@link useInterval} 骨架；改动其中一个时请对照另一个。
 */
/** 被房间拒之门外的原因 */
export interface PresenceBlock {
  code: number;
  message: string;
}

/**
 * 网络层失败时的本地错误码（见 api.ts 的 NETWORK_ERROR）。
 * 这类错误（断网、后端没起）不应该显示成"你被房间拒绝了" —— 它跟房间无关。
 */
const NETWORK_ERROR_CODE = -1;

export function useRoomPresence(roomId: number | null, enabled: boolean) {
  const [presence, setPresence] = useState<PresencePayload | null>(null);
  const [blocked, setBlocked] = useState<PresenceBlock | null>(null);
  /**
   * 是否已经拿到过"能不能进"的结果。
   * 必须和 blocked 分开：`blocked === null` 同时意味着"没被拦"和"还没查"，
   * 而这两者的处理完全相反 —— 把"还没查"当成"可以进"，就会出现
   * 切房间后那几秒内按钮全部可用、能拿走服务器地址的漏洞。
   */
  const [checked, setChecked] = useState(false);

  // 切换房间时必须清掉上一个房间的拦截状态：
  // 之前没清，导致"进过禁止游客的房"之后，换到没限制的房也一直显示旧的拦截提示。
  useEffect(() => {
    setBlocked(null);
    setChecked(false); // 换了房间就是"还没查过"，在拿到新结果前一律不放行
  }, [roomId]);

  // 周期续期走公共骨架（与 useRoomHeartbeat 同一套，改动时请同步看另一边）
  useInterval(
    async () => {
      try {
        const result = await api.enterRoom(roomId!);
        setPresence(result);
        setBlocked(null);
        setChecked(true);
        useDiagnosticsStore.getState().markPresence(roomId!, result.memberCount);
      } catch (e) {
        // 只要服务端给了**业务错误码**（code > 0），就说明"这个人进不去这个房间"：
        // 上锁 1303 / 需要邮箱 1305 / 禁止游客 1307，以及未来的任何新门槛。
        //
        // 这里刻意**不用固定错误码白名单** —— 一开始按 1303/1305/1307 判断，
        // 结果真实场景下没能拦住（表现就是"房间没限制却进不去"）。
        // 改成"业务错误即拦截"更稳：能少漏判，将来加新门槛也不用回来改这里。
        // 网络层失败（-1）仍然静默：那是连接问题，不该说成"房间拒绝了你"。
        const code = (e as { code?: number })?.code ?? NETWORK_ERROR_CODE;
        if (code > 0) {
          setBlocked({ code, message: errorText(e) });
          setPresence(null);
        }
        setChecked(true);
      }
    },
    PRESENCE_INTERVAL_MS,
    // 注意：这里**不能**加 `&& blocked === null`。
    // 之前在拦截后停止重试，导致两个问题：① 玩家登录/绑邮箱后不会自动恢复；
    // ② 切到另一个没限制的房间时也永远不再尝试（bug 现场）。
    roomId !== null && enabled,
    // resetKey = roomId：切房间立刻为新房间请求一次，而不是干等下一个 30 秒周期
    roomId,
  );

  useEffect(() => {
    if (roomId === null || !enabled) {
      setPresence(null);
      return;
    }
    return () => {
      // 清理同时覆盖「切换房间」与「退出房间」两条路径：
      // 这个 effect 的闭包捕获的是旧 roomId，所以切房间会先退出旧房间再进入新房间。
      // 失败不影响本地交互，由后端 90 秒超时兜底。
      void api.leaveRoom(roomId).catch(() => {});
    };
  }, [roomId, enabled]);

  return { presence, blocked, checked };
}
