import type { RoomCardData } from "@/shared/types";
import grassBlock from "@/assets/icons/grass-block.png";
import { shopIcon } from "@/shared/shopIcons";

export function RoomCard({
  room,
  onOpen,
  onRemoveFootprint,
}: {
  room: RoomCardData;
  onOpen: (id: number) => void;
  /** 足迹视图下传入；不传则卡片不出现移除入口 */
  onRemoveFootprint?: (id: number) => void;
}) {
  // VIP 档位的房间边框（资源键 → 打包在桌面端的图）；置顶卡显示左上角角标
  const borderSrc = shopIcon(room.border);
  const topCardIcon = shopIcon("top-card");

  return (
    <div className="group relative">
      {topCardIcon && room.topCard && (
        <img
          src={topCardIcon}
          alt=""
          title="该房间已购买置顶卡，排在前面"
          className="pointer-events-none absolute left-0 top-0 z-30 h-7 w-7"
          draggable={false}
        />
      )}
      <button
        className={`w-full overflow-hidden border-2 text-left transition-[filter] hover:brightness-110 ${
          borderSrc ? "border-transparent" : "border-ljx-cardborder"
        }`}
        onClick={() => onOpen(room.id)}
        title={`${room.name}（${room.core}-${room.mcVersion} · ${room.mode}）`}
      >
        <div className="relative aspect-square w-full">
          <img
            src={room.cover || grassBlock}
            alt=""
            className={`h-full w-full object-cover ${room.online ? "" : "opacity-40 grayscale"}`}
            draggable={false}
          />
          {/* 人数放右下角：左上角留给了置顶卡角标，原先两者都在 left-1 top-1 会互相压住 */}
          <span className="absolute bottom-1 right-1 z-30 rounded-sm bg-black/70 px-1.5 py-[1px] text-[11px] font-bold text-ljx-green shadow-sm">
            {room.players}/{room.capacity}
          </span>
          {/* 底部渐变：**纯装饰**，单独一层 z-10（它只服务于名字的可读性） */}
          <div className="absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-black/75 to-transparent" />
          {/* 房间名：信息层。必须与渐变拆成两层 —— 若名字作为渐变的子元素，
              父级的 z-10 会把子级一起压到 VIP 边框之下（pr-14 留出右侧人数徽章的位置） */}
          <div className="absolute inset-x-0 bottom-0 z-30 pl-1.5 pr-14 pb-1">
            <span className="block truncate text-[12px] text-white">{room.name}</span>
          </div>
          {!room.online && (
            <span className="absolute bottom-7 right-1 z-30 rounded-sm bg-black/70 px-1.5 py-[1px] text-[10px] text-ljx-text2">
              离线
            </span>
          )}
        </div>
      </button>

      {/* 房间边框：VIP 档位的样式图，属于**装饰**。
          层级约定（装饰一律低于信息，否则会压住人数/名字/图标）：
            封面 z-0 → 底部渐变横幅 z-10 → VIP 边框 z-20 → 信息 z-30 → 足迹移除按钮 z-40
          放在按钮同级是因为按钮有 overflow-hidden，会把它裁掉；且不拦截点击。 */}
      {borderSrc && (
        <img
          src={borderSrc}
          alt=""
          className="pointer-events-none absolute inset-0 z-20 h-full w-full"
          draggable={false}
        />
      )}

      {onRemoveFootprint && (
        <button
          className="absolute bottom-1 right-1 z-40 hidden h-5 w-5 place-items-center bg-black/70 text-[13px] leading-none text-ljx-text2 hover:bg-ljx-accent hover:text-white group-hover:grid"
          title="从足迹中移除"
          onClick={() => onRemoveFootprint(room.id)}
        >
          ×
        </button>
      )}
    </div>
  );
}