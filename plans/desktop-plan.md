# 垃圾侠重建 · 桌面端技术方案

版本 v1.0（2026-09-30） · 对齐目标：原版 2.0.10 行为复刻
前置文档：《垃圾侠桌面端功能拆解报告》（lianjixia-feature-report），模块编号引用该报告的控件证据

## 1 目标与范围

重建一个行为对齐原版 2.0.10 的垃圾侠桌面客户端。验收口径取自功能拆解报告 8.2 节的 22 项清单，全部落地即视为完成。

托管模型采用**本地服务端 + 平台登记**：服务端进程运行在房主本机，由 Rust 负责拉起与守护；客户端每 30 秒向平台后端上报心跳完成登记，大厅据此展示房间在线状态。原版「机房托管」的宣传话术不在本期范围。

非目标：

- 不复刻 0.1.0 / 0.2.4 历史版本的界面形态
- 不做登录器皮肤；客户端整合包**不由本软件打包**，只提供「房主上传 zip → 玩家下载后交给 PCL 导入」的通道（大小按等级上限，封顶 30 MB）
- 商业化只做 UI 与接口对接，不做支付闭环

## 2 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 壳 | Tauri 2 + Rust | 安装包 < 15 MB，自带更新器与 NSIS 打包，内存占用远低于 Electron |
| UI | React 18 + TypeScript | 沿用现有 0.1.0 代码；卡片网格、筛选、控制台均为 web 擅长形态 |
| 状态 | zustand | 账号、大厅、控制台、服务端进程各建独立 store |
| 日志列表 | react-virtuoso | 控制台 800 条环形缓冲的虚拟渲染 |
| 样式 | 沿用现有方案，无则 Tailwind 4 | 视觉对齐原版截图，像素级复刻非必须 |
| 网络 | fetch 封装 | 统一 token 注入、401 跳登录、心跳定时器 |

Rust 侧只承担四类职责，写完即稳定：

1. 进程编排：spawn/kill Java 服务端、stdout/stderr 管道、优雅停止
2. 文件操作：server.properties 注释保留读写、插件 jar 复制删除、快照打包
3. 环境探测：Java 版本、最大可用内存、端口占用、.minecraft 目录定位
4. 平台网络：心跳上报、下载任务（Java 运行时、插件包）

## 3 架构

### 3.1 前端目录

```
src/
  app/              路由与全局布局（页签：国服大厅 / 创建游戏 ⇄ 我的游戏 / 当前加入）
  stores/           account / lobby / console / serverProc / preferences
  features/
    lobby/          房间卡片、三视图切换、筛选栏、搜索、分页（18 卡/页）
    create/         创建说明页、创建表单、配额上限展示
    room-manage/    六页签：brief / console / settings / plugin / mod / snapshot
    join/           当前加入、玩家准备状态、启动游戏
    account/        登录、注册、邮箱绑定弹窗
    commerce/       等级 / VIP / 商城（展示为主）
  shared/           API 客户端、日志翻译规则表、常量
```

### 3.2 Rust 命令与事件

| Command | 作用 |
|---|---|
| `server_start(config)` | 按核心选择 Java 路径与 `-Xmx`，spawn 进程 |
| `server_stop()` | 优雅停止：stdin 发送 `stop`，30 秒超时后 kill |
| `server_status()` | 返回状态机当前态 |
| `console_send(cmd)` | 向 stdin 写命令 |
| `props_read` / `props_write` | server.properties 读写（保留注释） |
| `snapshot_create` / `snapshot_restore` / `snapshot_list` | 世界目录 zip 打包与恢复 |
| `mods_list` / `mods_import` / `mods_delete` / `mods_set_enabled` | 本地 `plugins/`、`mods/` 目录的扫描、导入、删除、启停（停用 = 重命名 `.disabled`） |
| `pick_files` / `pick_folder` | 系统文件 / 目录选择（导入 jar、选压缩包下载目录） |
| `download_client_package` / `open_folder` | 下载房主上传的客户端 zip 到指定目录，并在资源管理器中打开该目录 |
| `probe_java()` / `probe_mc()` / `probe_port()` | 环境探测 |

| Event | 载荷 | 消费方 |
|---|---|---|
| `console://line` | `{ts, raw, level}` | console store，环形缓冲入队 |
| `server://state` | `{state, detail}` | serverProc store，刷新启停按钮与状态标签 |
| `download://progress` | `{task, percent}` | 下载进度弹层 |

### 3.3 本地数据

| 数据 | 存放 | 说明 |
|---|---|---|
| token | tauri-plugin-store | 「记住密码」只存 token，不存明文密码 |
| 收藏 / 足迹缓存 | 同上 | 服务端为准，断网时大厅显示上次数据 |
| 界面偏好 | 同上 | 声音开关、日志翻译开关、窗口尺寸 |

## 4 模块拆解

### M1 账号

| 功能点 | 对齐证据 | 验收要点 |
|---|---|---|
| 登录 / 记住密码 | `btnLogin`、`checkBoxPwd` | token 持久化，启动自动续期 |
| 注册（三字段） | 截图「快速注册」 | 用户名 + 密码 + 重复密码，密码 ≥ 6 位 |
| 登录错误弹窗 | 截图「账号不存在」 | 标题「未能完成登录」+ 原因，样式对齐原版 |
| 邮箱绑定门槛 | 截图「绑定手机号」（重建改邮箱） | 未绑定点击创建时弹提示，「点此绑定」跳绑定流程；验证通道为邮箱（后端 B0 已按邮箱实现，短信成本过高） |
| 顶栏账号区 | 截图 LV0 标签 | 用户名、LV 标签、商城入口、登出菜单 |

### M2 大厅

| 功能点 | 对齐证据 | 验收要点 |
|---|---|---|
| 房间卡片 | 截图「1/10」+「VIP 1」 | 人数标签、VIP 角标、封面、房间名四要素 |
| 三视图 | `icon_all` / `icon_favorite` / `icon_history` | 全部 / 收藏 / 足迹切换，行为与原版一致 |
| 筛选 | `comboBoxVersion` / `comboBoxMod` | 「所有版本」「所有玩法」双下拉，选项为「核心-版本」格式 |
| 搜索 | `editCaption` + 回车 | 按房间名关键词匹配 |
| 分页 | `widgetBrief_0~17` | 18 卡/页 + 页码 + 上下页按钮 |
| 加入失败弹窗 | 截图「房间不存在」 | 与登录错误共用弹窗规范 |

### M3 创建游戏

| 功能点 | 对齐证据 | 验收要点 |
|---|---|---|
| 创建说明页 | 截图四条规则 | 24 小时在线说明改为本地模型表述，帮助链接指向自建文档 |
| 七字段表单 | 截图「创建游戏」 | 名称、版本（核心-版本）、简介、点亮加群、上锁、禁止游客、容量 |
| 动态容量上限 | 截图「当前最大: 10」 | **已改口径**：容量由服主自行设置，**不与 VIP 等级挂钩**，服务端不设上限（`PLAYER_CAP` 为「不限」，前端展示为「不限」）；前端不做越界拦截 |

### M4 我的游戏（六页签）

| 页签 | 功能点 | 验收要点 |
|---|---|---|
| 基本信息 | 封面修改、简介编辑、插件/模组计数、收藏数、玩家面板、启动游戏按钮 | `btnModifyGame` / `btnModifyImage` 对齐 |
| 控制台 | 日志流、命令输入、启停按钮、状态标签、翻译开关 | 800 条环形缓冲；命令历史上下键 |
| 服务端设置 | server.properties 可视化、编辑插件配置、清空地图、全部重置、客户端压缩包上传 | 属性映射见拆解报告表 7；压缩包上传受 `CLIENT_PKG_MB` 限制 |
| 插件 | **本地文件管理**：扫描 `plugins/`、导入 jar、删除、启用 / 停用，改动后清单同步平台；可**对玩家隐藏**明细 | 数据来源是房主本机目录，平台不做分发；停用 = 重命名 `.disabled`；隐藏只影响玩家侧，房主列表始终完整 |
| Mod | **本地文件管理**：扫描 `mods/`、导入、删除、启用 / 停用，改动后清单同步平台；可**对玩家隐藏**明细 | 与插件同构，共用 `LibraryTab`，可见性开关与插件页签各自独立 |
| 快照 | 创建、恢复、删除（本地文件 + 平台元数据） | 恢复前二次确认 |

### M5 玩家侧

| 功能点 | 对齐证据 | 验收要点 |
|---|---|---|
| 当前加入页 | 0.2.4 截图 | 服务器详情（核心、版本、插件/Mod 清单镜像）+ 玩家列表；房主关闭可见性时该段只显示「房主已隐藏清单」一行，文件名与条数都不下发 |
| 准备状态 | 「已准备 / 正在加入 / 等待」三态 | 本地状态即可，后期接 WS 同步 |
| 启动游戏 | 0.2.4 截图按钮 | 登记加入拿地址 → 若房主上传了客户端压缩包则**弹目录选择框 → 下载 → 打开目录**（玩家自行用 PCL 导入）→ 复制地址并打开启动器；无压缩包时直接进入游戏 |

### M6 社交与商业化 UI

| 功能点 | 验收要点 |
|---|---|
| QQ 群点亮 | 三步引导（输入群号 → 打开一键加群页 → 粘贴代码），配置存房间 |
| 房间简介页加群入口 | 配置存在时展示 |
| 官方群入口 | 标题栏与设置页，写死群号可配置 |
| 等级 / VIP / 商城 | 展示后端数据，购买按钮置灰或提示「敬请期待」 |

## 5 关键技术设计

### 5.1 服务端进程编排

```
idle ──start()──> starting ──就绪信号──> running
                     │                     │
                     │ 120s 未就绪          │ 意外退出
                     ▼                     ▼
                   failed <────────────── failed（弹事件提示）
running ──stop()──> stopping ──30s 内退出──> idle
                       └──超时 kill──> idle
```

就绪信号：日志正文出现 `Done`（**必须先剥掉 `[时间] [线程/级别]: ` 前缀**，见 8 节 P5 修订（三）），上限 120 秒。原计划里的「端口 connect 成功」兜底尚未实现——重负载整合包（1.7.10 Forge）冷启动可能超过 120 秒而被误判 failed，属已知待补项。

Java 版本与核心匹配是首要坑点——1.7.10 系核心（Forge / KCauldron，原版用户主力）必须 Java 8：

| 服务端核心 | Java 运行时 |
|---|---|
| Forge / KCauldron 1.7.10 | Temurin 8（默认档） |
| Spigot / Paper 1.8–1.16 | Java 8 / 11 |
| 1.17+ 现代核心 | Java 17 / 21 |

`probe_java()` 返回全部已装 Java 及版本，配置里维护「核心 → Java 路径」映射；首次启动无 Java 8 时引导下载 Temurin 8。

### 5.2 控制台日志流与翻译

Rust 按行读取 stdout，打时间戳与级别后发 `console://line`；前端环形缓冲 800 条，virtuoso 渲染，自动滚动到「用户未上滚」位置。

翻译在前端做规则表，开关持久化：

```ts
// shared/logTranslate.ts
{ pattern: /Done \(([\d.]+)s\)!/, zh: '服务器启动完成（耗时 $1 秒）' },
{ pattern: /(\w+) joined the game/, zh: '$1 加入了游戏' },
```

MVP 覆盖 30 条高频规则（启动、进出服、报错栈首行），结构上对齐原版翻译文件的分类（Bukkit / Forge / 插件 / 玩家日志），后续按需补表。

### 5.3 启动游戏

各版本启动器参数差异大，直拉脆弱，分两档：

- P2（地址复制档）：加入成功页展示 `host:port`，一键复制 + 按钮打开系统默认 MC 启动器
- P4（直拉档）：`launcher.rs` 检测 `.minecraft/launcher_profiles.json`，拼接 `--server --port` 参数直拉；检测失败自动回退地址复制档

**P3 修订（客户端压缩包不由本软件打包）**：本软件只做「下载器」。玩家点「启动游戏」的完整链路是

1. `POST /api/rooms/{id}/join` 登记加入，拿房主公网地址
2. 读 `GET /api/rooms/{id}/client-package`；房主未上传则跳过第 3 步
3. `pick_folder` 弹系统目录选择框（记住上次目录作为默认值）→ `download_client_package` 走 PowerShell 下载到该目录 → `open_folder` 在资源管理器中打开，提示「请在 PCL 中导入」
4. 复制地址到剪贴板 + 打开系统 MC 启动器

房主侧：在「服务端设置」页上传 zip（`POST /api/rooms/{id}/client-package`，multipart），前端先按 `CLIENT_PKG_MB` 本地校验体积再提交，后端二次校验；玩家下载走 `GET /api/rooms/{id}/client-package/file`（登录即可读）。

### 5.4 危险操作防护

清空地图、全部重置、快照恢复同入「危险区」分组，与常规设置视觉隔离；执行前弹「输入房间名确认」对话框；清空地图与全部重置执行前自动创建一次快照（`pre-destroy-{date}`），失败则中止。

