import { useEffect, useState } from "react";
import { api, errorText, type ShopPayload, type VipPayload } from "@/shared/api";
import { shopIcon } from "@/shared/shopIcons";
import { useAccountStore } from "@/stores/account";
import coinIcon from "@/assets/icons/diamond.png";

interface MallDialogProps {
  open: boolean;
  onClose: () => void;
  onNeedAccount: () => void;
  /** 当前管理中的房间；置顶卡要作用于某个房间（必须是自己的） */
  manageRoomId?: number | null;
}

type MallTab = "shop" | "vip";

/**
 * 商城与 VIP 档位只读展示：后端本期没有支付闭环，
 * 所有购买入口统一置灰并标注「暂未开放」，避免做出能点却没反应的按钮。
 */
export function MallDialog({ open, onClose, onNeedAccount, manageRoomId }: MallDialogProps) {
  const account = useAccountStore((s) => s.account);
  const [tab, setTab] = useState<MallTab>("shop");
  const [shop, setShop] = useState<ShopPayload | null>(null);
  const [vip, setVip] = useState<VipPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cdkCode, setCdkCode] = useState("");
  const [cdkMsg, setCdkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!account) {
      setShop(null);
      setVip(null);
      return;
    }
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const [shopData, vipData] = await Promise.all([api.shop(), api.vip()]);
        if (!alive) return;
        setShop(shopData);
        setVip(vipData);
      } catch (e) {
        if (alive) setError(errorText(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, account]);

  /** 购买后重新拉商城与档位（余额、VIP 状态都会变） */
  async function reloadAll() {
    const [shopData, vipData] = await Promise.all([api.shop(), api.vip()]);
    setShop(shopData);
    setVip(vipData);
  }

  /** 购买道具（目前仅置顶卡）。置顶卡需要选房间，交给上层弹窗处理，这里先用当前管理中的房间 */
  async function buyItem(itemId: number) {
    if (!account) {
      onClose();
      onNeedAccount();
      return;
    }
    setPaying(true);
    setPayMsg(null);
    try {
      const result = await api.purchaseItem(itemId, manageRoomId ?? undefined);
      setPayMsg({ ok: true, text: result.message });
      await reloadAll();
    } catch (e) {
      setPayMsg({ ok: false, text: errorText(e) });
    } finally {
      setPaying(false);
    }
  }

  /** 购买 VIP 档位：VIP 的唯一来源是档位表，买了之后房间边框会变 */
  async function buyVip(level: number) {
    if (!account) {
      onClose();
      onNeedAccount();
      return;
    }
    setPaying(true);
    setPayMsg(null);
    try {
      const result = await api.purchaseVip(level);
      setPayMsg({ ok: true, text: result.message });
      await reloadAll();
    } catch (e) {
      setPayMsg({ ok: false, text: errorText(e) });
    } finally {
      setPaying(false);
    }
  }

  /** 兑换 CDK；成功后本地更新余额即可，不需要整表重拉 */
  async function redeemCdk() {
    const code = cdkCode.trim();
    if (!code || redeeming) return;
    setRedeeming(true);
    setCdkMsg(null);
    try {
      const result = await api.redeemCdk(code);
      setCdkCode("");
      setCdkMsg({
        ok: true,
        text: `兑换成功，获得 ${result.gained} 钻石，当前共 ${result.coins} 钻石`,
      });
      setShop((prev) => (prev ? { ...prev, coins: result.coins } : prev));
    } catch (e) {
      setCdkMsg({ ok: false, text: errorText(e) });
    } finally {
      setRedeeming(false);
    }
  }

  if (!open) return null;

  const coins = shop?.coins ?? vip?.coins ?? account?.coins ?? 0;
  /** 当前 VIP 档位的图标（后端给定）；普通用户为 null */
  const currentVipIcon = shopIcon(
    vip?.plans.find((plan) => plan.level === vip.currentLevel)?.iconUrl,
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onClick={onClose}>
      <div
        className="flex h-[32rem] w-[38rem] flex-col border border-ljx-border bg-ljx-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题 + 钻石 + 当前档位 */}
        <div className="flex items-center gap-3 border-b border-ljx-border bg-ljx-bg2 px-4 py-2.5">
          <span className="text-[15px] font-bold text-ljx-text">商城</span>
          <span className="flex items-center gap-1 bg-ljx-deep px-2 py-[2px] text-[12px] text-ljx-gold">
            <img src={coinIcon} alt="" className="h-3.5 w-3.5" draggable={false} />
            {coins}
          </span>
          {vip && (
            <span className="flex items-center gap-1 bg-ljx-deep px-2 py-[2px] text-[12px] text-ljx-gold">
              {/* 档位图标由后端给；普通用户没有图标，此时不显示（不拿 VIP 图标凑数） */}
              {currentVipIcon && (
                <img src={currentVipIcon} alt="" className="h-4 w-4" draggable={false} />
              )}
              {vip.currentName}
            </span>
          )}
          <button
            className="ml-auto px-1 text-[16px] leading-none text-ljx-text3 hover:text-ljx-text"
            title="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* 页签：道具商城 | VIP 档位 */}
        <div className="flex gap-5 border-b border-ljx-border bg-ljx-bg px-4">
          {(
            [
              { id: "shop", label: "道具商城" },
              { id: "vip", label: "VIP 档位" },
            ] as Array<{ id: MallTab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-1 py-1.5 text-[13px] transition-colors ${
                tab === t.id
                  ? "border-ljx-accent font-medium text-ljx-accent"
                  : "border-transparent text-ljx-text2 hover:text-ljx-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* CDK 兑换：后台批量生成码，玩家在这里兑成钻石 */}
        {account && (
          <div className="border-t border-ljx-border bg-ljx-bg2 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[12px] text-ljx-text3">兑换码</span>
              <input
                className="min-w-0 flex-1 border border-ljx-border bg-ljx-deep px-2.5 py-1.5 font-mono text-[12px] uppercase text-ljx-text outline-none placeholder:text-ljx-text3 focus:border-ljx-accent"
                placeholder="输入 CDK 兑换码"
                value={cdkCode}
                onChange={(e) => {
                  setCdkCode(e.target.value);
                  setCdkMsg(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void redeemCdk();
                }}
              />
              <button
                className="shrink-0 bg-ljx-accent px-4 py-1.5 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
                disabled={redeeming || !cdkCode.trim()}
                onClick={() => void redeemCdk()}
              >
                {redeeming ? "兑换中…" : "兑换"}
              </button>
            </div>
            {cdkMsg && (
              <p className={`mt-1.5 text-[11px] ${cdkMsg.ok ? "text-ljx-green" : "text-ljx-accent"}`}>
                {cdkMsg.text}
              </p>
            )}
          </div>
        )}

        {payMsg && (
          <p
            className={`border-b border-ljx-border px-4 py-2 text-[12px] ${
              payMsg.ok ? "text-ljx-green" : "text-ljx-accent"
            }`}
          >
            {payMsg.text}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!account ? (
            <div className="grid h-full place-items-center gap-3 text-center">
              <div>
                <p className="text-[13px] text-ljx-text3">登录后可查看钻石余额与商城内容</p>
                <button
                  className="mt-3 bg-ljx-accent px-6 py-2 text-[13px] font-semibold text-white hover:brightness-110"
                  onClick={() => {
                    onClose();
                    onNeedAccount();
                  }}
                >
                  去登录
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="grid h-full place-items-center text-[13px] text-ljx-text3">正在加载商城…</div>
          ) : error ? (
            <div className="grid h-full place-items-center text-[13px] text-ljx-accent">{error}</div>
          ) : tab === "shop" ? (
            <ShopList shop={shop} paying={paying} onBuy={buyItem} />
          ) : (
            <VipList vip={vip} paying={paying} onBuy={buyVip} currentIcon={currentVipIcon} />
          )}
        </div>

        <p className="border-t border-ljx-border bg-ljx-deep px-4 py-1.5 text-[11px] text-ljx-text3">
          钻石可通过 CDK 兑换获取；置顶卡作用于你名下的房间，VIP 会改变房间卡片边框
        </p>
      </div>
    </div>
  );
}

function ShopList({
  shop,
  paying,
  onBuy,
}: {
  shop: ShopPayload | null;
  paying: boolean;
  onBuy: (itemId: number) => void;
}) {
  if (!shop || shop.items.length === 0) {
    return <div className="grid h-full place-items-center text-[13px] text-ljx-text3">商城暂无上架商品</div>;
  }
  return (
    <div className="space-y-2">
      {shop.items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 border border-ljx-border bg-ljx-bg2 px-3 py-2"
        >
          {/* 商品图标由后端发放 */}
          {shopIcon(item.iconUrl) && (
            <img src={shopIcon(item.iconUrl)!} alt="" className="h-9 w-9 shrink-0" draggable={false} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] text-ljx-text">{item.name}</span>
              <span className="shrink-0 border border-ljx-border px-1.5 text-[11px] text-ljx-text3">
                {item.category}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-ljx-text3">{item.description}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[13px] text-ljx-gold">
            <img src={coinIcon} alt="" className="h-3.5 w-3.5" draggable={false} />
            {item.priceCoins}
          </span>
          <button
            className="shrink-0 border border-ljx-accent bg-ljx-accent px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
            disabled={paying}
            onClick={() => onBuy(item.id)}
          >
            购买
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * VIP 档位列表。
 * <p>
 * VIP **不在道具商城里重复出现**（唯一来源是这里的档位表）；买下之后的可见效果
 * 就是房间卡片边框变化，所以每行直接把"边框 + 上传上限"写清楚。
 */
function VipList({
  vip,
  paying,
  onBuy,
}: {
  vip: VipPayload | null;
  paying: boolean;
  onBuy: (level: number) => void;
  currentIcon: string | null;
}) {
  if (!vip || vip.plans.length === 0) {
    return <div className="grid h-full place-items-center text-[13px] text-ljx-text3">暂无 VIP 档位</div>;
  }
  return (
    <div className="space-y-2">
      {vip.plans.map((plan) => {
        const current = plan.level === vip.currentLevel;
        return (
          <div
            key={plan.level}
            className={`flex items-center gap-3 border px-3 py-2 ${
              current ? "border-ljx-accent bg-ljx-deep" : "border-ljx-border bg-ljx-bg2"
            }`}
          >
            {/* 档位图标同样来自后端；普通用户没有图标就不显示 */}
            {shopIcon(plan.iconUrl) && (
              <img src={shopIcon(plan.iconUrl)!} alt="" className="h-9 w-9 shrink-0" draggable={false} />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-ljx-text">{plan.name}</span>
                <span className="text-[11px] text-ljx-text3">LV{plan.level}</span>
                {current && (
                  <span className="border border-ljx-accent px-1.5 text-[11px] text-ljx-accent">当前</span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-ljx-text3">
                房间边框：{plan.borderUrl ? "专属样式" : "默认"} · 上限 {plan.packageMaxMb}MB
                {plan.level > 0 && (
                  <> · 有效期：{plan.durationDays && plan.durationDays > 0 ? `${plan.durationDays} 天` : "永久"}</>
                )}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[13px] text-ljx-gold">
              <img src={coinIcon} alt="" className="h-3.5 w-3.5" draggable={false} />
              {plan.priceCoins}
            </span>
            {plan.level === 0 ? (
              <span className="shrink-0 px-3 py-1 text-[12px] text-ljx-text3">默认</span>
            ) : (
              <button
                className="shrink-0 border border-ljx-accent bg-ljx-accent px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
                disabled={paying}
                onClick={() => onBuy(plan.level)}
              >
                {current ? "续费" : "开通"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
