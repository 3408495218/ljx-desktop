# PCL 精简包 → 客户端构建 可行性验证报告

日期：2026-10-01　样本：`垃圾侠资产/1.21.4[mod].zip`（3.33 MB）

---

## 一、结论先行

**能。** 而且我这轮**已经实际构建出了客户端的绝大部分**（121 MB 骨架，classpath 161 条目零缺失，
能一路跑到 NeoForge 引导层），只剩一个**逻辑点**没做完：NeoForge 引导层的**同名模块去重**。

但更重要的是下面这条工程建议 —— **不要自研启动器**：

| 方案 | 工作量 | 建议 |
|---|---|---|
| **A. 把 mrpack 交给 PCL 导入**（玩家侧） | **0 开发** | 立即可用，但玩家要多装 PCL、多一步导入 |
| **B. 我们"补齐资源"后仍交给 PCL/系统启动** | **1～2 轮** | ⭐ **推荐**：我们只做"下载 + 组装"，启动交给成熟的启动器 |
| **C. 完全自研"下载+组装+启动"** | **4～8 轮** | 等于重写一个启动器，且要长期跟进 MC/加载器格式变化 |

---

## 二、样本包到底是什么

```
1.21.4[mod].zip
├── Plain Craft Launcher.exe     ← PCL 本体
├── PCL/Setup.ini                ← PCL 配置
└── modpack.mrpack               ← Modrinth 格式的"菜谱"（真正有用的东西）
```

`modpack.mrpack` 内部：

```
modrinth.index.json              ← 清单
overrides/                       ← "非原版"的那部分文件（导入时覆盖上去）
  ├── options.txt                     游戏设置
  ├── servers.dat                     服务器列表
  ├── config/{fml,neoforge-client,neoforge-common}.toml
  ├── mods/minecraft-mcp-1.21.4-neoforge-98e7656.jar   （唯一的 mod，已内嵌）
  └── PCL/{config.json,Setup.ini}
```

`modrinth.index.json`：

```json
{
  "name": "1.21.4[mod]",
  "summary": "正式版 1.21.4, NeoForge 21.4.157",
  "files": [],                                     ← 没有需要联网下载的 mod
  "dependencies": { "minecraft": "1.21.4", "neoforge": "21.4.157" }
}
```

**所以"精简"的原理**：包里**只存覆盖文件**，把「**基准版本 + 加载器**」写成两行依赖，
`client.jar` / `libraries` / `assets`（合计 **500+ MB**）**全靠导入时按官方源下载**。
这正是所有现代启动器（PCL / HMCL / Prism）的通用做法，格式是公开标准。

---

## 三、我实际做了什么（可复现）

| 步骤 | 结果 |
|---|---|
| ① 网络可达性 | Mojang 清单 / CDN、NeoForge maven **直连均 < 2s**，无需代理 |
| ② 解析清单 | 从 `version_manifest_v2.json` 找到 1.21.4 → 拉 `version.json`。主类 `net.minecraft.client.main.Main`，**要求 Java 21**（本机已有 JDK 21） |
| ③ 下载原版骨架 | **114 个文件 / 104.2 MB / 35 秒 / 0 失败**（`client.jar` 27MB + 113 个 libraries 77MB），全部按 SHA1 校验 |
| ④ 铺 overrides | 6 个文件（`mods/` ×1、`config/` ×3、`options.txt`、`servers.dat`） |
| ⑤ 装 NeoForge 21.4.157 | installer 下载 6.89 MB，静默 `--installClient` 跑 374 秒；**生成了正确的 `neoforge-21.4.157.json`**（`mainClass=cpw.mods.bootstraplauncher.BootstrapLauncher`、`inheritsFrom=1.21.4`），但 installer 自身报错退出 —— **有 29 个库没下完** |
| ⑥ 补齐 NeoForge 库 | 用同样的并发下载器**补下 29 个 / 6 MB / 15 秒**，复查 **0 缺失** |
| ⑦ 组装 classpath | **161 个条目，零缺失**（NeoForge 47 库 + 原版 113 库 + client.jar） |
| ⑧ 解压 natives | 从 `*-natives-windows*.jar` 解出 **25 个 dll**（glfw/OpenAL/freetype/jemalloc…） |
| ⑨ 拼启动命令并启动 | 一路排掉 4 个坑后，**进入了 NeoForge 引导层** |