### 5.5 打包与自动更新

tauri-plugin-updater + 签名清单；NSIS 目标，安装包控制在 15 MB 内；更新策略静默检查、提示安装。

## 6 里程碑

单人开发预估，含联调；后端阶段号见《后端技术方案》。进度明细见 §8。

| 阶段 | 范围 | 后端依赖 | 预估 | 状态 |
|---|---|---|---|---|
| P0 本地闭环 | 骨架与路由、大厅演示数据、创建表单、六页签骨架、控制台本地日志流、进程编排与 Java 检测 | 无（mock） | 2 周 | **已完成（2026-09-30）** |
| P1 平台接入 | 登录注册记住密码、真实大厅（筛选搜索）、创建 + 心跳登记、我的游戏真实数据 | B0 + B1 | 1.5 周 | **已完成（2026-09-30）** |
| P2 玩家闭环 | 当前加入、准备状态、启动游戏（地址复制档）、server.properties 编辑、危险区防护 | B1 | 1.5 周 | **已完成（2026-09-30）** |
| P3 内容与快照 | 插件 / Mod **本地文件管理**、客户端压缩包上传与下载（PCL 导入）、快照、日志翻译 | B2 | 2 周 | **已完成（2026-09-30）** |
| P4 完整体验 | 收藏足迹、分页补全、声音开关、QQ 群、商城 UI、启动游戏直拉、更新器与安装包 | B3 + B4（均已完成） | 2 周 | **已完成（2026-09-30，更新器/安装包不做）** |

合计约 9 周。P0 结束即得到一个「不联网也能开服玩」的可演示版本，后续每阶段都可独立交付演示。

## 7 风险与对策

| 风险 | 对策 |
|---|---|
| 用户机器无 Java 或版本错配 | 首启动探测 + 引导下载 Temurin 8；核心-Java 映射表集中维护 |
| properties 整文件重写丢注释 | Rust 端逐行键值替换，不使用整文件序列化 |
| 1.7.10 核心停止后端口未释放 | stopping 完成后延迟探测端口，占用则提示并等待 |
| 直拉启动器各版本差异 | P2 先做地址复制档兜底，直拉失败自动回退 |
| Rust 学习曲线 | Rust 限定四类职责，业务逻辑全部留在前端 |

## 8 进度记录

### P0 本地闭环（已完成，2026-09-30）

代码位置：`lajixia-desktop/`。运行方式：`npm run tauri dev`（进入目录后执行）。

已交付：

- 骨架：Tauri 2 + React 18 + TypeScript + Tailwind CSS 4 + zustand + react-virtuoso；目录按 §3.1 落地（features / stores / shared，路由暂在 `App.tsx` 内联页签切换，未拆 app/ 目录）
- 应用外壳：无边框自定义标题栏（房子 logo、商城按钮、账号区、窗口控制）+ 橙色下划线页签（国服大厅 / 创建游戏 ⇄ 我的游戏 / 当前加入）+ 底部状态栏（版本号 + 「问题反馈，请加官方QQ群」）
- 设置弹窗（2026-09-30 补充）：标题栏「商城」与账号区之间的齿轮按钮 → 云服务器地址配置。默认 `127.0.0.1`，`tauri-plugin-store` 持久化（`preferences.json`），支持 IP / 域名 / host:port / 完整 URL（解析规则见 `src/shared/serverConfig.ts`，无端口自动补 8080）；弹窗内含「测试连接」（GET `{base}/api/me`，收到任意 HTTP 响应即可达，4 秒超时）。**P1 的 API 客户端必须通过 `currentApiBaseUrl()` 取基地址，不得硬编码**
- 大厅（M2 骨架）：三视图切换（全部/收藏/足迹，用原版图标）、版本与玩法双下拉、搜索、刷新、声音开关、上下页分页、18 卡/页房间网格（草方块封面、草绿人数标签、VIP 角标、房间名）；数据为 `shared/mock/lobby.ts` 演示数据
- 创建游戏（M3 骨架）：说明页四条规则 + 七字段表单（含容量上限展示）
- 我的游戏（M4 骨架）：六页签（brief / console / settings / library / snapshot / mod）全部有骨架，控制台为可用形态（virtuoso 虚拟滚动 + 环形缓冲 + 日志翻译开关）
- 当前加入页（M5 骨架）：已按原版 0.2.4 截图重排——全宽三段式（4:3 封面 + 名称 / 基本信息文字流 / 玩家列表），橙色下划线标题，玩家状态绿（正在游戏）/ 灰（其余），底部半透明启动条
- Rust 命令已实现：`server_start` / `server_stop` / `server_status` / `console_send` / `probe_java` / `probe_port` / `probe_mc` / `props_read` / `props_write` / `snapshot_list`
- 进程编排状态机（§5.1）落地于 `src-tauri/src/server/`；本地开服流程已用 Paper 1.21.1 服务端实测跑通（启动、日志流、停止）
- 视觉：全局 `ljx` 色板（深暖棕基底 #4a3f35/#5c4f44/#3d342c/#2a221c + 珊瑚橙 #e8664a + 草绿 #4a9b4a + 金 VIP #e8c44a + 金棕卡片描边 #c4a574）；28 项图标图片取自原版拆包（本地素材目录 `ljx-assets/`，**不在本仓库内**，图片已复制进 `src/assets/icons/`），语义化命名后放 `src/assets/icons/`

与计划的偏差：

- `snapshot_restore` 未实现（创建 / 列出 / 删除已在 P2 落地），恢复推迟到 P3 内容与快照阶段
- 插件 / Mod 页签为浏览骨架，安装卸载待 P3（后端 B2 接口已就绪）
- 启动游戏仍为占位（`console.info`），P2 接地址复制档

### P1 平台接入（已完成，2026-09-30）

已交付（全部走真实后端，mock 数据已移除）：

- `shared/api.ts`：统一 HTTP 客户端——`{code,message,data}` 响应解包、Bearer 注入、1104/1103 触发 `POST /api/auth/refresh` 自动续期并重放原请求、`ApiError`/`errorText` 统一错误文案；令牌经 `tauri-plugin-store`（`session.json`）持久化，非 Tauri 环境回退 localStorage
- 账号（M1）：`stores/account.ts` 接注册 / 登录 / 登出 / 会话恢复；「记住密码」勾选决定是否落盘，未勾选时启动即丢弃历史令牌；`AccountDialog` 支持登录、注册（两次密码校验）、邮箱绑定（发送验证码 + 校验）、登出
- 大厅（M2）：`stores/lobby.ts` 接 `GET /api/rooms`，三视图（全部 / 收藏 / 足迹）、核心 / 版本 / 玩法三筛选、关键词搜索、分页（18 卡/页）；未登录与加载失败均有空态
- 创建游戏（M3）：`CreatePage` 接 `POST /api/rooms`；未登录 → 引导登录，未绑邮箱 → 引导绑定（后端错误码 1306 双保险）。（2026-09-30 修订：容量改由房主自设，原先「容量上限取自 `GET /api/me` 的 `PLAYER_CAP`」的越界拦截已作废，P3 一并移除；`PLAYER_CAP` 生效值为「不限」）
- 我的游戏（M4）：新增后端 `GET /api/rooms/mine`；登录后自动拉取名下房间，有房间时一级页签由「创建游戏」变为「我的游戏」并进入六页签管理页（`RoomManagePage` 接 `roomId`）
- 当前加入（M5）：`JoinPage` 接 `GET /api/rooms/{id}` + `POST /api/rooms/{id}/join`，展示房主公网地址
- 心跳：`shared/useRoomHeartbeat.ts` 在本地服务端 running/starting 期间每 30s 上报一次，离线判定由后端超时兜底
- 设置弹窗：云服务器地址持久化，更换地址时清空会话与房间列表，避免跨服串号

验证（2026-09-30）：

- 前端 `npx tsc --noEmit` 通过
- 后端 `mvn verify`：8 个测试全绿（AuthFlowTest 2 + RoomFlowTest 6，含新增 `myRoomsListsOwnedOnly`）
- 双端联调：以 H2 内存库起真实服务端，跑通「注册 → /api/me → /api/rooms/mine 空 → 未绑邮箱创建被拒 1306 → 发码绑邮箱 → 建房间 → /api/rooms/mine 返回 → 登记公网地址 → 心跳上线 → 大厅可见（online/人数/核心/玩法）→ 加入下发地址」

已知限制：

- 一级页签为「单房间」模型（对齐原版）：名下有房间时不再显示创建入口，多房间仅取最新一间；后续若开放多房间需在管理页加房间切换
- 房间收藏接口在 B3，`view=favorite` 当前恒为空

下一步（P2 玩家闭环）：准备状态三态、启动游戏地址复制档 + 打开系统 MC 启动器、`server.properties` 可视化编辑、危险区（清空地图 / 全部重置）防护。

### P2 玩家闭环（已完成，2026-09-30）

验证（2026-09-30）：

- 前端 `npx tsc --noEmit` 通过、`npm run build` 通过
- Rust `cargo test --lib`：7 条用例全绿（快照打包/列出的完整回路、非法名拒绝、空目录报错、清空地图保留配置、全部重置清配置、空路径/不存在目录拒绝、拒绝根目录）
- 后端沿用 B1 契约（`POST /api/rooms/{id}/join`、`PUT /api/rooms/{id}`），无需新增接口

已交付：

- Rust 新增 7 条命令（`resolve_server_dir` / `snapshot_list` / `snapshot_create` / `snapshot_delete` / `world_clear` / `world_reset` / `open_mc_launcher`）
  - `server::resolve_work_dir()`：生效工作目录单点收敛（`work_dir` 优先，否则取 jar 所在目录），`spawn_server` 与快照 / 配置编辑 / 危险区共用，避免各处各算一套路径
  - `snapshot.rs`：快照落在 `<工作目录>/ljx-snapshots/<名称>.zip`，打包「地图存档 + 关键配置」（world / world_nether / world_the_end / server.properties / ops / whitelist / banned 名单），**不含插件 jar**（可由平台内容库重装，快照体积可控）；快照名白名单校验（字母数字与 `-_.`），杜绝路径穿越；打包失败会清理半成品，防止危险操作误判「快照成功」
  - `world.rs`：`clear_world` 只删三个世界目录；`reset_all` 额外删 server.properties、ops/whitelist/banned 名单与 logs、crash-reports；空路径、不存在目录、盘符根目录一律拒绝
  - 打包与删除走 `spawn_blocking`，大世界打包不阻塞 UI
- 打包实现用系统 `Compress-Archive`（不引入 Rust 依赖）；已知限制：单文件 >2 GB 受 .NET ZipArchive 限制，P3 若需要再换流式 zip writer
- 前端 `stores/preferences.ts`：新增 `serverConfig` 持久化（此前服务端配置只存内存，重启后无法定位房间目录）；`stores/serverProc.ts` 暴露 `hydrate()`，`App.tsx` 启动时恢复
- 前端 `shared/useRoomServerDir.ts`：由控制台配置解析房间工作目录，未配置时给出「请先在控制台配置」引导
- 服务端设置页（M4 settings）：真实读写 `server.properties`（走 `props_read`/`props_write`，逐行替换、保留注释与未受管键）；受管项为玩家容量、出生点保护、视距、难度 + 7 个布尔开关；键缺失时按**原版默认值**回填（如 `allow-flight=false`、`enable-command-block=false`），避免保存时静默改变服务端行为；老版本 `difficulty=0..3` 数字自动映射为名称
- 危险区（M4 settings）：执行前强制创建 `pre-destroy-{date}` 保护快照，**快照失败即中止**，绝不带着未备份数据继续删；需输入房间名精确匹配才放行；服务端运行中直接拒绝；页面显式列出「清空地图 / 全部重置」各删什么
- 快照页（M4 snapshot）：本地快照列表 / 创建 / 删除（新建优先）；「恢复」明确置灰标注 P3 提供
- 当前加入页（M5）：准备状态三态「等待 → 正在加入 → 已准备」，玩家列表实时反映自己的准备态；启动游戏 = 登记加入拿房主地址 → 复制到剪贴板 → 打开系统默认 MC 启动器（`minecraft://`）；另有独立「复制地址」按钮
- 基本信息页（M4 brief）：底部启动按钮按服务端进程状态分流——未运行则先拉起本机服务端并跳到控制台（配置缺失时给出明确引导），运行中则复制 `127.0.0.1:{port}` 并打开启动器；「修改信息 / 修改封面」改为真实 `PUT /api/rooms/{id}`（名称、简介、封面地址）

关键实现决定（后续 agent 注意）：

1. 房间工作目录**不在后端**，而是由客户端服务端配置推导：`work_dir` 为空时取 jar 所在目录。单房间模型下这是唯一真相来源，不要在前端另存一份
2. 快照是**本地文件**，平台侧只登记「名称 + 体积」元数据，**按名称与本地文件对齐**：P3 已补齐后端 `DELETE /api/rooms/{roomId}/snapshots/{name}`，登记（POST）与删除（DELETE）均为按名称幂等，本地增删后重连不会留下孤儿记录或重复行。改快照命名规则时必须同步考虑这条对齐关系
3. 危险操作的前置快照是硬门槛：`snapshotCreate` 抛错必须直接 return，不能降级为「继续执行」。快照恢复沿用同一原则（见 P3）
4. `open_mc_launcher` 走 `cmd /C start "" minecraft://`，依赖系统已注册该协议；地址复制才是可靠交付物，启动器打不开时文案已提示手动粘贴

