import { create } from "zustand";
import {
  api,
  clearSession,
  hasSession,
  onSessionExpired,
  persistGuestSession,
  purgePersistedSession,
  restoreGuestSession,
  restoreSession,
  setSession,
  type AccountPayload,
  isNetworkError,
} from "@/shared/api";
import { usePreferencesStore } from "@/stores/preferences";
import type { AccountInfo } from "@/shared/types";

interface AccountState {
  account: AccountInfo | null;
  /** 后端下发的配额生效值，如 PLAYER_CAP */
  quotas: Record<string, number>;
  /** 启动会话恢复是否完成 */
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  sendEmailCode: (email: string) => Promise<void>;
  bindEmail: (email: string, code: string) => Promise<void>;
  init: () => Promise<void>;
}

function toAccountInfo(payload: AccountPayload): AccountInfo {
  return {
    id: payload.id,
    username: payload.username,
    level: payload.level,
    vip: payload.vipLevel > 0 ? payload.vipLevel : null,
    coins: payload.coins,
    email: payload.email,
    emailBound: payload.email !== null,
    anonymous: payload.anonymous,
  };
}

function applyAccount(payload: AccountPayload) {
  return { account: toAccountInfo(payload), quotas: payload.quotas };
}

export const useAccountStore = create<AccountState>((set) => ({
  account: null,
  quotas: {},
  ready: false,

  login: async (username, password) => {
    const payload = await api.login(username, password);
    setSession(
      { accessToken: payload.accessToken, refreshToken: payload.refreshToken },
      usePreferencesStore.getState().rememberPassword,
    );
    usePreferencesStore.getState().setLastUsername(payload.account.username);
    set(applyAccount(payload.account));
  },

  register: async (username, password) => {
    const payload = await api.register(username, password);
    setSession(
      { accessToken: payload.accessToken, refreshToken: payload.refreshToken },
      usePreferencesStore.getState().rememberPassword,
    );
    usePreferencesStore.getState().setLastUsername(payload.account.username);
    set(applyAccount(payload.account));
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // 服务端不可达时也要清掉本地会话
    }
    clearSession();
    set({ account: null, quotas: {} });
    // 退出正式账号后回到访客身份：软件不需要登录也能开服，
    // 直接落到"未登录"会让大厅、建房都不可用。
    try {
      if (!(await restoreGuestSession())) {
        const guest = await api.registerGuest();
        await persistGuestSession({
          accessToken: guest.accessToken,
          refreshToken: guest.refreshToken,
        });
        set(applyAccount(guest.account));
      } else {
        set(applyAccount(await api.me()));
      }
    } catch {
      // 后端不可达：保持未登录
    }
  },

  reload: async () => {
    if (!hasSession()) return;
    set(applyAccount(await api.me()));
  },

  sendEmailCode: async (email) => {
    await api.sendEmailCode(email);
  },

  bindEmail: async (email, code) => {
    set(applyAccount(await api.bindEmail(email, code)));
  },

  /**
   * 启动初始化。本软件定位是**开服器**，不强制登录，所以优先级是：
   *   ① 恢复正式账号（仅当勾了「记住密码」）；
   *   ② 恢复本机访客身份；
   *   ③ 都没有 → 自动申请一个访客身份（玩家无感）。
   * 访客身份用**独立存储键**，不会被"未勾记住密码"的清理逻辑删掉 ——
   * 否则每次启动都换新访客，之前建的房间就再也管不了了。
   */
  init: async () => {
    try {
      if (usePreferencesStore.getState().rememberPassword && (await restoreSession())) {
        try {
          set(applyAccount(await api.me()));
          return;
        } catch (e) {
          // **只有令牌确实失效才清会话**。
          // 之前这里无条件 clearSession()，而它连磁盘上的令牌一起清 ——
          // 后果是"服务器临时不可达"会永久登出用户：下次联网还得重新输密码，
          // 「记住密码」等于白设（本轮离线测试时实际踩到，正式账号令牌被清掉）。
          if (!isNetworkError(e)) clearSession();
        }
      } else {
        // 未勾「记住密码」：丢弃上次遗留的正式令牌（访客令牌不受影响）
        await purgePersistedSession();
      }

      if (await restoreGuestSession()) {
        try {
          set(applyAccount(await api.me()));
          return;
        } catch {
          // 访客身份也失效了（例如后端库被重建）：往下走，重新申请一个
        }
      }

      const guest = await api.registerGuest();
      await persistGuestSession({
        accessToken: guest.accessToken,
        refreshToken: guest.refreshToken,
      });
      set(applyAccount(guest.account));
    } catch {
      // 后端不可达：保持未登录状态，但不要让初始化卡住（大厅会显示连接失败）
      set({ account: null, quotas: {} });
    } finally {
      set({ ready: true });
    }
  },
}));

onSessionExpired(() => {
  useAccountStore.setState({ account: null, quotas: {} });
});