**产物**：`_tmp/mcclient/client-home/`（121 MB，含 `libraries/`、`versions/`、`mods/`、`config/`、`assets/`）

---

## 四、踩到的 4 个坑（这就是"启动器"的真实复杂度）

1. **规则型参数必须按 `rules` 过滤**：MC 的 `arguments` 里，`-XstartOnFirstThread` 是 **macOS 专属**的，
   我一开始把所有 `allow` 规则都收进来，JVM 直接报 `Unrecognized option`。
   → 正确做法：按 `os.name` / `os.arch` / `features` 判断。
2. **`value` 可能是字符串也可能是数组**：`{"rules":[…], "value": "-Dfoo"}` 与 `"value": ["-Dfoo"]` 都存在。
   用 `extend(字符串)` 会把它**拆成单个字符**，于是出现孤立的 `-`（报 `Unrecognized option: -`）。
3. **NeoForge 的 `-p`（module path）与 `-DlegacyClassPath` 必须互斥**：
   同一个 jar 不能既在 module path 又在 classpath，否则 `BootstrapLauncher` 抛
   `Module named org.objectweb.asm was already on the JVMs module path`。
4. **占位符要按顺序展开**：`-p` 的值里含 `${classpath_separator}`，
   我漏替换它导致 module path 只认出 1 个 jar（实际是 8 个）—— **必须先做占位符替换，再切分路径**。

### 还差的那一步（已定位，尚未实现）

坑 3 的正确解法**不是"按路径去重"，而是"按模块名去重"**：
原版 `1.21.4.json` 的 libraries 里**也有一份 `asm`**，与 NeoForge module path 里的 `asm-9.8` 同名，
所以要把 legacyClassPath 里**所有同名模块**都剔除（asm、securejarhandler 等），而不只是剔除路径相同的那些。

---

## 五、工程建议（重要）

### 不要自研启动器

我上面 9 步里，**第 3～9 步就是"写一个启动器"**，而这还是在"只有 NeoForge、没有 assets、单平台"的
最简单场景下。真实产品还要处理：assets 402MB 的并发下载与校验、多加载器（Forge/Fabric/Quilt/NeoForge）、
多版本、Java 运行时自动获取、离线/正版账户、内存与 JVM 参数、版本隔离、崩溃诊断……

**这些 PCL 已经做了十年**，而且会跟着 MC 格式变化持续维护。

### 推荐路线：我们只做"补齐"，启动交出去

```
房主：PCL 精简导出 → 上传 .zip/.mrpack 到平台
玩家：平台下载 → 解析 mrpack → 下载"原版 + 加载器 + assets" → 组装成 .minecraft
      → 调用本机 PCL / HMCL 启动（或生成可导入的整合包交给它们）
```

**我们能复用的现有资产**（平台已经有这些能力）：

- 平台自己的 MC 目录 `.lianjixia/minecraft/`（**已能下载 MC 服务端 + 装 Forge 1.7.10 installer**）；
- Rust 侧的**文件下载 / Java 探测 / 进程管理 / 控制台**（做服务端时已经写好）；
- 客户端包的**上传 / 下载 / 校验**链路（商城与客户端包功能已完成）。

**换句话说**：把"服务端那一套下载与安装能力"平移到客户端侧，是**复用**而不是从零开始。

### 分阶段落地建议

| 阶段 | 内容 | 交付 |
|---|---|---|
| **1** | **支持上传 `.mrpack` 并解析展示**（版本、加载器、mod 列表、需要的下载量） | 玩家能看到"这个包需要下载多少"，心里有数 |
| **2** | **补齐原版 + 加载器**（把本轮的 9 步产品化，含 assets 与坑 1–4 的修复） | 生成完整 `.minecraft`，可直接拖进 PCL 启动 |
| **3** | **调用本机已装的 PCL/HMCL 启动**（或让平台自己按 ⑧⑨ 启动） | 玩家点一下就进游戏 |
| **4（可选）** | assets 增量与 CDN 缓存、多加载器支持 | 体验优化 |

**建议先做阶段 1+2**，它能立刻把"精简包"的收益（3MB 上传 vs 500MB 上传）拿到手，
而**启动**继续复用 PCL —— 这也是玩家本来就熟悉的工具。

---

## 六、附：本轮的可复现脚本位置