与计划的偏差：

- 快照恢复、平台元数据登记从 P2 推到 P3（原因见上）
- 「启动游戏」按房主/玩家两种视角分流：房主看本机服务端状态决定是先开服还是直接复制本机地址；玩家走 join 拿房主公网地址，不做直拉（直拉仍在 P4）
- 危险区新增「服务端运行中禁止执行」的硬拦截（原计划只说二次确认），比原计划更保守

下一步（P3 内容与快照）：插件 / Mod 库浏览安装卸载与配额展示（后端 B2 接口已就绪）、快照恢复与平台元数据打通、日志翻译补全。

### P3 内容与快照（已完成，2026-09-30）

验证（2026-09-30）：

- 后端 `mvn verify`：**17 个测试全绿**（AuthFlowTest + RoomFlowTest + LibraryFlowTest + SocialFlowTest，新增 `snapshotUpsertByNameAndIdempotentDelete`）；`openapi.json` 已由 `springdoc-openapi-maven-plugin` 自动重导出（含新增的 `DELETE /api/rooms/{roomId}/snapshots/{name}`）
- Rust `cargo test`：**9 条用例全绿**（新增 `restore_brings_back_snapshot_state`、`restore_rejects_missing_snapshot_and_unsafe_name`）
- 前端 `npx tsc --noEmit` 通过、`npm run build` 通过

已交付：

- 后端（B2 收口）：`DELETE /api/rooms/{roomId}/snapshots/{name}`（仅房主，按名称幂等，返回余下列表）；`POST` 改为**按名称 upsert**——同名只保留一条并刷新体积，本地重建快照后重连不会堆出重复行
- Rust `snapshot_restore(work_dir, name)` + `snapshot_restore` 命令：**两段式恢复**——先 `Expand-Archive` 解压到 `<工作目录>/.ljx-restore-staging`，全部成功后才逐条替换正式内容，解压失败时工作目录保持原样，不会出现「地图已删、快照又没铺回去」的半成品状态；只替换快照中确实存在的条目，快照外的数据不动；恢复完成后清理暂存目录
- 前端 `shared/api.ts`：新增 `ContentType` / `LibraryVersionPayload` / `LibraryItemPayload` / `RoomContentPayload` / `SnapshotPayload` 类型与 `library` / `roomContent` / `installContent` / `uninstallContent` / `snapshotListMeta` / `snapshotCreateMeta` / `snapshotDeleteMeta` 七个方法
- 插件 / Mod 页（M4 library）：已装列表（卸载）+ 官方库浏览（名称搜索、版本下拉、安装）；「仅显示适配本房间版本」按房间 `mcVersion` 过滤（不按 core 过滤——Paper 房间的客户端 Mod 核心是 Fabric，按 core 过滤会把它们全部筛掉）；关键词 300ms 防抖；Mod 页签额外提供「全部 / 客户端 Mod / 服务端 Mod」归属切换
- 客户端包上限打通（M4 library）：顶部条展示 `CLIENT_PKG_MB` 生效值（等级决定，封顶 30 MB）与「已装客户端 Mod 合计体积」，超出时标红提示「打包客户端将失败」；插件 / Mod 数量显式标注「当前不限制」
- 快照页（M4 snapshot）：新增**恢复**（需输入房间名精确匹配；服务端运行中禁止；执行前强制创建 `pre-restore-{时间戳}` 保护快照，快照失败即中止恢复）+ 平台元数据打通（每行显示「已登记 / 未登记」、创建与删除同步平台、新增「同步登记」双向对齐：本地有平台无 → 补登记，平台有本地无 → 清登记）
- 基本信息页（M4 brief）：`模组(N)` 由写死的 0 改为读 `GET /api/rooms/{roomId}/plugins` 的真实数量
- 日志翻译（`shared/logTranslate.ts`）：**修复此前完全失效的匹配**——原版日志行带 `[时间] [线程/INFO]: ` 前缀，而规则全部以 `^` 锚定，实际一条也匹配不上；现先剥离前缀再匹配、译文保留前缀，并补全至 **60 条**规则（启动与生命周期、插件加载、玩家进出与命令、进度与挑战、14 种死亡信息、告警与错误），堆栈行不翻译

关键实现决定（后续 agent 注意）：

1. 快照恢复**不能先删后解压**：当前地图一旦删除、解压又失败，玩家数据就没了。必须走「暂存目录 → 整体替换」，且保护快照创建失败要直接 return
2. `translateLine` 的入参是**带前缀的完整原始行**，规则一律匹配剥离前缀后的正文；新增规则不要写 `^\[` 前缀匹配
3. 内容库的「适配本房间版本」只按 `mcVersion` 过滤：插件核心（Paper）与客户端 Mod 核心（Fabric）不是同一套取值，按 core 过滤会误伤
4. 插件 / Mod 数量配额当前**不启用**（`QuotaType.PLUGIN` 等为 `unlimited()`），但 `QuotaService.checkCount` 仍会取行锁，用来把「并发安装同一版本」串行化，使唯一键冲突退化为幂等返回——不要因为「不限制」就把这段锁去掉

与计划的偏差：

- 原计划 P3 只做「快照恢复」，实际一并把平台元数据双向对齐（`同步登记`）做了，否则本地删除后平台侧仍会残留记录
- 日志翻译的规则数由「补全至 30 条以上」提高至 60 条，且顺带修掉了「规则写了但一条都不生效」的既有缺陷
- 客户端包上限的展示口径定为「已装客户端 Mod 合计体积」，而非单纯展示一个上限数字——上限不结合用量看不出意义

下一步（P4 完整体验）：收藏 / 足迹页签接入（B3 接口已就绪）、大厅分页补全、声音开关、QQ 群号设置、商城 UI、启动游戏直拉、更新器与安装包。

### P3 修订：插件 / Mod 改为本地文件模式 + 客户端压缩包（2026-09-30）

**需求变更**：插件与 Mod 以**本地游戏服务端内的 `plugins/`、`mods/` 目录为唯一事实来源**，本软件只负责管理本地文件并把清单展示给进房玩家；客户端压缩包由房主自行整理后上传，玩家下载后交给 **PCL** 导入，**本软件不参与客户端打包**。

验证（2026-09-30）：

- 后端 `mvn verify`：**13 个测试全绿**（AuthFlowTest 2 + RoomFlowTest 7 + SocialFlowTest 4；`LibraryFlowTest` 随内容库一并删除）
- Rust `cargo test`：**19 条用例全绿**（新增 `mods` 7 条、`client_pkg` 3 条）
- 前端 `npx tsc --noEmit` 通过、`npm run build` 通过
- `openapi.json` 已重导出：新增 `/api/rooms/{roomId}/contents`（GET/PUT）与 `/api/rooms/{roomId}/client-package`（GET/POST/DELETE）及 `/file` 下载端点

已交付：

- 后端数据模型重构（`V3__room_content_and_client_package.sql`）：**删除内容库三表**（`plugin` / `plugin_version` / `room_plugin`）与全部相关类，新增
  - `room_content(room_id, name, type, size_bytes, enabled, reported_at)`：本地文件清单的**平台镜像**，主键 `(room_id, name)`
  - `client_package(room_id, file_name, size_bytes, uploaded_at)`：客户端压缩包元数据，一房间一条
- 后端接口：
  - `GET /api/rooms/{roomId}/contents`：登录即可读，供玩家查看
  - `PUT /api/rooms/{roomId}/contents`：仅房主，**整表替换**（先删后写）——本地是唯一真相，不做增量合并，本地删掉的文件平台侧同步消失
  - `GET /api/rooms/{roomId}/client-package`：元数据，未上传时 `data` 为 `null`
  - `POST /api/rooms/{roomId}/client-package`（multipart，仅房主）：先按 `CLIENT_PKG_MB` 校验体积，仅接受 `.zip`，文件名做 `sanitizeFileName` 过滤（剥路径分隔符，防路径穿越）
  - `DELETE /api/rooms/{roomId}/client-package`（仅房主）与 `GET .../client-package/file`（登录可下载）
  - `QuotaType` 移除 `PLUGIN` / `CLIENT_MOD` / `SERVER_MOD`，只保留与等级联动的两条线（`AuthFlowTest` 配额断言由 5 条改为 2 条）
  - `RoomDetailDto` 去掉 `pluginCount`（计数改由清单镜像给出）
- Rust 新增 `mods.rs`（7 条单测）：`list_contents` / `import_contents` / `delete_content` / `set_content_enabled`
  - 只把 **jar** 计入清单（`plugins/` 下的配置子目录不混进来）；停用 = 重命名 `X.jar` ↔ `X.jar.disabled`，不改文件内容
  - 导入先整体校验（存在性、是否 jar、是否同名）再落盘，避免拷到一半留下半套文件；删除幂等
  - 所有操作限定在工作目录内：拒绝空路径、盘符根目录、含 `/` `\` `..` 的文件名
- Rust 新增 `client_pkg.rs`（3 条单测）：`download` 走 PowerShell（令牌与目标路径经环境变量传入，不进命令行），落盘后校验非空；`open_folder` 用资源管理器打开；文件名剥离路径后只取最后一段
- Rust 新增命令：`mods_list` / `mods_import` / `mods_delete` / `mods_set_enabled` / `pick_files` / `pick_folder` / `download_client_package` / `open_folder`；接入 `tauri-plugin-dialog` 做文件与目录选择
- 前端 `shared/api.ts`：移除 `library` / `roomContent` / `installContent` / `uninstallContent` 与相关类型，新增 `roomContents` / `reportRoomContents` / `clientPackageMeta` / `uploadClientPackage` / `deleteClientPackage`
- 插件 / Mod 页（M4，`LibraryTab` 重写）：**本地文件管理界面**——展示工作目录路径、扫描 / 导入 / 删除 / 启用停用；每次改动后自动把清单整表同步到平台并显示同步时间；服务端运行中给出「可能因文件占用失败，重启后生效」提示
- 服务端设置页（M4）：新增「客户端压缩包」区——显示等级上限与已传文件（名称 / 体积 / 删除）、选择 zip 上传（前端先按 `CLIENT_PKG_MB` 校验再提交）
- 当前加入页（M5）：展示**完整插件 / Mod 清单**（停用项加删除线）与压缩包元数据；「启动游戏」改为「选下载文件夹 → 下载 → 打开目录（提示用 PCL 导入）→ 复制地址 → 打开启动器」，无压缩包时跳过下载直接进入游戏
- 基本信息页（M4）：插件 / 模组计数改读清单镜像，不再依赖已删除的 `detail.pluginCount`

关键实现决定（后续 agent 注意）：

1. **本地目录是唯一事实来源**，平台侧 `room_content` 只是展示镜像。上报是**整表替换**：不要为了「少删几行」改成增量合并，否则本地删掉的文件会在平台侧变成幽灵记录
2. 上报只在房主侧触发（`detail.mine` 为真），非房主只读；后端 `PUT` 会二次校验归属
3. `CLIENT_PKG_MB` 是**客户端压缩包**的上限，与插件 / Mod 数量无关；插件 / Mod 数量配额已随内容库一并移除
4. 客户端压缩包**只落盘不打包**：本软件不做整合包，下载完成后打开目录让玩家自己交给 PCL
5. `mods_*` 系列一律限定工作目录内：新增命令时必须复用 `require_work_dir` 与 `sanitize_file_name`，否则会给出「删掉整个磁盘」的口子

与计划的偏差：

- 原 P3 的「官方插件库浏览 / 安装 / 卸载」整套设计作废（连后端内容库表一起删除），改为本地文件管理；`LibraryFlowTest` 随之移除
- 客户端包上限的展示口径由「已装客户端 Mod 合计体积」改为「上传文件体积 vs 等级上限」——不再有平台侧安装行为，按用量累计已无意义
- 「启动游戏」不再只复制地址：房主上传了压缩包时会先弹目录选择框下载（需求明确要求）

### P4 完整体验（已完成，2026-09-30）

**范围取舍**：本轮只做**收藏 / 足迹、商城 UI + 等级/VIP 展示、QQ 群点亮引导**三项；**自动更新与安装包不做**——它需要更新服务器地址与签名密钥，且项目后续会在 GitHub 开源，届时直接分发 Release 即可，不做自更新链路。

验证（2026-09-30）：

- 后端 `mvn verify`：**18 个测试全绿**（AuthFlowTest 2 + CommerceFlowTest 4 + RateLimitFlowTest 1 + RoomFlowTest 7 + SocialFlowTest 4）
- Rust `cargo test`：**19 条用例全绿**
- 前端 `npx tsc --noEmit` 通过、`npm run build` 通过
- `openapi.json` 已重导出：新增 `/api/rooms/{id}/qq-group`（POST），`RoomDetailDto` 增加 `qqGroupIdKey`

已交付：

- 后端 QQ 群加群凭据（`V6__room_qq_group_idkey.sql`）：`room` 表新增 `qq_group_id_key VARCHAR(128)`。列名必须与 Spring 的 CamelCaseToUnderscores 策略一致（`qqGroupIdKey` → `qq_group_id_key`），写成 `qq_group_idkey` 会导致 ORM 映射失败、所有房间接口 500
  - `Room#setQqGroup(code, idKey)` 整体覆盖两个字段，传 null 即取消点亮；`qqGroupCode` 语义收窄为「群号（展示用）」
  - `QqGroupRequest.idKey` 加 `@Pattern("[A-Za-z0-9_-]{1,128}")`，避免把任意文本拼进加群链接
