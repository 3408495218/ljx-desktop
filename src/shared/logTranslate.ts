interface Rule {
  pattern: RegExp;
  zh: string;
}

/**
 * 原版日志行前缀：`[12:34:56] [Server thread/INFO]: `。
 * 翻译前必须先剥掉前缀，否则所有以 `^` 锚定的规则都匹配不到（原始行并不是以消息正文开头的）。
 */
const PREFIX = /^\[(\d{2}:\d{2}:\d{2})\]\s*\[([^\]]+)\]:\s*/;

/** 按出现顺序匹配，越具体的规则越靠前（如「正在启用 X（版本 Y）」先于「正在启用 X」） */
const RULES: Rule[] = [
  // ---------- 启动与生命周期 ----------
  { pattern: /^Done \(([\d.]+)s\)!$/, zh: "服务器启动完成（耗时 $1 秒）" },
  { pattern: /^Starting minecraft server version (.+)$/, zh: "正在启动 Minecraft 服务器，版本 $1" },
  { pattern: /^Loading properties$/, zh: "正在加载配置文件" },
  { pattern: /^Loading libraries, please wait\.\.\.$/, zh: "正在加载依赖库，请稍候…" },
  { pattern: /^Default game type: (\w+)$/, zh: "默认游戏模式：$1" },
  { pattern: /^Generating keypair/, zh: "正在生成服务器密钥对" },
  { pattern: /^Starting Minecraft server on (.+)$/, zh: "服务器监听地址：$1" },
  { pattern: /^Preparing level "([^"]+)"$/, zh: "正在准备世界「$1」" },
  { pattern: /^Preparing start region for dimension (.+)$/, zh: "正在生成出生区域：$1" },
  { pattern: /^Preparing spawn area: (\d+)%$/, zh: "正在生成出生点区域：$1%" },
  { pattern: /^Loaded (\d+) recipes$/, zh: "已加载 $1 条合成配方" },
  { pattern: /^Time ran out or no activities/, zh: "长时间无活动，服务器进入待机" },
  { pattern: /^Saving the game \(this may take a moment!\)$/, zh: "正在保存世界（可能需要一点时间）" },
  { pattern: /^Saved the game$/, zh: "世界已保存" },
  { pattern: /^Saving worlds$/, zh: "正在保存世界" },
  { pattern: /^Saving players$/, zh: "正在保存玩家数据" },
  { pattern: /^Unloading chunks/, zh: "正在卸载区块" },
  { pattern: /^Stopping server$/, zh: "正在停止服务器" },
  { pattern: /^Stopping singleplayer server as player logged out$/, zh: "玩家登出，正在停止服务器" },
  { pattern: /^Closing Server$/, zh: "正在关闭服务器" },
  { pattern: /^This server is running (.+)$/, zh: "服务器核心：$1" },

  // ---------- 插件 ----------
  { pattern: /^Loading (\d+) plugins?$/, zh: "正在加载 $1 个插件" },
  { pattern: /^Enabling (.+) v([\w.\-]+)$/, zh: "正在启用 $1（版本 $2）" },
  { pattern: /^Enabling (.+)$/, zh: "正在启用 $1" },
  { pattern: /^Disabling (.+)$/, zh: "正在禁用 $1" },
  { pattern: /^Error occurred while enabling (.+)/, zh: "启用 $1 时发生错误" },
  { pattern: /^Could not load 'plugins[\\/]([^']+)'/, zh: "无法加载插件文件：$1" },

  // ---------- 玩家进出与操作 ----------
  { pattern: /^(\w+) joined the game$/, zh: "$1 加入了游戏" },
  { pattern: /^(\w+) left the game$/, zh: "$1 离开了游戏" },
  { pattern: /^(\w+) \[\/([^\]]+)\] logged in/, zh: "$1（来自 $2）已登录" },
  { pattern: /^(\w+) lost connection: (.+)$/, zh: "$1 断开连接：$2" },
  { pattern: /^(\w+) issued server command: (.+)$/, zh: "$1 执行了服务器命令：$2" },
  { pattern: /^UUID of player (\w+) is ([\w-]+)$/, zh: "玩家 $1 的 UUID 为 $2" },
  { pattern: /^(\w+) has made the advancement \[(.+)\]$/, zh: "$1 达成了进度【$2】" },
  { pattern: /^(\w+) has reached the goal \[(.+)\]$/, zh: "$1 完成了目标【$2】" },
  { pattern: /^(\w+) has completed the challenge \[(.+)\]$/, zh: "$1 完成了挑战【$2】" },

  // ---------- 死亡信息 ----------
  { pattern: /^(\w+) was slain by (.+)$/, zh: "$1 被 $2 击杀" },
  { pattern: /^(\w+) was killed by (.+)$/, zh: "$1 被 $2 杀死" },
  { pattern: /^(\w+) was shot by (.+)$/, zh: "$1 被 $2 射杀" },
  { pattern: /^(\w+) was blown up by (.+)$/, zh: "$1 被 $2 炸死" },
  { pattern: /^(\w+) was struck by lightning$/, zh: "$1 被闪电击中" },
  { pattern: /^(\w+) drowned$/, zh: "$1 溺水而亡" },
  { pattern: /^(\w+) burned to death$/, zh: "$1 被烧死" },
  { pattern: /^(\w+) went up in flames$/, zh: "$1 在火焰中燃烧" },
  { pattern: /^(\w+) froze to death$/, zh: "$1 冻死了" },
  { pattern: /^(\w+) starved to death$/, zh: "$1 饿死了" },
  { pattern: /^(\w+) suffocated in a wall$/, zh: "$1 在墙里窒息" },
  { pattern: /^(\w+) withered away$/, zh: "$1 凋零而亡" },
  { pattern: /^(\w+) tried to swim in lava$/, zh: "$1 试图在岩浆中游泳" },
  { pattern: /^(\w+) fell from a high place$/, zh: "$1 从高处摔落而亡" },
  { pattern: /^(\w+) fell out of the world$/, zh: "$1 掉出了世界" },
  { pattern: /^(\w+) hit the ground too hard$/, zh: "$1 摔得太重" },
  { pattern: /^(\w+) blew up$/, zh: "$1 爆炸了" },

  // ---------- 告警与错误 ----------
  { pattern: /^Can't keep up! Did the system time change/, zh: "服务器性能不足：Tick 跟不上，出现卡顿" },
  { pattern: /^Failed to save chunk/, zh: "区块保存失败" },
  { pattern: /^Exception in thread "([^"]+)"/, zh: "线程「$1」发生异常" },
  { pattern: /^java\.net\.BindException: Address already in use/, zh: "端口已被占用，无法绑定" },
  { pattern: /^You need to agree to the EULA/, zh: "需先在 eula.txt 中同意 EULA 才能开服" },
  { pattern: /^WARNING: An illegal reflective access operation/, zh: "警告：存在非法的反射访问操作" },
  { pattern: /^RCON running on (.+)$/, zh: "RCON 远程控制已启动：$1" },
];

/** 返回中文译文；无法识别时返回 undefined（调用方保留原文） */
export function translateLine(raw: string): string | undefined {
  const prefix = PREFIX.exec(raw)?.[0] ?? "";
  const body = raw.slice(prefix.length);
  if (body.startsWith("\t") || body.startsWith("  at ")) {
    return undefined; // 堆栈行
  }
  for (const rule of RULES) {
    if (rule.pattern.test(body)) {
      return prefix + body.replace(rule.pattern, rule.zh);
    }
  }
  return undefined;
}