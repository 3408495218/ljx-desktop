import { useState } from "react";
import { CREATE_RULES, CORE_VERSION_OPTIONS, MODE_OPTIONS } from "@/shared/constants";
import { useAccountStore } from "@/stores/account";
import { api, errorText } from "@/shared/api";

interface CreatePageProps {
  onCreated: (roomId: number) => void;
  onNeedAccount: () => void;
}

export function CreatePage({ onCreated, onNeedAccount }: CreatePageProps) {
  const account = useAccountStore((s) => s.account);

  const [form, setForm] = useState({
    name: "",
    version: "Forge-1.7.10",
    mode: MODE_OPTIONS[0] as string,
    intro: "",
    locked: false,
    noGuest: false,
    needEmail: false,
    capacity: 5,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!account) {
      onNeedAccount();
      return;
    }
    // 访客身份（未登录自动创建）不要求绑邮箱：软件定位是开服器，
    // 强制绑邮箱等于变相强制登录，而后端对匿名账号也已豁免该校验。
    if (!account.anonymous && !account.emailBound) {
      setError("创建房间需先绑定邮箱，请在右上角账号面板完成绑定");
      return;
    }
    if (!form.name.trim()) {
      setError("请填写游戏名称");
      return;
    }
    const [core, mcVersion] = splitVersion(form.version);
    setError(null);
    setBusy(true);
    try {
      const room = await api.createRoom({
        name: form.name.trim(),
        intro: form.intro.trim() || null,
        core,
        mcVersion,
        mode: form.mode,
        capacity: form.capacity,
        locked: form.locked,
        noGuest: form.noGuest,
        needEmail: form.needEmail,
      });
      onCreated(room.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "border border-ljx-border bg-ljx-deep px-2.5 py-1.5 text-[13px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <section className="mb-5 border border-ljx-border bg-ljx-surface p-5">
        <h2 className="mb-3 text-[14px] font-bold text-ljx-text">房间创建说明</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-ljx-text2">
          {CREATE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </section>

      <section className="border border-ljx-border bg-ljx-surface p-5">
        <h2 className="mb-4 text-[14px] font-bold text-ljx-text">创建游戏</h2>

        {!account ? (
          <Gate
            text="暂时无法连接服务器，请检查设置中的服务器地址"
            action="打开设置"
            onAction={onNeedAccount}
          />
        ) : !account.anonymous && !account.emailBound ? (
          <Gate
            text="创建房间需先绑定邮箱"
            action="去绑定邮箱"
            onAction={onNeedAccount}
          />
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[12px] text-ljx-text2">游戏名称</span>
              <input
                className={`${inputCls} w-full`}
                placeholder="例如：Steve Room"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            <div className="flex gap-4">
              <label className="block flex-1">
                <span className="mb-1 block text-[12px] text-ljx-text2">版本</span>
                <input
                  className={`${inputCls} w-full`}
                  list="ljx-core-versions-create"
                  placeholder="选择或直接输入，如 Paper-1.20.4"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                />
                {/* 与「我的游戏」一致：预设只是建议，允许手输任意「核心-版本」 */}
                <datalist id="ljx-core-versions-create">
                  {CORE_VERSION_OPTIONS.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </label>

              <label className="block w-32">
                <span className="mb-1 block text-[12px] text-ljx-text2">玩法</span>
                <select
                  className={`${inputCls} w-full`}
                  value={form.mode}
                  onChange={(e) => setForm({ ...form, mode: e.target.value })}
                >
                  {MODE_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-[12px] text-ljx-text2">简介</span>
              <textarea
                className={`${inputCls} h-20 w-full resize-none`}
                placeholder="向玩家介绍你的房间（选填）"
                value={form.intro}
                onChange={(e) => setForm({ ...form, intro: e.target.value })}
              />
            </label>

            <div>
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <Toggle
                  label="上锁"
                  checked={form.locked}
                  onChange={(v) => setForm({ ...form, locked: v })}
                />
                <Toggle
                  label="禁止游客"
                  checked={form.noGuest}
                  onChange={(v) => setForm({ ...form, noGuest: v })}
                />
                <Toggle
                  label="需要邮箱"
                  checked={form.needEmail}
                  onChange={(v) => setForm({ ...form, needEmail: v })}
                />
              </div>
              {/* 两个开关语义独立，写清楚区别，避免房主以为勾哪个都一样 */}
              <p className="mt-1.5 text-[11px] leading-5 text-ljx-text3">
                <span className="text-ljx-text2">禁止游客</span>：只有注册账号能进（未登录的访客会被挡下）；
                <span className="text-ljx-text2"> 需要邮箱</span>：进房的人必须已绑定邮箱。
                两者可单独勾选，也可同时勾选。
              </p>
            </div>

            <label className="block">
              <span className="mb-1 block text-[12px] text-ljx-text2">
                玩家容量（自行设置）
              </span>
              <input
                type="number"
                min={1}
                className={`${inputCls} w-32`}
                value={form.capacity}
                onChange={(e) =>
                  setForm({ ...form, capacity: Math.max(Number(e.target.value) || 1, 1) })
                }
              />
            </label>

            {error && (
              <p className="border border-ljx-accent-deep bg-ljx-deep px-3 py-2 text-[13px] text-ljx-accent">
                {error}
              </p>
            )}

            <button
              className="w-full bg-ljx-accent py-2.5 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "创建中…" : "创建游戏"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Gate({
  text,
  action,
  onAction,
}: {
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="border border-ljx-border bg-ljx-deep px-4 py-6 text-center">
      <p className="mb-3 text-[13px] text-ljx-text2">{text}</p>
      <button
        className="bg-ljx-accent px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110"
        onClick={onAction}
      >
        {action}
      </button>
    </div>
  );
}

function splitVersion(combined: string): [string, string] {
  const index = combined.indexOf("-");
  if (index < 0) return [combined, ""];
  return [combined.slice(0, index), combined.slice(index + 1)];
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ljx-text2">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-[#e8664a]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
      <span className="text-[12px] text-ljx-text3">{checked ? "开" : "关"}</span>
    </label>
  );
}