- 前端 `shared/api.ts`：新增 `favorite` / `unfavorite` / `removeFootprint` / `clearFootprints` / `shop` / `vip` / `setQqGroup`，以及 `FavoriteStatePayload` / `ShopPayload` / `VipPayload` 等类型
- 前端 `shared/qqGroup.ts`：`qqGroupJoinUrl(idKey)` 拼腾讯 WPA 一键加群链接；`extractIdKey(pasted)` 同时接受「完整 HTML 组件代码」与「裸 idkey」两种粘贴内容
- 收藏（当前加入页 `JoinPage`）：星形按钮，已收藏用实心图标；操作幂等，成功后刷新详情并 `useLobbyStore.refresh()`，避免收藏页签停留在旧数据
- 足迹清理（大厅 `LobbyPage` + `RoomCard`）：足迹视图下工具栏提供「清空全部足迹」（二次确认），卡片悬停出现单条移除按钮。清理走独立的 `footBusy` / `footHint` 状态，不复用列表加载态，避免清空时整页闪「正在加载」
- 商城弹窗（`features/mall/MallDialog.tsx`）：两个页签「道具商城 / VIP 档位」，头部显示金币与当前档位；未登录时给「去登录」引导
- 顶栏（`App.tsx`）：商城按钮接入弹窗；账号区在 `LV{n}` 前增加 `VIP{n}` 角标（`account.vip` 非空才显示）
- QQ 群点亮引导（`features/room-manage/QqGroupDialog.tsx`）：三步条（填写群号 → 打开腾讯一键加群页 → 粘贴组件代码并点亮），第三步实时解析 idkey 并预览加群链接；已点亮时可「取消点亮」
- Rust 新增 `open_url` 命令：仅放行 `http(s)://` 且拒绝空白字符与引号，经 `cmd /C start` 以隐藏窗口打开系统默认浏览器

关键实现决定（后续 agent 注意）：

1. **群号 ≠ 加群入口**：纯群号拼不出可用的加群链接，真正生效的是腾讯 WPA 组件的 idkey。`qqGroupCode` 只作展示（按钮 title），**判断是否展示加群入口一律看 `qqGroupIdKey` 是否非空**
2. 商城本期**没有支付闭环**，后端也不提供购买端点。所有购买按钮必须保持 `disabled` 并标注「购买通道暂未开放」，不要做出能点却没反应的按钮
3. `open_url` 是唯一的「把字符串交给系统 shell」的入口，必须保留协议白名单与字符校验；新增外链一律走它，不要在别处直接拼 `cmd`
4. 足迹清理提示与列表加载态分离：`footHint` 只在当前视图内有效，切视图即清空（`useEffect` 依赖 `view`）

与计划的偏差：

- 「启动游戏直拉」未做：P2 已落地的「复制地址 + 打开系统启动器」已能覆盖实际使用，直拉收益有限，优先级让给收藏 / 商城 / QQ 群
- 「更新器与安装包」明确不做，理由见上（开源后走 GitHub Release）

### P5 修订：「我的游戏」基本信息页编辑能力补齐（2026-09-30）

**需求变更**（用户反馈两条）：

1. 「退出房间」按钮不应出现在「我的游戏」页，应放在「当前加入」页用于退出房间
2. 「我的游戏」页缺少：修改游戏版本、游戏属性（生存 / 创造 / 冒险）、登记公网地址、同步插件 / Mod 清单、修改房间容量；且「修改封面」与「修改信息」点开是同一个表单

验证（2026-09-30）：前端 `npx tsc --noEmit` 通过、`npm run build` 通过；后端未改动（`UpdateRoomRequest` 早已支持全部字段）。

已交付：

- 「我的游戏」（`RoomManagePage` → `BriefTab`）：底部条移除左下角返回 / 退出按钮，「启动游戏」改为全宽
- 「当前加入」（`JoinPage`）：底部条新增左侧「退出房间」按钮，回调 `onLeaveRoom` 由 `App.tsx` 注入（`setSelectedRoomId(null)`，回到「请先在大厅选择一个房间」空态）
- `BriefTab` 三个**互斥编辑态**（`EditorMode = "cover" | "info" | "net"`），不再共用同一个表单：
  - 「修改封面」：仅封面图片地址 + 实时预览
  - 「修改信息」：房间名、简介、**游戏版本**（`CORE_VERSION_OPTIONS`）、**游戏属性**（`MODE_OPTIONS`）、**玩家容量**
  - 「公网地址」：公网 IP / 域名 + 端口（`host` / `port`），保存后玩家 `POST /join` 即可拿到该地址
  - 下拉框会把房间当前值补进选项：房间现有版本 / 属性若不在预设列表内，直接绑定 `value` 会让 `<select>` 静默改成第一项
- 新增「同步插件/Mod 清单」按钮：扫描本机 `plugins/` + `mods/` 后**两类一次提交**
- 修复清单镜像被互相清空的缺陷：`PUT /contents` 是整表替换，而 `LibraryTab` 每次只上报自己那一类，导致「扫插件 → Mod 清单被清空」；新增 `shared/roomContentsSync.ts`，`syncRoomContents` 先读平台镜像、把另一类原样带上再提交，`syncAllRoomContents` 供全量同步使用

关键实现决定（后续 agent 注意）：

1. `PUT /api/rooms/{roomId}/contents` 是**整表替换**。任何单类上报都必须先带上另一类（走 `syncRoomContents`），否则会把对方清空——这个坑只在「先看插件页、再看 Mod 页」时暴露，很容易漏测
2. `UpdateRoomRequest` 的字段语义是「**null = 不变**」，且后端 `RoomService.update` 对 name / intro / core / mcVersion / mode / coverUrl 做了 `blankToNull`：传空串等于不改。因此封面与简介**只能替换不能清空**，UI 上要如实说明（写「留空表示保持原样」，不要写「留空恢复默认」）
3. `host` / `port` 走的是 `Room#setPublicAddress`，没有 `blankToNull`，所以传空串确实能清掉公网地址；两个字段各自独立判空
4. 版本 / 属性目前**只是平台侧的展示与筛选标记**（大厅 `mode` 过滤、卡片展示），不会去改房主本机运行的 jar；后续若要联动，得让房主在「控制台」换核心，平台侧字段只是登记

### P5 修订（二）：插件 / Mod 清单对玩家隐藏（2026-09-30）

**需求变更**（用户澄清）：清单开关是**给玩家看的**，不是给房主看的——房主侧列表始终完整，开关只决定「进入房间的玩家」能否看到文件明细。此前 P5 第一版把开关做成了「房主自己隐藏列表」，方向错了，本轮回滚重做。

验证（2026-09-30）：前端 `npx tsc --noEmit` 通过、`npm run build` 通过；后端 `mvn verify` **18 条测试全绿**，`openapi.json` 已重导出（`RoomDetailDto` / `UpdateRoomRequest` 含两个新字段，`GET /contents` 描述更新为「非房主不返回被隐藏那一类」）。

已交付：

- 前端 `shared/api.ts`：`RoomDetailPayload` 新增 `pluginListVisible` / `modListVisible`；`updateRoom` 的入参类型补上同名可选字段
- 插件 / Mod 页（`LibraryTab`）：**移除本地 `listVisible` 状态**（不再有「隐藏列表 / 显示列表」这个房主侧开关），改为从房间详情读 `playerVisible`，新增「对玩家隐藏 / 对玩家显示」按钮
  - 按钮文案随状态反转：当前可见 → 「对玩家隐藏」，当前隐藏 → 「对玩家显示」
  - 提交走 `api.updateRoom(roomId, { pluginListVisible | modListVisible })`，成功后 `reload()` 刷新详情，避免按钮文案停在旧状态
  - 标题栏常驻状态标签「玩家可见 / 玩家不可见」（绿 / 金），房主一眼能看出当前对外状态
  - 插件与 Mod 两个页签各自独立，互不影响；**房主自己看到的列表始终完整**，开关不改动本机任何文件
- 当前加入页（`JoinPage`）：清单渲染改为按 `detail.pluginListVisible !== false` / `modListVisible !== false` 分流
  - 可见：与原先一致，逐行列文件名、体积、启用态（停用加删除线），标题带「插件（N）」
  - 隐藏：只输出一行「插件：房主已隐藏清单」，不渲染任何文件行、也不显示数量——后端已下发明细之外的内容，前端拿不到真实条数
  - 分组过滤条件由「`items.length > 0`」改为「`items.length > 0 || !visible`」：否则隐藏后整段消失，玩家不知道房间到底装没装东西
  - 用 `!== false` 而不是真值判断：老房间数据没有这两个字段时为 `undefined`，必须默认可见

关键实现决定（后续 agent 注意）：

1. **开关语义是「对玩家」而不是「对房主」**：`LibraryTab` 里不要再用本地 state 控制列表显隐，房主侧永远完整展示，唯一受控方是 `JoinPage`
2. 默认值一律按**可见**处理（`!== false`）。这两个字段是 V7 才加的，历史房间在库里为 `NULL`/`0` 之外的情况都要落到「可见」，否则老房间进房玩家会看不到清单
3. **隐藏是接口层裁剪，不是前端藏 DOM**：非房主调 `GET /contents` 拿到的就是裁剪后的结果，前端只需如实渲染。因此「隐藏时显示总数」这个方案不成立——总数得靠新增计数字段才能拿到，当前不做
4. 可见性是**房间级字段**（不是账号级、也不是本地偏好），换设备登录同一房间读到的状态一致
5. 房主侧必须拿全量清单：`syncRoomContents` 上报前会先读平台镜像合并另一类，读到的若是裁剪结果会把清单写坏。后端按 `owner` 分支正是为此

### P5 修订（三）：服务端启停状态修正（2026-09-30）

**现象**：服务端实际已启动（日志出现 `Done`），但控制台状态标签一直停在「启动中」，点「停止服务端」弹出「服务端未在运行」，用户既停不掉也起不来。

**根因**（两个独立缺陷叠加）：

1. **就绪判定没剥日志前缀**（`src-tauri/src/server/process.rs`）：判据写的是 `line.starts_with("Done (")`，而服务端实际输出是 `[18:55:24] [Server thread/INFO]: Done (32.838s)! For help, type "help"`——**一条也匹配不上**，phase 永远停在 `starting`，120 秒后被看门狗改判 `failed`。这与 5.2 节日志翻译踩过的是同一个坑（规则锚定 `^` 前缀导致全部失效）
2. **前端 phase 只靠事件更新、从不与 Rust 校准**：`server://state` 只在 `ConsoleTab` 挂载期间被接收，切页签或从其它页拉起服务端就会漏事件。一旦漂移，按钮就停在错的一侧——UI 显示「启动中/停止服务端」而 Rust 已是 `stopping`/`failed`，再点停止就被 `request_stop` 的 phase 守卫拒掉，报出与事实不符的「服务端未在运行」

**修复**：

- `process.rs`：新增 `strip_log_prefix`，先剥 `[时间] [线程/级别]: ` 再匹配 `Done (`，配 2 条单测（真实日志行 + 无前缀的 `[启动]` 回显行）
- `mod.rs`：`request_stop` 的守卫由 **phase 标签**改为 **进程句柄**（`has_live_child()`）——被判 `failed` 但进程仍在时必须还能停，否则服务端会变成界面上停不掉的孤儿；stdin 不可用时直接 `kill` 兜底
- `process.rs`：`spawn_server` 除 phase 检查外，再加一次 `has_live_child()` 拦截，避免「failed 但进程活着」时再拉一个、把旧 `java.exe` 漏成孤儿并占端口
- `stores/serverProc.ts` 新增 `refresh()`（调 `server_status`）；`ConsoleTab` 挂载时校准一次，`onStart` / `onStop` 返回错误时再校准一次，保证按钮永远跟着 Rust 的真实状态走

**验证**：`cargo test` **22 条全绿**（新增 2 条）、`npx tsc --noEmit` 通过。

关键实现决定（后续 agent 注意）：