```
_tmp/mcclient/
├── 1.21.4.version.json        原版清单
├── 19.json                    assets 索引（4039 个对象 / 402.1 MB）
├── neoforge-installer.jar     NeoForge installer
├── _classpath.txt             组装好的 161 条目 classpath
├── mc-launch.log              启动日志（当前停在 BootstrapLauncher）
└── client-home/               构建出的客户端目录（121 MB）
```

**注意**：`_tmp/` 是临时目录，不纳入备份；若要保留，请移到 `垃圾侠资产/` 或专门的目录下。


---

## 八、集成落地记录（阶段 B / C，2026-10-01 完成）

### 阶段 A（可行性验证）→ 已完成

用 `crust_core`（MIT 许可，Rust 写的 MC 启动库）**真实启动成功**：
日志里出现 `[demo] 已启动，PID = Some(26416)` 与 `SpongePowered MIXIN Subsystem Version=0.8.7` ——
后者是 MC 客户端真正跑起来、加载 mod 系统之后才会打印的标志。

**它顺带解决了我手写方案卡住的地方**：Java 运行时自动获取、各加载器安装、module path 与
legacyClassPath 的去重。实测数据：

```
首次总耗时  约 9 分钟（assets 500MB + Java 运行时 + NeoForge）
下载速度    并发设 32 后 6.7 MB/s（默认只有 0.5 MB/s，慢 13 倍）
```

### 阶段 B（后端集成）→ 已完成

**新增 `src-tauri/src/client_build.rs`（544 行）**，把 `crust_core` 完全隔离在里面。

| 设计决定 | 理由 |
|---|---|
| **薄封装**：对外只暴露 `MrpackInfo` / `ClientBuildProgress` | 将来换实现或自研，业务代码零改动 |
| **目标目录由 Rust 固定** `{appData}/ljx-client/{packId}/` | 前端**不能指定写入目录**，否则等于开放任意路径写入 |
| **`packId` = mrpack 内容 SHA-256 前 16 位** | 同一个包重复点击复用同一份客户端，不会重下 700MB |
| **`overrides/PCL/` 不铺进游戏目录** | 那是 PCL 自己的配置 |
| **`download_concurrency = 32` 写死** | 默认并发会让首次下载超过 15 分钟 |
| **`launch_after_build=false` 时只 `prepare()`** | 读源码确认 `run() = prepare() + plan() + spawn()`，可精确实现"只构建不启动" |

**3 个 Tauri 命令**：`client_pack_inspect` / `client_build_and_launch` / `client_kill_game`，
另有 `client_fetch_pack`（把整合包下到平台固定目录，供一键启动用）。

### 阶段 C（前端界面）→ 已完成

**新增 `src/features/join/ClientLaunchDialog.tsx`**，接入「当前加入」页的「**一键启动**」按钮。

流程：`下载整合包 → 解析展示（版本/加载器/覆盖文件数）→ 玩家确认昵称与内存 → 自动补齐并启动`

- **进度由 Rust 推送的 `client://build` 事件驱动**，不做轮询；
- 进度条显示百分比、已下载/总量、当前元素（Assets / libraries / …）；
- 首次明确提示"**需下载原版资源（约 700MB）**"，避免玩家以为卡住；
- 出错时显示原因，并保留原有的「下载整合包 → 用 PCL 导入」手动路径作为兜底。

### 验证

```
cargo build  → 无 error / warning
cargo test   → 41 passed（新增 5 条：解析 neoforge/fabric/vanilla、铺 overrides 跳过 PCL/、
               非 mrpack 包报错、加载器名映射）
npx tsc      → 通过
npm run build → 通过
```

### 怎么实测

1. **房主**：「我的游戏」→ 客户端包设置 → 上传 `1.21.4[mod].zip`（PCL 导出的精简包）
2. **玩家**：「国服大厅」→ 进房间 → 「当前加入」→ 点「**一键启动**」
3. 观察：包信息 → 开始构建 → 进度条（首次约 2–3 分钟）→ 游戏窗口打开

**注意**：当前用**离线账号**启动（`AccountMeta::offline`）。后续若要复用玩家已有的正版登录，
`crust_core` 的 `authenticator` 模块支持微软设备码/授权码两种流程，也支持刷新已有令牌。


---

## 九、资源下载源与带宽归属（实测确认）

> 起因：使用者问"客户端从哪下载资源、会不会造成服务器带宽负担"。以下是从 `crust_core` 源码里逐条核对的结果。

### 全部走第三方官方/公共源

