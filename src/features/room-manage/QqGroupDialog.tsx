import { useEffect, useState } from "react";
import { api, errorText } from "@/shared/api";
import { openUrl } from "@/shared/tauri";
import { QQ_JOIN_PORTAL, extractIdKey, qqGroupJoinUrl } from "@/shared/qqGroup";

interface QqGroupDialogProps {
  open: boolean;
  roomId: number;
  /** 已点亮的群号与组件凭据；两者都有值时弹窗进入「已点亮」态 */
  currentCode: string | null;
  currentIdKey: string | null;
  onClose: () => void;
  /** 保存成功后通知外层刷新房间详情 */
  onSaved: () => void;
}

const inputCls =
  "w-full border border-ljx-border bg-ljx-deep px-3 py-2 text-[13px] text-ljx-text placeholder:text-ljx-text3 outline-none focus:border-ljx-accent";

const STEPS = ["填写群号", "获取加群组件", "粘贴并点亮"];

/**
 * 点亮QQ加群三步引导：群号只是展示用，真正能生成加群入口的是腾讯 WPA 组件的 idkey，
 * 因此第二步把房主送到腾讯官方页面，第三步从粘贴的组件代码里抠出 idkey。
 */
export function QqGroupDialog({
  open,
  roomId,
  currentCode,
  currentIdKey,
  onClose,
  onSaved,
}: QqGroupDialogProps) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次打开都回到第一步，并用当前已保存的值预填，便于只改其中一项
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCode(currentCode ?? "");
    setPasted(currentIdKey ?? "");
    setError(null);
  }, [open, currentCode, currentIdKey]);

  if (!open) return null;

  const idKey = extractIdKey(pasted);
  const previewUrl = qqGroupJoinUrl(idKey);
  const codeOk = /^\d{5,12}$/.test(code.trim());

  async function save() {
    if (!codeOk) return setError("请输入 5-12 位纯数字群号");
    if (!idKey) return setError("未能识别加群组件凭据，请粘贴完整组件代码或 idkey");
    setBusy(true);
    setError(null);
    try {
      await api.setQqGroup(roomId, code.trim(), idKey);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearQqGroup() {
    setBusy(true);
    setError(null);
    try {
      await api.setQqGroup(roomId, null, null);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    try {
      await openUrl(QQ_JOIN_PORTAL);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onClick={onClose}>
      <div
        className="w-[30rem] border border-ljx-border bg-ljx-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[15px] font-bold text-ljx-text">点亮QQ加群</span>
          <span className="text-[12px] text-ljx-text3">第 {step + 1} / 3 步</span>
        </div>
        {/* 步骤指示条 */}
        <div className="mb-4 flex gap-1">
          {STEPS.map((label, index) => (
            <div key={label} className="flex-1">
              <div className={`h-[3px] ${index <= step ? "bg-ljx-accent" : "bg-ljx-border"}`} />
              <span
                className={`mt-1 block text-[11px] ${
                  index <= step ? "text-ljx-accent" : "text-ljx-text3"
                }`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] text-ljx-text2">
              填写你的QQ群号。群号仅用于展示，玩家点「加入QQ群」时实际使用的是下一步获取的加群组件凭据。
            </p>
            <input
              className={inputCls}
              placeholder="群号，如 123456789"
              value={code}
              maxLength={12}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-[13px] text-ljx-text2">
              打开腾讯「一键加群」页面，选择群号 <span className="text-ljx-text">{code.trim()}</span>，
              点击生成按钮并复制页面给出的组件代码。
            </p>
            <button
              className="w-full border border-ljx-accent-deep py-2 text-[13px] text-ljx-accent hover:bg-ljx-accent-deep hover:text-white"
              onClick={() => void openPortal()}
            >
              打开腾讯一键加群页面
            </button>
            <p className="text-[12px] text-ljx-text3">
              若浏览器未打开，请手动访问 {QQ_JOIN_PORTAL}
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-[13px] text-ljx-text2">
              把复制的组件代码整段粘贴进来（也支持只粘贴 idkey），系统会自动识别其中的凭据。
            </p>
            <textarea
              className={`${inputCls} h-24 resize-none font-mono`}
              placeholder='<a target="_blank" href="//shang.qq.com/wpa/qunwpa?idkey=...">...</a>'
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <p className={`text-[12px] ${idKey ? "text-ljx-green" : "text-ljx-text3"}`}>
              {idKey ? "已识别加群凭据，保存后房间将展示加群入口" : "尚未识别到有效凭据"}
            </p>
            {previewUrl && (
              <p className="break-all text-[11px] text-ljx-text3">加群链接：{previewUrl}</p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 border border-ljx-accent-deep bg-ljx-deep px-3 py-2 text-[12px] text-ljx-accent">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          {step > 0 && (
            <button
              className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              上一步
            </button>
          )}
          {currentIdKey && (
            <button
              className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-accent disabled:opacity-60"
              disabled={busy}
              onClick={() => void clearQqGroup()}
            >
              取消点亮
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              className="border border-ljx-border bg-ljx-bg2 px-4 py-1.5 text-[13px] text-ljx-text2 hover:text-ljx-text"
              disabled={busy}
              onClick={onClose}
            >
              关闭
            </button>
            {step < 2 ? (
              <button
                className="bg-ljx-accent px-5 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
                disabled={step === 0 && !codeOk}
                onClick={() => setStep(step + 1)}
              >
                下一步
              </button>
            ) : (
              <button
                className="bg-ljx-accent px-5 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
                disabled={busy || !idKey || !codeOk}
                onClick={() => void save()}
              >
                {busy ? "保存中…" : "保存并点亮"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}