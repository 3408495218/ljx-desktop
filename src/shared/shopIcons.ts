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