1. **凡是用日志正文做判据的地方，都必须先剥前缀**——翻译规则表（`logTranslate.ts`）与就绪判定已经各踩一次，新增同类逻辑时先看这条
2. **启停判断看句柄，不看 phase**：phase 是给人看的标签，会因超时看门狗、漏事件而与事实不符；「能不能停」的正确答案是「进程句柄是否还活着」
3. `app.state::<...>()` 返回的是临时值，**必须先绑定再 `lock()`**，否则借用活不过语句（E0716）。这是本模块第二次踩，改 `spawn_server` 时务必照做
4. 前端状态与 Rust 不一致时，**用 `server_status` 主动校准**，不要只依赖事件；事件在组件卸载期间会丢
5. 仍未实现：就绪判定的「端口 connect」兜底（见 5.1 节）。重负载 1.7.10 Forge 冷启动 >120 秒会被误判 `failed`——此时进程还活着，靠第 2 条可以停掉，但状态显示仍是错的

### P5 修订（四）：房间人数改为真实在线数（2026-09-30）

**现象**：玩家进入服务端后，房间卡片与「当前加入」页的「在线 N/容量」始终是 0。

**根因**：`useRoomHeartbeat` 里人数**写死为 0**（注释还留着「等 P2 接入玩家列表后再上报」，P2 实际没做）。服务端跑在房主本机，平台看不到它，心跳是唯一通道——不上报就永远是 0。另有两个连带问题：心跳挂在「基本信息」页签内，房主一切到控制台就停止上报（会被后端判离线）；即使上报了，也要等下一个 30 秒周期才刷新。

**修复**：

- `src-tauri/src/server/mod.rs`：`ServerManager` 新增在线名单 `players: BTreeSet<String>`，新增纯函数 `parse_player_line` 解析三类日志正文——`X joined the game`、`X left the game`、`X lost connection: …`（超时/崩溃不会打 left the game，漏掉会永久虚高），以及 `/list` 的 `There are N of a max of M players online: A, B` 作为整体校正。玩家名限定 `[A-Za-z0-9_]` 且 ≤16 字符，借以排除聊天内容里的误判
- `process.rs`：`pump_lines` 在 stdout 上顺带喂日志行给名单，**名单一变立刻发 `server://players`**，不必等下一个心跳周期
- `commands.rs` / `lib.rs`：新增 `server_players` 命令返回当前人数
- `shared/useRoomHeartbeat.ts`：人数改为取 `serverPlayers()`；监听 `server://players` 时立即补一次心跳
- `RoomManagePage.tsx`：心跳从 `BriefTab` 上移到页面级——挂在页签里会导致切到控制台就断报

**验证**：`cargo test` **27 条全绿**（新增 5 条覆盖加入/离开、重复登录不重复计数、掉线算离开、`/list` 校正、聊天误判）、`npx tsc --noEmit` 通过。

关键实现决定（后续 agent 注意）：

1. **人数必须由房主端自己数**：平台没有、也不可能有本机服务端的连接数；任何「让后端去数」的方案都不成立
2. 计数用**名字集合**而不是计数器：重复登录（掉线重连）不能加两次，`lost connection` 与 `left the game` 可能同时出现，集合天然幂等
3. `install()`（新进程）与 `poll_exit()`（进程退出）都要清空名单，否则换服/重启后人数会残留
4. **心跳属于「房间在线」这个生命周期，不属于某个页签**：这类定时上报不要挂在页签组件里
5. 「当前加入」页右侧的**玩家名单**已落地（见 P5 修订五）：心跳契约扩展了 `playerNames`，平台存名单并随房间详情下发

### P5 修订（五）：在线名单随心跳上报并展示（2026-09-30）

**现象**：人数已经能涨了（修订四），但「当前加入」页右侧的玩家名单仍是占位——只列本机账号加一句「暂无其他玩家」。

**根因**：人数只上报了 `players` 这一个 int，平台不知道有哪些人。服务端在房主本机，平台没有别的途径拿到名单。

**修复**：

- `src-tauri/src/server/mod.rs`：`ServerManager` 新增 `player_names()`，把 `BTreeSet` 快照成有序 `Vec<String>`
- `commands.rs` / `lib.rs`：新增 `server_player_names` 命令
- `shared/tauri.ts`：新增 `serverPlayerNames()`
- `shared/api.ts`：`RoomDetailPayload` 增加 `playerNames: string[]`；`heartbeat()` 签名扩为 `(id, players, playerNames = [], uptimeSec = 0)`，人数由名单长度得出
- `shared/useRoomHeartbeat.ts`：改为取 `serverPlayerNames()`，人数与名单一次心跳一起报
- `shared/useRoomDetail.ts`：新增可选 `pollMs` 参数，**静默轮询**（失败不清空已有详情）；`JoinPage` 用 15 秒轮询，让在线人数与名单跟上房主心跳
- `JoinPage.tsx`：右栏按 `detail.playerNames` 渲染真实名单（每行「在线」），空名单仍显示「暂无其他玩家」；本机账号那一行保留，用于展示自己的准备态
- `LobbyPage.tsx`：新增 30 秒定时 `refresh()`——大厅卡片上的在线数同样由心跳驱动，不轮询就永远停在进列表那一刻

**验证**：`cargo test` **27 条全绿**、`npx tsc --noEmit` 与 `npm run build` 通过；后端 `mvn verify` **18 条全绿**并重导出 `openapi.json`。

关键实现决定（后续 agent 注意）：

1. **名单与人数同源**：都以房主端 `ServerManager.players` 为准，`players` 直接取名单长度，不要再维护第二个计数器
2. `useRoomDetail` 的轮询必须**静默**：失败时保留旧详情，否则一次网络抖动会把整个「当前加入」页打成空白
3. 轮询周期要 ≥ 心跳周期量级（本处 15s / 30s）。再短只是徒增请求，房主端本身 30 秒才报一次，且玩家进出时会立刻补报
4. 前端对 `playerNames` 做了 `?? []` 兜底：后端未升级时该字段缺失，直接 `.length` 会抛错
5. 名单里出现自己（房主/玩家本人）时当前不特殊标记，两行同名的观感问题留待后续按需处理

### P5 修订（六）：启动看门狗按「启动代次」判定（2026-09-30）

**现象**：服务端日志已经打出 `Done (35.624s)! For help, type "help"`，界面却仍是「异常」，控制台顶部提示「启动超时（120 秒内未就绪）」。

**定位过程**（值得复用的排查手法）：

- 服务端自己的日志目录给出决定性证据：`logs/2026-09-30-7.log.gz` 的写入时间正是 `latest.log` 的起始时间（19:08:03），说明**此前还有一次启动**，Paper 在本次启动时做了日志轮转
- 本次启动 19:08:03 开始、19:08:38 打出 Done（35.6 秒），而「启动超时（120 秒）」在 19:08:38 就出现了——**远早于本次的 120 秒**。故这条失败判定不可能来自本轮，只可能来自上一轮遗留的看门狗
- 上一轮在 19:06:38 左右启动、19:08:03 被停止；它的看门狗仍在睡眠，19:08:38 醒来时看到的是**新一轮的** `Starting`，于是把新一轮判成了失败

**根因**：`spawn_server` 每次启动都新起一个 120 秒看门狗线程与一个退出轮询线程，但两者都不记录「自己属于哪一轮」。上一轮的线程醒来后会作用于当前状态，把刚起步的新一轮判失败。

**修复**（`src-tauri/src/server/process.rs`、`src-tauri/src/server/mod.rs`）：

- `ServerManager` 新增 `run_id: u64`，`install()` 每次自增并返回本轮代次；`run_id()` 只读暴露
- 看门狗：醒来后必须同时满足「`run_id` 仍是本轮」+「phase 仍为 `Starting`」才判超时
- 退出轮询：每轮 poll 前先比对 `run_id`，不一致即刻退场——否则它会去轮询新一轮的进程句柄并误报「服务端意外退出」
- 就绪判定抽成 `is_ready_line()`，并补齐**真实控制台格式**的单测：Paper 1.21 控制台走 stdout，前缀是单括号 `[HH:mm:ss LEVEL]: `，与日志文件的双括号 `[HH:mm:ss] [Thread/LEVEL]: ` 不同，只按一种实现就会永远匹配不上

**验证**：`cargo test` **29 条全绿**（新增 2 条：单括号前缀剥离、两种前缀形态的就绪判定）。

关键实现决定（后续 agent 注意）：

1. **凡是一次启动派生出的后台线程（看门狗 / 退出轮询 / 日志泵），都要带上「属于哪一轮」的标记**，醒来先验代次再动手；否则必然出现「上一轮打死新一轮」
2. 「服务端明明启动成功却报异常」要先看时间戳对不对得上：把失败提示出现的时间与本次启动时长比对，就能立刻分辨是本轮真超时还是上一轮的残留判定
3. Paper 的**控制台前缀与日志文件前缀不是同一种**，任何基于日志正文的判据都要按两种形态各写一条单测
4. 服务端日志目录的轮转文件（`logs/YYYY-MM-DD-N.log.gz`）是判断「有没有发生过前一次启动」的可靠线索，排查启动类问题优先看它

### P5 修订（七）：房间人数恒为 0（Paper 控制台 ANSI 颜色）（2026-09-30）

**现象**：房主开服后房间里明明有人，大厅卡片与「当前加入」页的人数**始终为 0**；房间本身保持在线（心跳在发），不是离线判定问题。

**定位过程**（值得复用的排查手法）：

- 先证伪后端：用真实后端跑 `心跳 players=2 → 房间详情 → 大厅列表`，人数完全正确 → 后端与协议无责，范围收缩到桌面端
- 再看真实环境：本机测试服务端是 `D:\Download\MSL\Server\paper-1.21.4.jar`（由垃圾侠客户端启动），其 `logs/latest.log` 里**确有** `Drbiaodi joined the game` 记录，说明玩家真的进过、日志也没丢
- 关键差异：**Rust 解析的是控制台 stdout，不是日志文件**。用 PrismarineJS 协议库模拟离线玩家登录 Paper 1.21.4 并抓取 stdout 原始字节，得到决定性对比：

  | 来源 | 同一行消息 |
  |---|---|
  | 控制台 stdout | `[20:45:33 INFO]: `**`\x1b[38;5;11m`**`ProbeBot joined the game`**`\x1b[0m`** |
  | 日志文件 | `[20:45:33] [Server thread/INFO]: ProbeBot joined the game` |

**根因**：Paper 的玩家进出 / 聊天消息是 Adventure **Component**，控制台渲染时**带 ANSI 颜色转义码**，日志文件则不带。`parse_player_line` 用 `strip_suffix(" joined the game")` 匹配，行尾多出 `\x1b[0m` → **永远失配** → `players` 集合恒空 → 心跳上报 `0`。`lost connection` 那类纯文本行反而能解析（但依赖 join 先成功，所以也无效）。

**修复**（`src-tauri/src/server/mod.rs`、`src-tauri/src/server/process.rs`）：

- 新增 `strip_ansi(&str) -> Cow<str>`：剥 CSI 序列（`ESC [ 参数 终止字节`）；**不含 ESC 时借用返回**，老版本（Spigot 1.8.8）与日志文件形态行为完全不变
- `pump_lines`：`strip_ansi(strip_log_prefix(&line))` 之前先对整行剥色，**emit 到控制台的行同样剥色**（前端按纯文本渲染，不处理 ANSI，留着就是 `[38;5;11m … [0m` 乱码），一处修复同时解决「人数为 0」与「控制台颜色乱码」两个问题
- `is_ready_line`：兜底再剥一次 ANSI，防止就绪行被着色导致 phase 永远停在 starting

**验证**：

- `cargo test` **33 条全绿**（新增 3 条，全部使用抓取到的真实行：`strip_ansi_removes_paper_console_colors`、`counts_players_from_colored_console_lines`、`ready_line_ignores_console_colors`）
- 端到端复刻：真实 Paper 1.21.4 + 协议客户端抓取完整 stdout（6513 字节）回放——
  **修复前**只识别到 `lost connection`（人数 0，且状态机错乱）；**修复后**正确识别 `Joined → 1 人`、`Left → 0 人`
- 前端 `npx tsc --noEmit` 通过；后端零改动（未触碰）

关键实现决定（后续 agent 注意）：

1. **控制台与日志文件的同一行内容可能不同**：Component 消息在 stdout 带 ANSI、在日志文件是纯文本。凡是从 stdout 解析正文的判据，都必须先 `strip_ansi`——这与「单/双括号前缀」是同一类坑，Paper 版本升级时优先复查
2. `strip_ansi` 必须**无 ESC 时零分配、原样返回**：Spigot 1.8.8 等老核心不带颜色，不能因为修复新版而改变老版行为
3. 单测要用**抓取到的真实行**，不要凭印象构造：本次真实行是 `[HH:mm:ss INFO]: \x1b[38;5;11mX joined the game\x1b[0m`（256 色 + reset）
4. 顺带修掉的第二个问题：控制台日志的 ANSI 乱码。前端 `ConsoleTab` 直接渲染 `line.raw`，不做 ANSI 解析，所以在 Rust 侧剥干净是成本最低的方案

**另附：本地一键启动脚本**（工作区根目录 `dev-start.ps1` / `dev-start.bat`）