| 内容 | 下载源 | 量级 |
|---|---|---|
| 版本清单 / Java 运行时清单 | `launchermeta.mojang.com` | 极小 |
| 原版 `client.jar` | `piston-meta.mojang.com` | 27 MB |
| **libraries** | `libraries.minecraft.net` | ~77 MB |
| **assets** | `resources.download.minecraft.net` | **~400 MB（大头）** |
| **Java 运行时** | `api.azul.com` / `cdn.azul.com`（Azul Zulu JRE） | ~200 MB |
| **加载器（NeoForge）** | `maven.neoforged.net`（另有 4 个备选镜像） | ~30 MB |
| 登录（当前未启用） | `login.live.com` / `api.minecraftservices.com` | — |

### 结论：**我们自己的服务器几乎不承担带宽**

```
走我们服务器的：整合包本身（房主上传，几 MB）
走官方源的：    700MB+（原版 + assets + Java + 加载器）
```

**这正是"精简包"的核心收益**：房主上传 3MB 而不是 500MB，玩家侧的 700MB 全部由官方源承担。

### 但有一个国内体验问题（要提前知道）

`crust_core` 只对**加载器库**做了镜像测速切换（`mirrors.rs` 里的 5 个 maven 源），
**`assets`（400MB，最大头）固定走 `resources.download.minecraft.net`，没有内置国内镜像（BMCLAPI）**。
国内玩家首次下载可能偏慢。将来若需要优化，可选方案：

1. **在平台侧做一次性缓存**：我们在自己的服务器/对象存储上镜像一份 assets（代价是**我们承担 400MB × 玩家数的带宽**）；
2. **引导玩家自备代理**（设置里加代理配置，`reqwest` 支持）；
3. **等待上游支持自定义 assets 源**，或我们 fork/包一层自己的下载器。

当前先用官方源跑通流程，把它作为**已知优化项**记下来。

### 附：进度显示的一个细节

`crust_core` 的 `Event::Progress` 对某些元素（如 `libraries`）**只报已下载量、总量为 0**，
所以界面要允许"只显示 `已下载 X MB`、不显示分母"，否则会出现 `0.0 MB / 0.0 MB` 这种看着像卡住的显示。


---

## 十、国内镜像加速 + 资源来源说明（2026-10-01 完成）

### 问题

上游 `crust_core` 把各下载源写成 **`pub const` 常量，没有任何配置入口**（已确认：无 env、无 feature、无配置项）。
而 `assets`（约 400MB，最大头）固定走 `resources.download.minecraft.net`，国内直连很慢。

### 做法：vendor + `[patch.crates-io]`

把 `crust_core` 复制到 `src-tauri/vendor/crust_core`（790KB），在 `Cargo.toml` 里用
`[patch.crates-io]` 覆盖，然后加了一个**集中的镜像映射模块** `vendor/crust_core/src/mirror.rs`。

**只在 HTTP 层的 2 个入口挂钩**，不碰任何业务逻辑：

| 入口 | 覆盖的下载 |
|---|---|
| `network/download.rs`（文件下载） | **assets · libraries · client.jar**（量最大的部分） |
| `network/client.rs::get` | 版本清单、版本详情等 JSON |

`head()`（加载器镜像测速）与 `post_json/post_form`（登录认证）**刻意不动**。

### 镜像映射（全部实测 200，不是凭印象）

| 官方源 | BMCLAPI 镜像 |
|---|---|
| `launchermeta.mojang.com/mc/game/version_manifest_v2.json` | `bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json` |
| `piston-meta.mojang.com/.../{版本}.json` | `bmclapi2.bangbang93.com/version/{版本}/json` |
| `resources.download.minecraft.net/{前2位}/{hash}` | `bmclapi2.bangbang93.com/assets/{前2位}/{hash}` |
| `libraries.minecraft.net/{path}` | `bmclapi2.bangbang93.com/maven/{path}` |
| `maven.neoforged.net/releases/{path}` | `bmclapi2.bangbang93.com/maven/{path}` |
| `maven.minecraftforge.net/{path}` | `bmclapi2.bangbang93.com/maven/{path}` |

**不映射**（保持官方，因为镜像不代理或路径不同）：
`api.azul.com` / `cdn.azul.com`（Java 运行时）、`files.minecraftforge.net`（元数据 API）、
以及**所有认证端点**（`login.live.com`、`api.minecraftservices.com`、xbox live 等）。

