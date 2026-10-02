import { useEffect, useState } from "react";
import { useAccountStore } from "@/stores/account";
import { usePreferencesStore } from "@/stores/preferences";
import { errorText } from "@/shared/api";
import { formatQuotaLimit } from "@/shared/constants";
import registerBanner from "@/assets/icons/register-banner.png";

interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
}

type Mode = "login" | "register";

const inputCls =
  "w-full border border-ljx-border bg-ljx-deep px-3 py-2 text-[13px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent";

export function AccountDialog({ open, onClose }: AccountDialogProps) {
  const [mode, setMode] = useState<Mode>("login");
  /**
   * 是否强制显示登录/注册表单。
   * 因为访客也是 account（由后端自动创建），若只按 `account ? 面板 : 表单` 判断，
   * 访客将**永远看不到登录入口** —— 想升级成正式账号都没有门路。
   */
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const account = useAccountStore((s) => s.account);
  const login = useAccountStore((s) => s.login);
  const register = useAccountStore((s) => s.register);
  const logout = useAccountStore((s) => s.logout);

  const rememberPassword = usePreferencesStore((s) => s.rememberPassword);
  const setRememberPassword = usePreferencesStore((s) => s.setRememberPassword);
  const lastUsername = usePreferencesStore((s) => s.lastUsername);

  // 只在打开弹窗（或上次用户名就绪）时回填。依赖里不能带 username：
  // 否则用户把输入框清空的瞬间就会被立刻填回完整用户名，导致删不干净。
  useEffect(() => {
    if (open) setUsername(lastUsername);
  }, [open, lastUsername]);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!username.trim()) return setError("请输入账户");
    if (password.length < 6) return setError("密码需 6 位以上");
    if (mode === "register" && password !== repeat) return setError("两次输入的密码不一致");
    setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
      setPassword("");
      setRepeat("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onClick={onClose}>
      <div
        className="w-[22rem] border border-ljx-border bg-ljx-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {account && !showAuthForm ? (
          <AccountPanel
            onLogout={() => void logout()}
            onUpgrade={() => {
              setShowAuthForm(true);
              setMode("register");
            }}
          />
        ) : (
          <>
            {mode === "register" ? (
              <img
                src={registerBanner}
                alt="快速注册，现在就玩"
                className="mx-auto mb-4 h-[38px]"
                draggable={false}
              />
            ) : (
              <div className="mb-4 text-center text-[16px] font-bold text-ljx-text">登录垃圾侠</div>
            )}

            <div className="mb-4 text-center text-[12px] text-ljx-text3">
              {mode === "register" ? "已有账号？" : "还没有账号？"}
              <button
                className="ml-1 font-semibold text-ljx-accent hover:underline"
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setError(null);
                }}
              >
                {mode === "register" ? "点我登录" : "点我注册"}
              </button>
            </div>

            <div className="space-y-3">
              <input
                className={inputCls}
                placeholder="账户"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                type="password"
                className={inputCls}
                placeholder="密码（6 位以上）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
              {mode === "register" && (
                <input
                  type="password"
                  className={inputCls}
                  placeholder="重复密码"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              )}
              <label className="flex items-center gap-2 text-[12px] text-ljx-text2">
                <input
                  type="checkbox"
                  className="accent-ljx-accent"
                  checked={rememberPassword}
                  onChange={(e) => setRememberPassword(e.target.checked)}
                />
                记住密码（下次启动自动登录）
              </label>
              {error && <ErrorBox message={error} />}
              <button
                className="w-full bg-ljx-accent py-2.5 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? "处理中…" : mode === "register" ? "快速注册" : "登录"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AccountPanel({ onLogout, onUpgrade }: { onLogout: () => void; onUpgrade: () => void }) {
  const account = useAccountStore((s) => s.account);
  const quotas = useAccountStore((s) => s.quotas);
  const sendEmailCode = useAccountStore((s) => s.sendEmailCode);
  const bindEmail = useAccountStore((s) => s.bindEmail);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  if (!account) return null;

  async function requestCode() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await sendEmailCode(email.trim());
      setCooldown(60);
      setNotice("验证码已发送，5 分钟内有效");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitBind() {
    setError(null);
    setNotice(null);
    if (!email.trim() || !code.trim()) return setError("请填写邮箱与验证码");
    setBusy(true);
    try {
      await bindEmail(email.trim(), code.trim());
      setCode("");
      setNotice("邮箱绑定成功");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 text-center text-[16px] font-bold text-ljx-text">
        {account.anonymous ? "访客身份" : "我的账号"}
      </div>
      {account.anonymous && (
        <div className="mb-3 border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] leading-5 text-ljx-text2">
          当前以<span className="text-ljx-text">访客身份</span>使用，可直接开服，无需登录。
          登录正式账号后，房间、钻石与 VIP 会记到账号名下。
          <button
            className="mt-2 block w-full border border-ljx-accent-deep py-1.5 text-[12px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white"
            onClick={onUpgrade}
          >
            注册正式账号 / 登录已有账号
          </button>
        </div>
      )}
      <div className="mb-4 space-y-1.5 border border-ljx-border bg-ljx-deep p-3 text-[12px]">
        <Row label="账户" value={account.anonymous ? `${account.username}（访客）` : account.username} />
        <Row label="等级" value={`LV${account.level}${account.vip ? ` · VIP${account.vip}` : ""}`} />
        <Row label="钻石" value={String(account.coins)} />
        <Row label="人数上限" value={formatQuotaLimit(quotas.PLAYER_CAP)} />
        <Row
          label="客户端包上限"
          value={quotas.CLIENT_PKG_MB === undefined ? "—" : `${quotas.CLIENT_PKG_MB} MB`}
        />
      </div>

      {account.emailBound ? (
        <div className="mb-4 border border-ljx-border bg-ljx-deep px-3 py-2 text-[12px] text-ljx-text2">
          已绑定邮箱：<span className="text-ljx-text">{account.email}</span>
        </div>
      ) : (
        <div className="mb-4 space-y-3">
          <div className="text-[12px] text-ljx-accent">
            {account.anonymous ? "绑定邮箱或登录正式账号后，房间会长期保留" : "创建房间需先绑定邮箱"}
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className="shrink-0 border border-ljx-accent-deep px-2 text-[12px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white disabled:opacity-50"
              disabled={busy || cooldown > 0 || !email.trim()}
              onClick={() => void requestCode()}
            >
              {cooldown > 0 ? `${cooldown}s` : "获取验证码"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="6 位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className="shrink-0 bg-ljx-accent px-3 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              disabled={busy}
              onClick={() => void submitBind()}
            >
              绑定
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="mb-3 border border-ljx-green bg-ljx-deep px-3 py-2 text-[12px] text-ljx-green">
          {notice}
        </div>
      )}
      {error && <ErrorBox message={error} />}

      <button
        className="mt-1 w-full border border-ljx-border bg-ljx-bg2 py-2 text-[13px] text-ljx-text2 hover:text-ljx-text"
        onClick={onLogout}
      >
        退出登录
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="w-16 text-ljx-text3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-ljx-text">{value}</span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="border border-ljx-accent-deep bg-ljx-deep px-3 py-2 text-[12px] text-ljx-accent">
      {message}
    </div>
  );
}