> **注**：该脚本是开发期个人的联调工具，**不随仓库开源**（它同时拉起两个仓库，属于工作区级胶水）。
> 下面记录的是它踩过的坑，对理解项目运行约束仍然有用；自己搭环境时按等价步骤手工执行即可。

- 用法：`.\dev-start.ps1`（前后端同起）、`-BackendOnly`、`-FrontendOnly`、`-Port 9090`
- 后端 `mvn spring-boot:run`（H2 内存库，日志写 `_tmp\dev-backend.log`），桌面端 `npm run tauri dev`
- 三个必须显式处理的坑：① 本机默认 `java` 是 **25**，项目要求 **21**，脚本自动定位 JDK 21 并注入 `JAVA_HOME`（否则 mvn 用错版本）；② 健康检查**必须绕过系统代理**（本机常开 Clash，`127.0.0.1:7897`），否则拿到代理的假响应造成「假就绪」；③ PowerShell 5.1 的 `Wait-Process` **没有 `-PassThru`**，且原生命令写 stderr 在 `$ErrorActionPreference='Stop'` 下会升级成终止错误，脚本统一走 `Invoke-Quiet` 放行
- 实测：后端 **5 秒**就绪（`jdk-21.0.10`），注册接口返回 `code:0`，Ctrl+C 可清理整棵进程树

### P5 修订（八）：房间人数改为成员数（2026-09-30）

**背景**：封面下的「在线 X/Y」显示的是**服务端真实在线玩家数**，房主开房后本人还没进游戏时为 0；玩家列表的状态列只反映操作者自己的本地准备态。口径（用户确认）：X = **房间成员数**（进入房间即计数，房主与玩家一致），状态列 = 每个成员**是否已进入游戏**。设计见 `lajixia-server` 仓库的 `plans/room-member-design.md`。

已交付：

- `shared/useRoomPresence.ts`（新增）：进入「当前加入」页即 `PUT /presence` 登记，停留期间每 30 秒续期，卸载或切房间时 `DELETE /presence`（后端 90 秒超时兜底崩溃 / 断网）
- `shared/api.ts`：新增 `enterRoom` / `leaveRoom` 与 `MemberInfo` / `PresencePayload` 类型；`RoomDetailPayload` 增加 `members`
- `features/join/JoinPage.tsx`：玩家列表改渲染后端返回的 `members`（含房主与尚未进游戏的人），状态列 = `inGame ? "游戏中" : "等待"`，房主行加「房主」标记，空态文案改「暂无成员」
- 删除 `PREP_LABEL` / `PREP_CLASS`：状态列不再由本地准备态驱动（`prep` 仍用于底部启动按钮）

验证（2026-09-30）：`npx tsc --noEmit` 通过；后端 `mvn verify` 24 条全绿；端到端：房主开服 0 人 → 房主进入房间 1 人 → 玩家进入 2 人 → 玩家进服后状态变「游戏中」→ 玩家离开回 1 人。

关键实现决定（后续 agent 注意）：

1. 状态列的 `inGame` 是**启发式**：靠「平台账号名 == MC 玩家名」匹配（离线模式服务器的既有惯例）。名字不一致时该成员恒显示「等待」，但**不影响人数统计**
2. 「退出房间」**不需要显式调接口**：`selectedRoomId` 置空 → hook 的 cleanup 自动 `DELETE /presence`；闭包捕获的是旧 `roomId`，所以切房间会先退出旧房间再进入新房间
3. **房间人数与服务端在线数是两个正交概念**（前者进入房间即计数，后者由房主服务端日志推导），不要试图合并成一个字段

### P5 修订（八）补充：房主开服即登记为成员 + 刷新时机（2026-09-30）

**问题**：房主在「我的游戏」点「启动服务端并进入游戏」后，大厅卡片与「当前加入」页的人数仍为 0。

**根因（两处，都在前端）**：

1. **成员登记只挂在「当前加入」页**（`JoinPage`）。房主的进入路径是「我的游戏」→「启动服务端并进入游戏」，
   这条路径**不会渲染 JoinPage**，`useRoomPresence` 从未执行 → `room_member` 里没有行 → 人数恒为 0。
   后端用真实接口复现时一切正常（并发 8 次 presence → 全 0、三处读路径均 `1/5`），进一步印证问题在前端触发路径
2. **大厅刷新时机**：`LobbyPage` 只在「列表为空」时拉取，从房间页切回大厅要等 **30 秒**定时器才更新

**修复**：

- `RoomManagePage` 接入 `useRoomPresence(roomId, phase === "running" || phase === "starting")`：
  房主在「我的游戏」页且服务端在跑时视为"在房间里"（与心跳的启用条件一致）；
  停服后停止续期，90 秒后由后端 `MemberScheduler` 清理
- `LobbyPage`：**进入大厅即静默刷新一次**，之后每 30 秒静默轻刷。为此给 `lobby.refresh(silent?)` 加静默模式——
  不切换整页加载态，且失败时保留已有列表（一次网络抖动不该把大厅清空）
- `JoinPage`：详情轮询 15 秒 → **5 秒**，人数与「等待 / 游戏中」更跟手

**验证**：`npx tsc --noEmit` 通过；后端侧用真实接口复现并确认三处读路径（详情 / 大厅 / 我的游戏）人数一致。

关键实现决定（后续 agent 注意）：

1. **"进入房间"的触发点可能不止一处**：玩家从大厅点卡片进 `JoinPage`，房主从「我的游戏」点启动。
   凡新增"进入房间"的入口，都要接上 `useRoomPresence`，否则人数会漏记
2. 房主的成员存在性**与服务端启停绑定**（`phase === running|starting`），而不是"打开管理页就算"，
   否则房主只挂着管理页、服务端没跑也会占一个成员位
3. 列表类页面的刷新要**进入即拉 + 定时轻刷**，且轻刷必须静默（`refresh(true)`），
   否则每 30 秒整页闪一次「正在加载」

### P5 修订（八）补充二：人数刷新延迟（2026-09-30）

**现象**：人数能正确显示了，但要等**将近 30 秒**才更新。

**延迟链拆解**（只有最后一环是瓶颈）：

| 环节 | 延迟 |
|---|---|
| 玩家进服 → 房主端解析服务端日志 | 即时 |
| 解析到变化 → 立刻补发一次心跳（`server://players` 事件） | 即时 |
| 心跳 → 后端成员/人数更新 | 即时 |
| **前端列表轮询** | **原来是 30 秒 ← 唯一瓶颈** |

**修复**：`LobbyPage` 的轻刷间隔 **30 秒 → 5 秒**（进入大厅时仍立即拉一次）。
`JoinPage` 详情轮询已是 5 秒。续期（presence）与心跳周期保持 30 秒不变——它们只负责"保活"，不影响展示及时性。

**如要毫秒级实时**：后端 `/ws/lobby`（STOMP）已经在广播 `ONLINE` / `PLAYERS` / `OFFLINE`，
只需前端引入 STOMP 客户端并订阅 `/topic/lobby`，即可把轮询完全换成推送。
桌面端目前**未消费** WebSocket（见架构说明），这是一次独立改造，按需再做。

关键实现决定（后续 agent 注意）：**展示延迟由轮询间隔决定，而数据本身是事件驱动的**。
调优先看轮询间隔，不要误改心跳/续期周期——它们管保活，不管及时性。

### P5 修订（九）：大厅改为 WebSocket 推送（毫秒级）（2026-09-30）

**背景**：人数能正确显示但更新要等近 30 秒——瓶颈是列表轮询间隔。接入后端**早已就绪**的 STOMP 推送后，延迟降到毫秒级。

**已交付（后端零改动，只补了一行聚合日志）**：

- 前端新增依赖 `@stomp/stompjs`
- `shared/lobbySocket.ts`（新增）：由 API 基地址推导 `ws(s)://host/ws/lobby`，连接后订阅 `/topic/lobby`，
  `reconnectDelay: 5s`；帧解析失败一律忽略（推送是尽力而为，不影响主流程）
- `stores/lobby.ts`：新增 `applyEvent(event)`（**只更新命中的那张卡片**，不整列表重拉，避免闪烁与请求量）与 `lastRoomEvent`
- `App.tsx`：**应用级**订阅（与房间心跳同层），收到事件即 `applyEvent`
- `shared/useRoomDetail.ts`：`lastRoomEvent` 命中当前房间时**立即静默刷新**，详情页同样即时
- `features/lobby/LobbyPage.tsx`：轮询 5 秒 → **30 秒**（降级为兜底——断网 / 连接失败 / 后端未升级时仍能更新）
- 后端 `WebSocketConfig`：补**聚合式连接日志**（连上/断开各记当前会话数），用于确认推送通道是否建立：
  `大厅推送连接建立：当前 1 个`

**验证（2026-09-30）**：

- 推送链路：Python STOMP 客户端连 `/ws/lobby` 订阅 `/topic/lobby`，触发心跳与 presence 后依次收到
  `ONLINE`（players=0）与 `PLAYERS`（players=1）✓
- 前端：`npx tsc --noEmit` 通过、`npm run build` 通过（dist 354 kB / gzip 113 kB）
- 端到端：后端日志出现 `大厅推送连接建立：当前 1 个`，会话数稳定不增长（无连接泄漏）✓

**踩坑（重要）**：`App.tsx` 的连接条件最初写成 `if (!serverAddress) return`，而用户的 `preferences.json` 里
**根本没有 `serverAddress`**（从没配过地址 → **空串是正常状态**），导致 WebSocket 永远建不起来。
`resolveApiBaseUrl("")` 本来就会回落到默认 `127.0.0.1:8080`，**不能把"地址为空"当成"尚未就绪"**。

关键实现决定（后续 agent 注意）：

1. 推送是**尽力而为**：必须保留一个较慢的轮询兜底，不能只靠推送
2. `applyEvent` 只替换命中卡片，不要整列表重拉（否则每来一条事件就闪一次、请求量翻倍）
3. 判断"配置是否就绪"要用初始化标志，**不要用"字段是否为空"**——空值往往本身就是合法默认

### P5 修订（十）：「我的游戏」收敛为纯本地控制台（2026-10-01）

**需求**：明确两个概念的边界——「我的游戏」只是**房主的本地服务端控制台**（启停 / 配置 / 插件 / 快照），
**不登记为房间成员**；要进入游戏房间，**只能从「国服大厅」点击房间卡片**。

**改动**：

- `RoomManagePage.tsx`：**移除 `useRoomPresence`**（P5 修订八补充里加的那处），并写明本页定位。
  房间心跳仍在 `App.tsx` 应用级——它负责让房间保持「在线」，与「谁在房间里」是两件事
- `BriefTab.tsx`：按钮文案与新口径对齐
  - `启动服务端并进入游戏` → **`启动服务端`**
  - `启动游戏（复制地址并打开客户端）` → **`复制本机地址并打开客户端`**
  - 底部加指引：**「本页是本机服务端控制台；要进入游戏房间，请到『国服大厅』点击自己的房间卡片」**

**结果**：`useRoomPresence` 只剩 `JoinPage` 一处调用 → **「进入房间」只有一个入口**，
房主与玩家走完全同一条路径，不存在"从管理页进入"这条旁路。

**注**：`BriefTab.launch()` 本来就不写成员（只启动服务端 + 复制地址 + 打开启动器），
本轮只是让**文案**与**实际语义**一致，并显式移除管理页的成员登记。

### P5 修订（十一）：链路可观测性 + 诊断面板（2026-10-01）

**背景**：「房间人数」这条链路上有 6 环（服务端日志 → 房主端解析 → 心跳上报 → 平台存储 → 推送/轮询 → 展示），
**任一环断掉的表现完全相同**，排查只能逐个复现。本轮补上可观测性，让问题「一眼能看出卡在哪一环」。

**已交付**：

- **后端链路日志**（`MemberService` / `RoomService`，**只在状态真变化时记一行**，常规心跳不刷屏）：
  - `房间 1 成员进入：账号 2（测试服务器）` / `房间 1 成员离开：账号 2（测试服务器）`
  - `房间 1 人数变更：0 -> 1（测试服务器）`
  - `房间 1 上线（测试服务器）` / `房间 1 服务端在线名单变更：1 人 [Drbiaodi]`
- **前端诊断面板**（设置弹窗内，每秒刷新相对时间）：
  - **实时通道**（WebSocket 已连接 / 未连接 + 状态变化时间）
  - **成员上报**（最近一次 `presence` 成功：房间号 · 成员数 · 多久之前）
  - **房间心跳**（最近一次成功时间——决定房间是否在线）
  - **大厅列表**（最近一次拉取——推送之外的兜底来源）
  - **本机服务端**（phase）
  - 附一行排查顺序提示
- 新增 `stores/diagnostics.ts`：各环节 `markXxx()` 写入，`sinceText()` 输出相对时间

**排查用法（人数不更新时）**：打开设置 → 看「成员上报」是否在刷新 →「房间心跳」是否正常 →「实时通道」是否已连接。
三者都正常却仍不对，再去看后端日志里对应的 `成员进入 / 人数变更 / 在线名单变更` 那几行。