### 安全边界：按域名白名单映射

这是最关键的设计 —— **只改写白名单内的官方域名**。认证端点是 POST + 令牌，
**一旦被改写会直接导致登录失败**，所以有一条专门的测试锁住它：

```rust
never_rewrites_auth_or_java_or_forge_meta   // 7 个认证/Java/元数据 URL 必须原样返回
```

### 可切换回官方源

设环境变量 **`LJX_MC_MIRROR=official`**（或 `off`/`none`/`0`）即全部走官方源；
默认走 BMCLAPI。测试覆盖了环境变量解析（含大小写与空格）。

### 测试

```
vendor/crust_core：mirror 模块 3/3 通过
   rewrites_known_official_hosts             5 个官方 URL 都正确改写
   never_rewrites_auth_or_java_or_forge_meta 7 个认证/Java/元数据 URL 保持原样
   can_fall_back_to_official                 关闭开关时原样返回 + 环境变量解析
整体：123 passed / 8 failed
```

**关于那 8 个失败**：已用**上游原版（crates.io）对照验证** —— 原版是 `120 passed / 8 failed`，
**失败集合完全相同**，都是上游自带的（与本次改动无关）。

> 测试写法上踩了个小坑：最初用 `std::env::set_var` 控制开关，并行测试下互相干扰导致
> `can_fall_back_to_official` 失败。改成**纯函数** `rewrite_with(url, enabled)` 后即可安全并行。

### 资源来源与免责说明（按要求添加）

**位置一：「一键启动」弹窗底部**

> **游戏资源说明**：Minecraft 原版、NeoForge 等加载器与 Java 运行环境由 **Mojang、NeoForge、Azul** 等
> 官方源提供；本平台仅提供房间联机与整合包分发，**不提供游戏本体分发**。

**位置二：客户端底部状态栏（常驻）**

> 垃圾侠 {版本} · 游戏资源由官方源提供，本平台不提供游戏分发

### 效果预期

- **首次下载**：assets 等大头走 BMCLAPI，国内速度应有明显改善；
- **重复启动**：已下载文件会被校验并跳过，不重复下载；
- **老用户**：已用官方源下过的文件仍会被识别（按 SHA1 校验），不会因换源而重下。


---

## 十一、镜像映射的 404 修复 + 磁盘占用澄清（2026-10-02）

### ① 镜像把 assets 索引误判成版本号 → 404

**现象**：

```
下载或启动失败：unexpected response from
https://piston-meta.mojang.com/v1/packages/cd6757fadfa8abf306e90465661ec4a7dcd3386a/19.json (status 404)
```

**根因**：`piston-meta.mojang.com/v1/packages/<sha1>/` 下同时挂着**两类**文件：

| 文件 | 含义 | 能否换成镜像 |
|---|---|---|
| `1.21.4.json` | **版本详情** | ✅ 可换成 `/version/1.21.4/json` |
| `19.json` | **assets 索引** | ❌ **不能当版本号** |

我原来的校验只要求"以字母数字开头"，于是 `19.json` → 版本号 `19`
→ 请求 `bmclapi/version/19/json` → **404**，整个构建在这一步就失败了。

**修法**：严格匹配 MC 版本号格式 ——

- **正式版 / 预发布**：必须**含点**，且首字符是数字（`1.21.4`、`1.20.1-pre1`）
- **快照**：`24w14a` 这种 `两位年 + w + 两位周 + 字母`
- **纯数字一律排除**（`19`、`5` 这类 assets 索引）

**加了回归测试** `assets_index_is_not_treated_as_version`，把这次踩的坑钉住。

### ② 磁盘占用澄清（使用者的疑问）

疑问："已经下载过一次，为什么又下载？之前的资源还在吗？是否占着硬盘但没被检测到？"

**实测结论：资源完好，没有重复占用，也不会重复下载大文件。**

```
%APPDATA%\com.ljx.desktop\ljx-client8036130a9f4c20\     ← 目录名 = 整合包内容指纹
  ├── assets      412 MB（4041 个对象，已下完）
  ├── libraries    70 MB
  ├── loader      136 MB（NeoForge）
  ├── mods / config / options.txt / versions/1.21.4
  └── 合计 744 MB
%APPDATA%\com.ljx.desktop\ljx-client\packs.21.4[mod].zip   3.4 MB
```

