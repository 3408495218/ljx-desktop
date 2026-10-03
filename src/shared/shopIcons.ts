import borderDiamond from "@/assets/shop/border-diamond.png";
import borderGold from "@/assets/shop/border-gold.png";
import borderIron from "@/assets/shop/border-iron.png";
import topCard from "@/assets/shop/top-card.png";
import vipDiamond from "@/assets/shop/vip-diamond.png";
import vipGold from "@/assets/shop/vip-gold.png";
import vipIron from "@/assets/shop/vip-iron.png";

/**
 * 商城资源映射表。
 *
 * 后端只给**资源键**（如 `vip-iron`），真正的图片**打包在桌面端**里（`src/assets/shop/`）。
 * 这样做的原因：桌面端如果直接拿后端的 `/shop/xxx.png` 当 src，相对路径会被解析成
 * `tauri://localhost/shop/xxx.png` —— 不是后端地址，图片必然裂。
 *
 * 新增商品/档位时：把图放进 `src/assets/shop/`，在这里加一行映射，
 * 后端只写对应的键即可（两边用同一个键名）。
 */
const SHOP_ICONS: Record<string, string> = {
  "top-card": topCard,
  "vip-iron": vipIron,
  "vip-gold": vipGold,
  "vip-diamond": vipDiamond,
  "border-iron": borderIron,
  "border-gold": borderGold,
  "border-diamond": borderDiamond,
};

/** 按键取图片地址；键为空或未登记时返回 null（调用方据此不渲染，而不是显示裂图） */
export function shopIcon(key: string | null | undefined): string | null {
  if (!key) return null;
  return SHOP_ICONS[key] ?? null;
}

/**
 * VIP 档位 → 徽章资源键。
 *
 * 档位与图标由后端固定对应（`V15__asset_keys.sql` 写入 vip_plan.icon_url）：
 *   1 铁块 / 2 金块 / 3 钻石。
 * 顶栏徽章在**启动时就要渲染**（不能等商城接口回来），所以这里按档位直接查表，
 * 与 MallDialog 用 `plan.iconUrl` 渲染的是同一批图。
 */
const VIP_BADGE_KEYS: Record<number, string> = {
  1: "vip-iron",
  2: "vip-gold",
  3: "vip-diamond",
};

/**
 * 按 VIP 档位取徽章图。
 * <p>普通用户（0 / null）或未登记的档位返回 null，调用方据此不渲染图标而不是显示裂图。
 */
export function vipBadgeIcon(level: number | null | undefined): string | null {
  if (!level) return null;
  return shopIcon(VIP_BADGE_KEYS[level]);
}