**本轮踩坑（两条，都值得记）**：

1. **图标/资源成片 404**：`npm install` 新依赖会让 Vite 重新预构建依赖并重启 dev server，
   此时**运行中的页面**其模块与 `import` 的资源 URL 全部失效 → 表现为**所有 PNG 图标消失、封面退回兜底图**。
   校验方法：直接请求 `http://[::1]:5173/src/assets/icons/house-logo.png`（Vite 只绑 IPv6 回环，用 127.0.0.1 会连不上）。
   修复：**重启前端**（或 Ctrl+R 全量刷新）。
2. **误杀工具自身进程**：用 `Get-CimInstance -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'lajixia-desktop|vite' }`
   清理前端进程时，匹配到了**运行本工具的 node 进程**，把自己杀掉、命令中途失败。
   **正确做法**：只按**端口归属**定位（`netstat -ano | findstr :5173` 取 PID），或只按**精确进程名**（`lajixia-desktop.exe`）。

### P5 修订（十二）：成员上报改为会话状态驱动 + 房间会话持久化（2026-10-01）

**现象**：房主从大厅点卡片进入房间后，玩家列表已显示房主（说明登记成功），但**一切到大厅看卡片，人数又变 0**。

**根因**（后端日志是决定性证据）：

```
13:02:49  房间 1 成员进入：账号 2
13:02:50  房间 1 成员离开：账号 2     ← 进入后 1 秒就离开
13:03:09  房间 1 成员进入：账号 2
```

`useRoomPresence` 挂在「当前加入」页（`JoinPage`）里，**切页签导致组件卸载 → cleanup 立刻 `DELETE /presence` → 成员被删**。
即"去看人数"这个动作本身把人数清零了。这与 P5 修订（七）修的"心跳挂在页面里"是**同一类错误**：
**上报依赖页面挂载，而不是明确的会话状态**。

**修复**：

- `App.tsx`：`useRoomPresence(selectedRoomId, accountId !== null)` —— 上报由 **`selectedRoomId` 这个会话状态**驱动，
  与当前页签无关；只有点「退出房间」（置 null）才真正离开
- `JoinPage.tsx`：移除页面级上报，成员列表改用 `detail.members`（推送命中本房间时 `useRoomDetail` 会立即静默刷新，天然实时）
- **房间会话持久化**：`selectedRoomId` 存入 `localStorage`（`ljx.roomSession`）。
  否则**刷新页面或 HMR 热更新会把 `useState` 重置**，人就被踢出房间了——本轮就是因此误判"修复无效"
- `JoinPage` 封面下人数：离线时也显示人数（`离线 · 1/10`，此前只显示"离线"，看不出房间里有几个人）

**验证**：`npx tsc --noEmit` 通过、`npm run build` 通过；后端用真实接口验证"离线房间也能进入并计数"（players=1）。

**教训（第三次同类）**：**任何"我在某个房间里"的上报，都不能挂在页面上**。
凡是这类状态，一律提升到应用级、由会话状态驱动，并**持久化**，这样切页签、刷新、HMR 都不会误离开。

### P5 修订（十三）：「加入提醒提示音」开关做实（2026-10-01）

**问题**：大厅右上角的「开 / 关」按钮点了只变文字，界面无任何变化（用户提问"这个开有什么用"）。

**定位**：它标注 `title="加入提醒提示音"`，但 `soundOn` 只被这个按钮自己读写——
**全项目没有一处播放声音**，是个**死开关**（`preferences` 里存了个布尔值而已）。

**修复**：把提示音真正实现出来，并明确触发条件：

- 新增 `shared/chime.ts`：用 **Web Audio 合成**两声上行短音（A5 → D6），**不引入任何音频文件资源**；
  播放失败一律静默（WebView 在用户首次交互前会拦截音频，不该影响业务）
- `App.tsx` 的推送回调里触发，**三个条件同时满足才响**：
  1. `preferences.soundOn` 为真（就是那个开关）
  2. 事件房间 == **我自己的房间**（`manageRoomRef`，用 ref 保存以免重建 WebSocket）
  3. **人数真的增加**（比较 `applyEvent` 之前的旧值——切页签、改名等事件不该响）
- 新增 `shared/chime.ts` 的边界：无 `AudioContext`、设备无音频输出、被浏览器策略拦截 → 全部静默

**验证**：`npx tsc --noEmit` 通过、`npm run build` 通过。

**注**：`sound-on.png` / `sound-off.png` 图标一直存在且可达（HTTP 200）——
用户截图里没有图标是**页面资源过期**（Vite 被 `npm install` 打断过），刷新页面即可恢复。

### P5 修订（十四）：图标"消失"的真实原因——flex 把 `<img>` 压成了 0 宽（2026-10-01）

**现象**：大厅右上角的声音开关只有"开/关"两个字，看不到 🔊 图标；更早还有标题栏 logo 消失。
用户按 Ctrl+R 刷新后依旧看不到。

**排查过程（走了一段弯路，记下来）**：

1. 先怀疑资源丢失 → 直接请求 `http://[::1]:5173/src/assets/icons/sound-on.png`：**HTTP 200 / 21187 字节**，资源没问题
2. 再怀疑图片本身：读 PNG 头拿到尺寸 `13×13`（正常），用 Pillow 分析像素——
   平均色 `(220,220,220)` 浅灰白、不透明占比 47%、**与用户能正常看到的 `grid.png` 几乎完全一致**
3. 于是只剩布局一种可能。对比两类用法立刻清楚：

   | 位置 | 容器写法 | 结果 |
   |---|---|---|
   | 三视图 / 搜索 / 刷新 | `grid place-items-center` + 固定尺寸 | ✅ 正常 |
   | 标题栏 logo、声音开关 | **`flex items-center`** | ❌ "消失" |

**根因**：`<img>` 在 flex 容器里默认 `flex-shrink: 1`。当同一行元素变多（文字、分页、筛选框…），
图标被逐步压缩，最终压成 **0 宽** —— 既不是资源丢失，也不是颜色/尺寸问题，**是布局压缩**。

**修复**（`src/styles/global.css`，一处修全部）：

```css
img { flex-shrink: 0; }
```

**安全性核对**：两处 `w-full` 的封面图都不受影响——
`JoinPage` 的封面父容器是 `flex w-40 shrink-0`（定宽），`RoomCard` 的父容器是 `relative aspect-square w-full`（定尺寸）。

**教训（下次先做这个）**：**图标/图片"看不见"，第一步先查它是不是被 flex 压缩了**（容器是否 `flex`、img 是否有 `shrink-0`），
不要一上来就怀疑资源——本轮在"资源是否存在/可达/颜色是否正确"上绕了好几圈。
判断技巧：**同一批资源里"能看见的"与"看不见的"分别用在什么容器里**，对比一下就能定位。

### P5 修订（十四）更正：图标其实一直是"汉字"（2026-10-01）

**更正上一节结论**：上一条把"看不到 🔊 图标"归因于 **flex 把 `<img>` 压成 0 宽**，**这个结论不成立**。

**真实原因**（用户截图"开开"给出决定性线索）：原版资源
`sound-on.png` / `sound-off.png` **本身就是"开""关"两个汉字**（13×13 的小图，21 KB 是因为原图带元数据）。
它们与按钮上的文字 `开` / `关` **叠加显示**，就成了「**开开**」——
**图标一直在正常渲染**，只是它长得就是文字，被误认为"图标丢失"。

**已按用户要求改为纯文字**（`LobbyPage.tsx`）：

- 移除 `sound-on.png` / `sound-off.png` 的引入与 `<img>`
- 文案改为说明性的 **`提示音：开` / `提示音：关`**，`title` 写全「加入提醒提示音：开（有人进入我的房间时响一声）」
  —— 顺带解决"这个开关到底控制什么"的疑问

**保留** `img { flex-shrink: 0 }`（global.css）：flex 容器里的 `<img>` 确实可能被压缩成 0 宽，
作为防御性规则留着无害；但它**不是**本次问题的成因。

**教训（关于排查顺序）**：本轮连错两次方向——先怀疑"资源丢失/不可达"（HTTP 200、尺寸、颜色都正常），
再怀疑"flex 压缩"（看似合理但并非本例）。**有效的一步是：把可疑元素放大看清楚它到底长什么样**。
在这类"从原版 exe 提取的资源"场景里，**图标本身可能就是文字或带文字**，先确认内容再查渲染。

### P5 修订（十五）：游戏版本列表补齐 + 允许自定义（2026-10-01）

**需求**：「我的游戏 → 修改信息」的游戏版本原本是固定下拉（仅 5 项：Forge-1.7.10 / KCauldron-1.7.10 /
Spigot-1.8.8 / Spigot-1.12.2 / Paper-1.20.4），Paper / Spigot / Forge / NeoForge 等核心应补齐大部分版本，
并且允许自行填写。

**已交付**：

- `common/constants.ts` 的 `CORE_VERSION_OPTIONS` 由 **5 项扩充到 53 项**：
  Paper 13 / Spigot 8 / Forge 8 / Fabric 7 / NeoForge 5 / Mohist 4 / 原版 3 / Purpur 2 / KCauldron 1 / Thermos 1 / Arclight 1
- **允许自定义**：`BriefTab`（我的游戏 → 修改信息）的版本控件由 `<select>` 改为
  **`<input list="…">` + `<datalist>`** —— 既能从下拉建议里挑，也能直接手输任意值
- `CreatePage`（创建游戏）**同步改造**：否则建房时仍只能选固定值，用户建完房又要改一次
- 两个 `datalist` 用**不同 id**（`ljx-core-versions` / `ljx-core-versions-create`），避免同页面冲突
- **格式约定写进注释**：条目必须是「核心-版本」，因为大厅筛选 `splitCoreVersion` 按**第一个** `-` 拆分；
  核心名与版本号内不要再出现 `-`（`NeoForge-1.21.4` 可以，`Neo-Forge-1.21.4` 不行）
- 大厅筛选（`LobbyPage`）**保持固定下拉**：筛选语义是"从已有值里选一个"，不需要自由输入

**验证**：`npx tsc --noEmit` 通过、`npm run build` 通过；
另用脚本对 53 个条目做**格式自检**（每个都必须能被第一个 `-` 拆成非空的核心与版本）——全部通过。

**注**：打包时发现 `BriefTab` 的替换一度漏改标签名（变成 `<select list=…>` 这种非法组合），已即时修正；
改这类"换控件"的替换时，`old` 片段要包含开标签本身，否则只剩属性被替换。

### P5 修订（十六）：版本筛选改为纯版本号 + 玩法扩充（2026-10-01）

**需求**：① 大厅的「版本」筛选不再区分核心，只按 Minecraft 版本号筛（覆盖 1.6.4 → 26.3）；
② 玩法增加 RPG、科技、空岛、海岛。

**已交付**：

- `common/constants.ts` 新增 **`MC_VERSION_OPTIONS`（29 项纯版本号）**：1.6.4 / 1.7.10 / 1.8.9 / 1.9.4 /
  1.10.2 / 1.11.2 / 1.12.2 / 1.13.2 / 1.14.4 / 1.15.2 / 1.16.5 / 1.17.1 / 1.18.2 / 1.19.2 / 1.19.4 /
  1.20.1 / 1.20.4 / 1.20.6 / 1.21 / 1.21.1 / 1.21.3 / 1.21.4 / 1.21.5 / 1.21.6 / 1.21.7 / 1.21.8 / **26.1 / 26.2 / 26.3**
  （2026 年起 Mojang 改用「年份.序号」版本号）
- `LobbyFilters.coreVersion` **改名为 `mcVersion`**，语义收窄为纯版本号；
  `stores/lobby.ts` 删掉 `splitCoreVersion()` 拆分函数，直接 `mcVersion: filters.mcVersion`
  —— 后端 `GET /api/rooms?mcVersion=` 本就支持，**服务端零改动**
- `LobbyPage` 的版本下拉改用 `MC_VERSION_OPTIONS`
- **`CORE_VERSION_OPTIONS`（53 项「核心-版本」）保留**，只服务房间**登记**表单
  （创建游戏 / 我的游戏→修改信息）——那里必须记录"用哪个核心"，与筛选是两种用途，注释已写明勿混用
- `MODE_OPTIONS` 由 3 项扩到 **7 项**：生存 / 创造 / 冒险 / **RPG / 科技 / 空岛 / 海岛**
  （创建表单、修改信息、大厅筛选**三处共用同一常量**，自动同步生效）

**验证**：`npx tsc --noEmit` 通过、`npm run build` 通过；
另用脚本自检：29 个筛选版本**全部是纯版本号**（正则 `\d+\.\d+(\.\d+)?` 全匹配），
且 `coreVersion` / `splitCoreVersion` 在代码中**已无残留**。

**教训**：改这类"字段语义变更"时，`types.ts` 先改会让所有使用点立刻编译报错——这正是想要的效果
（能一次性定位全部调用点）；但**替换脚本要按实际文本写片段**，本轮 `lobby.ts` 的注释文字与预想不同，
导致替换中断、留下半改状态，靠 tsc 报错才发现。