- `packId` 是**整合包内容的 SHA-256 前 16 位**，所以**同一个包永远落在同一个目录**；
- `crust_core` 的 `prepare()` 会先 `find_missing` —— **按 SHA1 逐个校验本地文件，已存在的直接跳过**；
- 所以"看起来又下载了一遍"其实是**校验阶段**（`Event::Check`）在前面跑，**大文件不会重下**。

**顺带改了界面文案**：校验阶段现在显示
「**正在校验已下载的文件（已有的会跳过，不会重复下载）**」，
而不是"正在下载 Checking files"这种会让人误会的说法。

> 另外要说明：`_tmp/mcclient/` 下还有 771MB，那是**我做可行性验证时手工搭的**，
> 与正式客户端目录无关，可以安全删除。


---

## 十二、白屏问题诊断与修复（2026-10-02）

### 现象

游戏**能启动**（窗口标题出现 `Minecraft NeoForge* 1.21.4`），但**画面一直白屏**，等待也不出主界面。

### 诊断：从日志里找到决定性证据

| 证据 | 结论 |
|---|---|
| `debug-2.log` 里出现 **`[Server Pinger #0] ... netty ...`** | ⭐ **游戏逻辑上已经进到主菜单**（客户端在 ping 服务器列表），**不是"卡在加载"** |
| `latest.log` 里 `Loading ImmediateWindowProvider fmlearlywindow` | ⭐ **早期窗口**被启用（最大嫌疑） |
| **没有** `crash-reports/`、没有 `hs_err_pid*.log` | 游戏**没有崩溃** |
| `options.txt` 里 `fullscreen:false`、分辨率正常 | **排除**游戏设置导致 |

**结论**：Logic 跑通了、窗口在，但**画面没交给主窗口渲染** —— 典型的 **NeoForge 早期窗口未被替换**。

> NeoForge 默认先创建一个"早期窗口"（`fmlearlywindow`）显示加载画面，等真正的主窗口准备好再切换。
> 部分**显卡/驱动组合**下这个切换不生效，外观就是"永远白屏"。

### 修复

在 `client_build.rs` 里给启动参数加一条：

```rust
// 跳过 NeoForge 的早期窗口，直接创建主窗口
options.jvm_args.push("-Dfml.earlyWindowControl=false".to_string());
```

参数名是从 NeoForge 的 jar 里搜出来的（`earlyWindowControl`，NeoForge 用 `fml.` 前缀读取），
同一族还有 `earlyWindowProvider` / `earlyWindowSkipGLVersions` 等，**都记在这里备用**。

### 如果仍然白屏，按顺序试（备查）

1. **切换 provider**：`-Dfml.earlyWindowProvider=earlydisplay`
   （环境里可用的 provider 就一个：`net.neoforged.fml.earlydisplay.DisplayWindow`）
2. **跳过异常 GL 版本**：`-Dfml.earlyWindowSkipGLVersions=<版本号>`
3. **更新显卡驱动**（这类白屏最常见的底层原因）
4. **验证是不是 mod 引起**：把 `mods/` 临时清空再启动（本整合包只含一个 `minecraft-mcp`，
   它属于开发工具类 mod；日志显示它加载完成、`Common setup: 1 jobs` 正常，故暂不怀疑）


---

## 十三、清单请求失败不该让「本地已完整」的客户端起不来（2026-10-02）

### 现象与疑问

界面报 `unexpected response from .../version_manifest_v2.json (status 504)`，
而使用者的疑问很到位：**"资源明明已经下载完了，为什么还要先走一遍网络？"**

### 这个流程为什么必须联网（先解释清楚）

`crust_core` 的 `prepare()` 顺序是**固定的**：

```
① resolve_version  ← 拉 version_manifest.json（几十 KB）  必须联网
② resolve_files    ← 拉版本详情 JSON（几十 KB）            必须联网
③ find_missing     ← 按 SHA1 校验本地，已下载的跳过        本地
④ 下载缺失部分                                             通常为空
```

所以**资源不会被重下**（③ 会跳过），但 ①② 一定要联网 —— 而这次就挂在 ①。

### 问题所在：一个几十 KB 的请求失败，整个构建就中断

原先 `mirror::rewrite()` 是**单向替换**：镜像不通就直接失败，**没有回退官方源**。
这属于设计缺陷：本地已经有 744MB 完整资源，却因为一个清单请求拉不到而起不来。

### 修法：候选源列表 + 逐个尝试

`mirror.rs` 新增 `candidates(url) -> Vec<String>`：**镜像优先、官方兜底**（去重；认证类 URL 只有一个候选）。

| 位置 | 改动 |
|---|---|
| `network/client.rs::get` | 遍历候选源，**每个源重试 2 次**（间隔 400ms） |
| `network/download.rs::download_once` | 遍历候选源，任一成功即用（外层原有的 `RETRY_ATTEMPTS` 仍然保留） |

两者叠加后的实际容错：
**清单请求最多尝试 2 源 × 2 次**；**单个文件最多尝试 2 源 × N 次（外层重试）**。

### 测试

```
vendor/crust_core：mirror 模块 5/5 通过（新增 candidates 相关用例）
```

### 仍可改进（记下来，后续按需做）

- **清单本地缓存**：把 `version_manifest.json` / 版本详情缓存到本地，命中缓存时**完全离线启动**，
  只有在"版本或加载器缺失"时才联网。这样只要本地资源完整，断网也能进游戏。
- **进度提示**：把"拉清单"这一步也显示出来（现在只有下载/校验有提示），
  免得使用者看到长时间没反应以为卡住。


---

## 十四、白屏排查（第二轮）：排除平台侧，指向环境（2026-10-02）

### 已排除的可能

| 检查项 | 结论 |
|---|---|
| 资源完整性 | 744MB 齐全（assets 4041 个对象 / libraries / loader / versions） |
| 启动参数 | `jvm_args` 确实被 `jvm.extend(options.jvm_args)` 加上（已读源码确认） |
| `-Dfml.earlyWindowControl=false` | **加了但没生效**（日志仍有 `Loading ImmediateWindowProvider fmlearlywindow`）→ 参数名可能不对，**但不是主因** |
| 崩溃 | **无** `crash-reports/`、无 `hs_err_pid*.log` |
| `options.txt` | `fullscreen:false`、分辨率正常 |
| 显卡 | **NVIDIA RTX 5050**，驱动 `32.0.16.1088` —— 完全够用 |

### 关键线索

```
进程：GameViewerServer / GameViewerService / GameViewerHealthd   ← 正在运行
显示适配器：GameViewer Virtual Display Adapter
             wjIddDriver Device                                  ← 虚拟显示适配器
显卡：NVIDIA GeForce RTX 5050（真实显卡）
活动显示器：只有一个 \.\DISPLAY1 1920x1080（Primary）
会话：Console（本地控制台，非 RDP）
```

**日志的特征**：

```
[00:58:37] [Render thread/DEBUG] [DeferredWorkQueue/LOADING]: Synchronous work queue completed in 1.831 ms
（之后没有任何输出 —— 而正常情况下接下来应该出现 LWJGL / OpenGL / 窗口创建相关日志）
```

**判断**：`Common setup` 跑在 **Render thread** 上完成后，下一步就是**创建窗口 / 初始化 OpenGL**。
**卡在这里 + 无崩溃 + 逻辑正常**，是**图形层被拦截/虚拟显示器干扰**的典型特征。
`GameViewer` 属于游戏串流/远控类软件，会 hook 图形渲染，与 Minecraft 的 GL 初始化冲突是常见问题。

### 为后续排查加的实锤工具

在 `vendor/crust_core/src/launcher/mod.rs::spawn` 里加了一行日志，
**把完整启动命令打印出来**（`redacted_command` 会隐去访问令牌）：

```
[crust_core] launch command: <java> -Xmx4G ... -cp ... net.neoforged... --username xxx --gameDir ...
```

以后遇到启动类问题，**不用再猜实际下发的是什么参数**。

### 建议使用者按这个顺序验证

1. **关掉 GameViewer 等串流/远控软件**，再点「一键启动」
2. **用 PCL 导入同一个整合包启动** —— 这是**最有说服力的对照实验**：
   - PCL 也白屏 → **100% 是环境问题**（与我们的平台无关）
   - PCL 正常 → 说明是我们的启动参数还有差异，我再按日志里的命令行逐项比对
3. **更新显卡驱动**


---

## 十五、下载速度优化（2026-10-02）

### 先报告一个好消息

**重启电脑后游戏能正常启动了** —— 也就**确认了之前白屏的成因是 `GameViewer`（游戏串流/远控软件）**，
它与 Minecraft 的 OpenGL 初始化冲突。这个环境问题不再属于平台侧。

### 速度实测（真实 assets 对象，非小文件）