### P5 修订（十七）：补齐 1.21 系列版本（2026-10-01）

**需求**：1.21 还有 1.21.9 / 1.21.10 / 1.21.11 三个版本，需要加上。

**已交付**：

- `MC_VERSION_OPTIONS`（大厅筛选）：**29 → 33 项**
  - 新增 `1.21.9` / `1.21.10` / `1.21.11`
  - 顺带补上同样缺失的 **`1.21.2`**（原列表 1.21.1 之后直接跳到 1.21.3，中间断档）
  - 1.21 系列现在完整：1.21 / .1 / .2 / .3 / .4 / .5 / .6 / .7 / .8 / .9 / .10 / .11
- `CORE_VERSION_OPTIONS`（房间登记）：**53 → 71 项** —— Paper / Spigot / Forge / NeoForge / Fabric / Purpur
  各补 3 条 `-1.21.9` / `-1.21.10` / `-1.21.11`

**验证**：`npx tsc --noEmit` 通过、`npm run build` 通过；脚本统计：筛选 33 项、登记 71 项，
其中含 1.21.9/10/11 的核心为 Paper、Spigot、Forge、NeoForge、Fabric、Purpur 共 6 个。

**说明（重要）**：登记列表里的「核心-版本」只是**选择建议**——各核心对 1.21.9/10/11 的跟进进度不一
（Paper / Fabric / NeoForge 通常最快，Forge 历史上偏慢），**实际是否存在该组合以核心官方发布为准**；
表单本身允许直接手输，所以列多了不会阻碍使用，列少了也不影响（可自定义）。


---

## P5-十八、定位改为「开服器」：不再强制登录（2026-10-02）

### 需求

1. 未登录、只要连上后端就能**直接看国服大厅的房间**；
2. **创建房间也不再强制登录** —— 软件定位是**开服器**，而不是"必须先注册的社交软件"。

### 关键矛盾与解法

看大厅很简单（把读接口公开），但**建房必须有"房主身份"** —— 因为改设置 / 删房 / 心跳 /
上传客户端包、房间内容管理，**都要靠 `accountId` 判定归属**。没有身份就交不出房间。

**解法：自动访客身份。** 客户端未登录时自动向后端申请一个匿名账号，复用整套既有鉴权：

```
POST /api/auth/guest   →  创建一个匿名账号（访客xxxxxx）+ 返回令牌
```

玩家**全程无感**，不需要填任何东西。

### 改动清单

| 层 | 改动 |
|---|---|
| **数据** | `V23` 迁移：`account` 加 `anonymous` 标记；访客账号密码是 **32 字节随机值**（因此**无法被登录**） |
| **后端·公开读** | `AuthInterceptor` 新增「公开只读」判定：**`GET /api/rooms`** 与 **`GET /api/rooms/{id}`** 无需登录 |
| **后端·访客** | `AuthService.registerGuest()` + `POST /api/auth/guest`；登录时显式拒绝匿名账号 |
| **后端·豁免** | **访客建房跳过「需绑定邮箱」校验** —— 否则等于变相强制登录 |
| **客户端** | `init()` 优先级：正式会话 → 本机访客 → **自动申请新访客**；`logout()` 后回到访客而非"未登录" |
| **客户端** | 访客身份用**独立存储键**（`ljx.guest.*`），不受「记住密码」关闭时的清理影响 |
| **客户端** | 账号面板区分访客；建房页去掉「需要登录」文案（改为连接失败提示） |

### 两个关键设计决定（否则会出错）

**① 公开接口必须"尽力解析令牌"，不能直接放行。**
最初我写成"公开接口直接 `return true`"，结果**带了令牌的请求也被当成匿名** ——
收藏态、`mine` 字段、「我的房间」全部失效，测试立刻抓出 3 个失败。
正确做法：**能解析出身份就设上，解析失败才按匿名**。

**② 访客身份必须独立持久化。**
如果沿用"未勾记住密码就清空令牌"的逻辑，每次启动都会换一个新访客 ——
**玩家上次建的房间就再也管不了了**。所以访客用独立存储键。

### 实测（真实接口，8 步全过）

```
① 未登录看大厅            code=0，5 个房间
② 未登录看详情            mine=false / favorited=false
③ 未登录看收藏视图        返回空列表（不报错）
④ 申请访客身份            访客417945，anonymous=True
⑤ 访客建房                code=0（不受邮箱限制）
⑥ 访客心跳                code=0
⑦ 带访客令牌看详情        mine=True（归属正确）
⑧ 访客密码登录            1102（密码是随机值，登不上）
```

```
mvn verify → 81/81 全绿；契约重导出 → 57 条路径
tsc / npm run build → 通过
```


---

## P5-十九、把访客真正挡在房间门外（2026-10-02）

### 使用者的反馈

「我现在是访客身份，却能进入房间」。看截图确认了问题：访客打开了「禁止游客测试」房间的页面，
界面一切正常，只是玩家列表显示"暂无成员"。

### 根因：拦截生效了，但被静默吞掉

后端**确实**返回了 1307（上一轮实测过），但前端 `useRoomPresence` 里：

```ts
} catch {
  // 房间进不去（未在线 / 上锁 / 满员）时不覆盖已有视图，详情页自身会给出提示
}
```

**这个 catch 把 1307 吞掉了** —— 界面毫无反馈，玩家自然以为"已经进去了"。
而房间**详情接口是公开的**（看大厅要用），所以页面本身能正常打开，更加深了这种错觉。

### 改动

| 位置 | 改动 |
|---|---|
| `useRoomPresence` | 返回 `{ presence, blocked }`；**上锁(1303) / 需要邮箱(1305) / 禁止游客(1307) 会通过 `blocked` 暴露给上层**，其它错误（网络抖动）仍静默，避免把一次丢包显示成"进不去" |
| `App.tsx` | 接住 `blocked` 并传给「当前加入」页 |
| `JoinPage` | 被挡时在底部状态栏显示「**无法进入该房间：<原因>**」+ **可执行按钮**（1307 → 「去登录/注册」；1305 → 「去绑定邮箱」），并**禁用「启动游戏」** |

### 顺带修掉一个更严重的漏洞

账号弹窗的逻辑是「**有 account 就显示账号面板**」，而**访客也是 account**（后端自动创建）——
于是**访客永远看不到登录/注册表单**，想升级成正式账号都没有入口。

**修正**：面板增加「注册正式账号 / 登录已有账号」按钮，点击后切到登录/注册表单。

### 验证

```
npx tsc / npm run build → 通过
（后端拦截逻辑上一轮已实测：访客进「禁止游客」房 → 1307）
```


---

## P5-二十、修掉「拦截状态残留」导致的误拦（2026-10-02）

### 反馈

「该房间未进行限制，但访客依然无法进入」。查证结果是**房间确实没限制**
（`noGuest=False / needEmail=False / locked=False`），**是我的前端 bug**。

### 根因：`blocked` 一旦置上就再也不会清

```ts
enabled: roomId !== null && enabled && blocked === null   // ← 被拦之后就再也不重试
```

两个问题叠加：

1. **被拦之后停止重试** —— 于是玩家登录/绑了邮箱也不会自动恢复；
2. **切换房间时没有重置 `blocked`** —— 进过「禁止游客」的房之后，
   换到完全没限制的房间，界面仍然显示上一个房间的拦截提示。

现象就是使用者看到的：打开「时长验证房」，底部却写着「该房间禁止游客进入」，
「启动游戏」也被禁用 —— 房间本身毫无问题。

### 修法

| 改动 | 原因 |
|---|---|
| **`roomId` 变化时 `setBlocked(null)`** | 切换房间不能沿用上一个房间的拦截状态 |
| **`enabled` 去掉 `blocked === null` 条件** | 被拦后仍每 30 秒重试：玩家刚登录/刚绑邮箱、或房主改了限制时，能**自动恢复**，不需要重启客户端 |

### 验证（真实接口）

```
房间            noGuest  needEmail  访客进入
时长验证房        False    False      放行 OK      ← 反馈的那个，已正常
只禁止游客        True     False      1307
只需要邮箱        False    True       1305
访客开房间测试     False    False      放行 OK
冒烟测试房        False    False      放行 OK
```

**后端判定完全正确**，问题纯在客户端的拦截状态管理。

> 教训：**"永久性错误状态"要区分它属于哪个 scope** —— 房间相关的状态必须在房间切换时清掉，
> 否则会跨房间污染。这里 `blocked` 本意是"当前房间进不去"，却被当成了"这个人进不去任何房间"。


---

## P5-二十一、「两者都要」房间仍可复制地址/启动游戏（2026-10-02）

### 反馈

「一个两者都要的房间中，虽然未将访客出现在玩家列表，但是可以进行复制地址和启动游戏」。

两个问题：

1. **「复制地址」按钮压根没考虑拦截** —— 它的 `disabled` 只看 `!address`。
   后果不只是"看起来能点"：**访客可以靠它拿到服务器地址，绕过准入直接连服务端**。
2. **「启动游戏」该变灰却没变灰**。

### 修法

**① 「复制地址」加上拦截判定**：

```diff
- disabled={!address}
+ disabled={!address || blocked !== null}
+ title={blocked !== null ? "无法进入该房间" : undefined}
```

**② 「能不能进」的判断改为「任何服务端业务错误都算被拦」**：

原来按固定错误码白名单判断（1303 上锁 / 1305 需要邮箱 / 1307 禁止游客）：

```ts
const BLOCKING_CODES = new Set([1303, 1305, 1307]);
if (BLOCKING_CODES.has(code)) { ... }
```

**实测确认后端确实返回 1307**（`PUT /api/rooms/11/presence` → `code=1307`），
`ApiError.code` 字段名也确认无误，但界面上就是没被拦住 —— **根本原因未能复现**。

因此改成**不依赖具体错误码**的判断：

```ts
// 只要服务端给了业务错误码（code > 0），就说明"这个人进不去这个房间"
if (code > 0) { setBlocked(...); setPresence(null); }
// 网络层失败（-1）仍静默：那是连接问题，不该说成"房间拒绝了你"
```

**收益**：能少漏判，且**将来加新门槛（例如"仅限 VIP"）不用回来改这里**。

> 诚实记录：这一条是"**没能定位根因、改用更稳的写法覆盖**"，不是找到了确切原因。
> 如果后续再出现"该拦没拦"，优先怀疑 `useInterval` 里 `taskRef` 闭包的时序，
> 或在 `useRoomPresence` 里临时打印 `code` 来确认。

### 验证

```
npx tsc --noEmit / npm run build → 通过
后端判定（真实接口）：两者都要 → 1307；无限制房间 → 放行
```


---

## P5-二十二、切换房间时的准入空窗期漏洞（2026-10-02）

### 使用者的批评

「当玩家进入到一个房间时，若在国服大厅直接点击下一个房间，无论该房间是否限制游客或要求邮箱，
都可以复制地址和启动游戏。你这个限制也太弱了吧，怎么一下就穿了」

**批评是对的。** 这是一个**时序漏洞**，两个缺陷叠加：

### 缺陷一：`useInterval` 的依赖不含 `roomId`

```ts
}, [intervalMs, enabled]);      // ← roomId 不在这里
```

`roomId` 从 11 换成 8 时，`enabled` 一直是 `true`（没变化）→ **effect 不重跑** →
不会立刻为新房间请求**一次**，只能干等下一个 30 秒周期。

### 缺陷二：`blocked === null` 混淆了两种含义

它同时表示「**没被拦**」和「**还没查**」——而这两者的处理**完全相反**。

我上一轮还加了「切房间时 `setBlocked(null)`」，于是切房间后的空窗期里
`blocked === null` 被当成"允许进入"，**按钮全部可用、服务器地址可以被拿走**。

### 修法（根治，而不是把白名单加宽）

| 改动 | 作用 |
|---|---|
| **`useInterval` 增加 `resetKey` 参数**（参与依赖数组） | 房间成员上报传 `roomId`：**切房间立刻为新房间请求一次** |
| **`useRoomPresence` 增加 `checked`**（是否已拿到结果） | 把"没被拦"和"还没查"**彻底分开** |
| **`JoinPage` 用 `notEnterable = !enterChecked \|\| blocked !== null`** | 「复制地址」「启动游戏」**统一用它**：未确认可进入时一律禁用 |
| 底部状态栏增加「正在校验能否进入该房间…」 | 检查期间不再显示成"准备就绪" |

### 为什么这样才算根治

- **不是**把错误码白名单放宽（那是治标）；
- **而是**消除"未确认即放行"这个状态 —— 只要还没拿到"能进"的结论，就不给任何可用入口。
  **将来无论加多少新门槛，都不会再出现这个空窗期。**

> 教训：**默认必须是"拒绝"**。用 `null` 表示"没有限制"时，同一个值也被"还没检查"占用，
> 而默认放行的时间窗就是漏洞本身。安全相关的状态，**未知要按最坏情况处理**。