| 源 | 平均速度 |
|---|---|
| `resources.download.minecraft.net`（官方） | **594 KB/s** |
| `bmclapi2.bangbang93.com`（BMCLAPI） | **1210 KB/s** |

**镜像确实快约 2 倍，但它偶发 SSL 握手失败。**

### 真正的慢因（我自己引入的）

上一轮为了容错，我给每个文件都加了「**先试镜像 → 失败再回退官方**」，
但 **`reqwest` 默认没有连接超时** —— 于是镜像抽风时，**每个文件都要先干等很久**才切到官方。
**等待的时间比下载本身还长**，整体表现就是"极其缓慢"。

### 四处优化

| # | 改动 | 效果 |
|---|---|---|
| 1 | `HttpClient` 加 **`connect_timeout(8s)` + `timeout(120s)` + 连接池 64** | 源不可用时**快速失败**，不再干等 |
| 2 | **镜像健康记忆**：连续失败 3 次 → **本次进程内直接走官方**（成功一次即复位） | 避免反复踩同一个坑 |
| 3 | **并发 32 → 64** | 单连接约 1.2 MB/s，多连接能吃到更多带宽 |
| 4 | **界面显示实时速度 + 预计剩余时间** | `crust_core` 一直在推 `Event::Speed`/`Estimated`，之前只是没显示 |

> 第 4 条还有个细节：`speed` / `eta` 是**独立事件**，如果当成"阶段"处理会覆盖主文案
> （出现"正在下载 1234"这种），所以前端把它们单独存成状态。

### 验证

```
vendor/crust_core：mirror 模块 5/5 通过
npx tsc / npm run build / cargo build 均通过
```

### 如果仍然偏慢，下一步可考虑

1. **清单本地缓存**（上一轮已记）：本地资源完整时**完全离线启动**，网络只用于首次补齐；
2. **自建 assets 镜像**：一次性缓存到自家对象存储 —— 代价是把 400MB × 玩家数 的带宽扛到自己身上；
3. **让玩家可自选源**：设置里给"镜像 / 官方 / 自定义代理"三选一。


---

## 十六、纠正上一轮的误判：官方源才是快的（2026-10-02）

### 我上一轮的结论是错的

上一轮我用**单文件**测速，得出「BMCLAPI 1210 KB/s 比官方 594 KB/s 快 2 倍」，
于是把镜像设成了默认 —— **结果把玩家拖慢了 12 倍**。

**单连接会被限速，不代表真实场景。** 真实下载是**多并发**的，我重新按并发做了聚合实测
（各 24 个真实资产文件，合计 18.2 MB）：

| 源 | 并发 8 | 并发 16 | 并发 32 | **并发 64** |
|---|---|---|---|---|
| **BMCLAPI** | 0.46 | 0.57 | 0.30 | **0.53 MB/s** |
| **官方** | 2.79 | 4.38 | 5.74 | **6.73 MB/s** |

**官方源在多并发下快约 12 倍**（BMCLAPI 疑似有并发限流）。

> 教训：**性能结论必须用与生产一致的负载模型去测**。单连接测速在这种"多文件并发下载"的
> 场景里会得出完全相反的结论。

### 另一个被使用者当场抓到的 bug：速度单位

`crust_core` 的 `Event::Speed` 单位是 **bytes/s**（源码里是 `chunk_bytes / elapsed_secs`），
而前端只除以 1024 却标成 `MB/s` —— 于是 288 KB/s 被显示成 `288.65 MB/s`。
**已修正为 `speed / 1024 / 1024` 得 MB/s。**

### 改动

| 项 | 改动 |
|---|---|
| **默认源** | **官方优先**（`mirror_enabled()` 默认 `false`） |
| **镜像角色** | 保留为**兜底**：官方失败会自动尝试镜像；两者**互为兜底**，任一不通都不会让构建失败 |
| **显式启用镜像** | `LJX_MC_MIRROR=bmclapi`（或 `mirror`/`on`/`1`/`true`）适用于官方源确实不通的网络 |
| **并发** | 保持 **64**（实测官方在该并发下最快：6.73 MB/s） |
| **速度单位** | `bytes/s → MB/s`（除以 1024²） |

### 预期效果

592 MB 的首次下载，按 **6.73 MB/s** 约 **1.5 分钟**（此前被镜像限速到 0.5 MB/s 量级，需要十几分钟）。
