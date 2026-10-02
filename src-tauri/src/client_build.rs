//! 客户端整合包（mrpack）的解析与「一键构建并启动」。
//!
//! ## 为什么要有这一层
//!
//! 房主用 PCL 导出的是「精简整合包」—— 里面只有**基准版本声明 + 覆盖文件**（几 MB），
//! 原版 `client.jar` / `libraries` / `assets` / 加载器 全靠导入时下载（合计 500MB+）。
//! 这里负责把这套补齐过程自动化，让玩家点一下就能进游戏。
//!
//! ## 设计约束
//!
//! - **薄封装**：`crust_core` 只在本模块内部使用，对外只暴露我们自己的
//!   [`MrpackInfo`] 与 [`ClientBuildProgress`]。将来换实现（或自研）只改这里，业务代码不动。
//! - **目标目录由后端决定**：前端只传「整合包压缩包的路径」，**不允许指定写入目录** ——
//!   否则等于开放任意路径写入。目标固定为 `{app_data}/ljx-client/{packId}/`。
//! - **同一个包只构建一次**：目录名用整合包内容的 SHA-256 前 16 位，
//!   同一份包重复点击会复用已下载的资源（`crust_core` 内部也会做校验与跳过）。

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// 构建进度事件名（前端 `listen("client://build", ...)`）
pub const EVENT_BUILD: &str = "client://build";

/// 整合包解析结果：给前端展示用，让玩家在下载前就知道要装什么、要下多少
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MrpackInfo {
    /// 整合包显示名
    pub name: String,
    /// 需要的 Minecraft 版本，如 "1.21.4"
    pub game_version: String,
    /// 加载器种类：neoforge / forge / fabric / quilt / vanilla
    pub loader: String,
    /// 加载器版本，如 "21.4.157"；vanilla 时为空
    pub loader_version: String,
    /// 覆盖文件数量（mods/config/options.txt 等）
    pub override_files: usize,
    /// 需要额外联网下载的 mod 数量（mrpack 的 files 数组，本样本为 0）
    pub remote_files: usize,
    /// 内容指纹：目标目录名用它，保证同一个包复用同一份客户端
    pub pack_id: String,
}

/// 进度事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientBuildProgress {
    /// 阶段：pack / download / extract / launch / done / error
    pub stage: String,
    /// crust_core 报出的当前元素（如 "Assets"、"libraries"）
    pub element: String,
    pub downloaded: u64,
    pub total: u64,
    /// 人类可读的一句话
    pub message: String,
}

/// 把房主的整合包下载到**平台管理的固定目录**，返回本地绝对路径。
///
/// 与 `download_client_package` 的区别：那个是给玩家自己用的（玩家选目录、下完打开文件夹）；
/// 这个下到 `{app_data}/ljx-client/packs/`，接着交给本模块自动构建客户端，
/// 所以**目录不由玩家指定**，文件名也必须 sanitize（挡住 `..` 之类的穿越）。
pub async fn fetch_pack(
    app: &AppHandle,
    base_url: String,
    room_id: i64,
    token: String,
    file_name: String,
) -> Result<String, String> {
    let dir = client_root(app)?.join("packs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建下载目录失败：{e}"))?;
    let safe_name = crate::client_pkg::sanitize_file_name(&file_name)?;
    let dest = dir.to_string_lossy().to_string();
    let name_for_worker = safe_name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::client_pkg::download(&base_url, room_id, &token, &dest, &name_for_worker)
    })
    .await
    .map_err(|e| format!("下载任务失败：{e}"))??;
    let local = dir.join(&safe_name);
    if !local.is_file() {
        return Err(format!("下载完成后没找到文件：{}", local.display()));
    }
    Ok(local.to_string_lossy().to_string())
}

/// 构建请求
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientBuildRequest {
    /// 整合包压缩包路径（.zip 或 .mrpack）
    pub pack_path: String,
    /// 游戏内昵称（离线模式用）
    pub player_name: Option<String>,
    /// 最大内存，如 "4G"；留空用默认
    pub max_memory: Option<String>,
    /// 是否在构建完成后立即启动
    #[serde(default = "default_true")]
    pub launch_after_build: bool,
}

fn default_true() -> bool {
    true
}

fn emit(app: &AppHandle, progress: ClientBuildProgress) {
    // 前端可能已经关掉窗口，发送失败不影响构建本身
    let _ = app.emit(EVENT_BUILD, progress);
}

fn progress(stage: &str, message: impl Into<String>) -> ClientBuildProgress {
    ClientBuildProgress {
        stage: stage.to_string(),
        element: String::new(),
        downloaded: 0,
        total: 0,
        message: message.into(),
    }
}

/// 读取压缩包里的 `modpack.mrpack`（PCL 自解压包是「zip 套 mrpack」两层结构）
fn read_mrpack_bytes(pack_path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(pack_path)
        .map_err(|e| format!("打不开整合包：{}（{e}）", pack_path.display()))?;
    let mut outer = zip::ZipArchive::new(file).map_err(|e| format!("不是有效的压缩包：{e}"))?;

    // ① 直接就是 mrpack（单层）
    if let Ok(mut entry) = outer.by_name("modrinth.index.json") {
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        return wrap_as_mrpack(&buf);
    }
    // ② PCL 导出的 zip 里嵌套一个 .mrpack
    let nested = (0..outer.len())
        .filter_map(|i| outer.by_index(i).ok().map(|f| f.name().to_string()))
        .find(|n| n.to_ascii_lowercase().ends_with(".mrpack"))
        .ok_or("这个压缩包里没有找到 modpack.mrpack（它可能不是 PCL 精简导出的整合包）")?;
    let mut entry = outer.by_name(&nested).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// 把裸的 index.json 包装成可读的 mrpack 结构，保持下游只处理一种形状
fn wrap_as_mrpack(index_json: &[u8]) -> Result<Vec<u8>, String> {
    // 用一个内存 zip 包住，避免下游分叉
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut cursor);
        let opts: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        w.start_file("modrinth.index.json", opts)
            .map_err(|e| e.to_string())?;
        w.write_all(index_json).map_err(|e| e.to_string())?;
        w.finish().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}

/// 解析整合包，得到版本/加载器/覆盖文件等元信息；同时算出内容指纹
pub fn inspect(pack_path: &Path) -> Result<MrpackInfo, String> {
    if !pack_path.is_file() {
        return Err(format!("整合包不存在：{}", pack_path.display()));
    }
    let mrpack_bytes = read_mrpack_bytes(pack_path)?;
    let mut inner =
        zip::ZipArchive::new(std::io::Cursor::new(&mrpack_bytes)).map_err(|e| e.to_string())?;

    // ① 清单
    let index: serde_json::Value = {
        let mut f = inner
            .by_name("modrinth.index.json")
            .map_err(|e| format!("整合包缺少 modrinth.index.json：{e}"))?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("清单格式不对：{e}"))?
    };

    let deps = index.get("dependencies").cloned().unwrap_or_default();
    let game_version = deps
        .get("minecraft")
        .and_then(|v| v.as_str())
        .ok_or("清单里没有声明 minecraft 版本")?
        .to_string();

    // ② 加载器：取第一个命中的已知键
    let loader_keys = ["neoforge", "forge", "fabric-loader", "quilt-loader"];
    let (loader, loader_version) = loader_keys
        .iter()
        .find_map(|k| {
            deps.get(*k)
                .and_then(|v| v.as_str())
                .map(|ver| (k.trim_end_matches("-loader").to_string(), ver.to_string()))
        })
        .unwrap_or_else(|| ("vanilla".to_string(), String::new()));

    let override_files = inner
        .file_names()
        .filter(|n| n.starts_with("overrides/") && !n.ends_with('/'))
        .count();
    let remote_files = index
        .get("files")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    // ③ 内容指纹：用整个 mrpack 的字节算，够稳定也不会太长
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&mrpack_bytes);
    let digest = format!("{:x}", hasher.finalize());
    let pack_id = digest.chars().take(16).collect::<String>();

    Ok(MrpackInfo {
        name: index
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("未命名整合包")
            .to_string(),
        game_version,
        loader,
        loader_version,
        override_files,
        remote_files,
        pack_id,
    })
}

/// 客户端的落盘根目录：`{app_data}/ljx-client`（不接受前端传入，避免任意路径写入）
fn client_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取不到应用数据目录：{e}"))?;
    Ok(base.join("ljx-client"))
}

/// 把 mrpack 里的 `overrides/` 铺到游戏目录（这些是"非原版"的那部分：
/// mods、config、options.txt、servers.dat 等）
fn apply_overrides(mrpack_bytes: &[u8], dest: &Path) -> Result<usize, String> {
    let mut inner =
        zip::ZipArchive::new(std::io::Cursor::new(mrpack_bytes)).map_err(|e| e.to_string())?;
    let names: Vec<String> = inner
        .file_names()
        .filter(|n| n.starts_with("overrides/") && !n.ends_with('/'))
        .map(|s| s.to_string())
        .collect();
    let mut written = 0;
    for name in names {
        // PCL 自己的配置不铺进游戏目录
        let rel = &name["overrides/".len()..];
        if rel.starts_with("PCL/") || rel.contains("..") {
            continue;
        }
        let target = dest.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("建目录失败：{e}"))?;
        }
        let mut f = inner.by_name(&name).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&target, &buf).map_err(|e| format!("写文件失败 {}：{e}", target.display()))?;
        written += 1;
    }
    Ok(written)
}

/// 把「加载器名」映射到 crust_core 的枚举；不认识的当原版处理。
fn loader_kind(name: &str) -> Option<crust_core::launcher::LoaderKind> {
    use crust_core::launcher::LoaderKind::*;
    match name.to_ascii_lowercase().as_str() {
        "neoforge" => Some(NeoForge),
        "forge" => Some(Forge),
        "fabric" => Some(Fabric),
        "quilt" => Some(Quilt),
        _ => None,
    }
}

/// 构建并发起启动。整个过程在后台跑，进度通过 [`EVENT_BUILD`] 推给前端。
///
/// 返回 `pack_id`，前端可据此在「已就绪」时显示对应条目。
pub async fn build_and_launch(
    app: AppHandle,
    guard: Arc<Mutex<Option<tokio::process::Child>>>,
    request: ClientBuildRequest,
) -> Result<String, String> {
    let pack_path = PathBuf::from(request.pack_path.trim());
    if !pack_path.is_file() {
        return Err(format!("整合包不存在：{}", pack_path.display()));
    }

    emit(&app, progress("pack", "正在读取整合包…"));
    let info = inspect(&pack_path)?;
    let client_root = client_root(&app)?;
    let game_dir = client_root.join(&info.pack_id);
    std::fs::create_dir_all(&game_dir).map_err(|e| format!("建客户端目录失败：{e}"))?;

    emit(
        &app,
        progress(
            "pack",
            format!(
                "整合包「{}」：Minecraft {} + {} {}，覆盖文件 {} 个",
                info.name,
                info.game_version,
                if info.loader == "vanilla" {
                    "原版".to_string()
                } else {
                    info.loader.clone()
                },
                info.loader_version,
                info.override_files
            ),
        ),
    );

    // ① 铺 overrides
    let mrpack_bytes = read_mrpack_bytes(&pack_path)?;
    let written = apply_overrides(&mrpack_bytes, &game_dir)?;
    emit(&app, progress("extract", format!("已铺入 {written} 个覆盖文件")));

    // ② 交给 crust_core 下载原版/加载器/assets，然后启动
    use crust_core::authenticator::{Account, AccountMeta, AccountType};
    use crust_core::foundation::events::Event;
    use crust_core::launcher::{Launch, LaunchOptions};

    let player_name = request
        .player_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Player".to_string());
    let account = Account {
        access_token: "0".to_string(),
        client_token: "00000000000000000000000000000000".to_string(),
        uuid: "00000000000000000000000000000000".to_string(),
        name: player_name,
        refresh_token: None,
        user_properties: "{}".to_string(),
        meta: AccountMeta::offline(AccountType::Mojang, false),
        xbox_account: None,
        profile: Default::default(),
        client_id: None,
        user_info: None,
    };

    let mut options = LaunchOptions::new(game_dir.to_string_lossy().to_string(), &info.game_version);
    if let Some(kind) = loader_kind(&info.loader) {
        options.loader.kind = Some(kind);
        options.loader.build = info.loader_version.clone();
        options.loader.enable = true;
    }
    if let Some(mem) = request.max_memory.filter(|s| !s.trim().is_empty()) {
        options.memory.max = mem;
    }
    // 默认并发只有个位数，500MB 的 assets 会下十几分钟。
    // 提到 64：实测单连接约 1.2 MB/s，多连接能吃到更多带宽（超时/连接池也已放宽）。
    options.download_concurrency = 64;

    // 关掉 NeoForge 的「早期窗口」。
    //
    // 现象：游戏能启动（日志里已出现 Server Pinger，说明逻辑上已进主菜单），
    // 但窗口一直白屏、等多久都不出画面。
    //
    // 原因：NeoForge 默认先开一个早期窗口（日志里的 `Loading ImmediateWindowProvider fmlearlywindow`）
    // 再交给真正的主窗口；部分显卡/驱动组合下主窗口创建后早期窗口没被替换，外观就是"白屏"。
    // `-Dfml.earlyWindowControl=false` 让它跳过这一步，直接创建主窗口。
    options
        .jvm_args
        .push("-Dfml.earlyWindowControl=false".to_string());

    let app_for_events = app.clone();
    let launch = Launch::new(options, account)
        .map_err(|e| format!("初始化启动器失败：{e}"))?
        .with_events(Arc::new(move |event| match event {
            Event::Progress { downloaded, total, element } => emit(
                &app_for_events,
                ClientBuildProgress {
                    stage: "download".to_string(),
                    element,
                    downloaded,
                    total,
                    message: String::new(),
                },
            ),
            Event::Check { checked, total, element } => emit(
                &app_for_events,
                ClientBuildProgress {
                    stage: "check".to_string(),
                    element,
                    downloaded: checked as u64,
                    total: total as u64,
                    message: String::new(),
                },
            ),
            Event::Speed(v) => emit(&app_for_events, progress("speed", format!("{v:.0}")),),
            Event::Estimated(v) => emit(&app_for_events, progress("eta", format!("{v:.0}")),),
            Event::Extract(path) => emit(&app_for_events, progress("extract", path)),
            Event::Patch(line) => emit(&app_for_events, progress("patch", line)),
            Event::Error(message) => {
                emit(&app_for_events, progress("error", message))
            }
        }));

    emit(&app, progress("download", "正在下载原版资源与加载器（首次约 700MB，之后会跳过）…"));

    if !request.launch_after_build {
        // 只准备（下载 / 校验 / 装加载器），不启动 —— 对应 run() 里的 prepare() 阶段
        launch
            .prepare()
            .await
            .map_err(|e| format!("准备客户端失败：{e}"))?;
        emit(&app, progress("done", "客户端已准备完成（未启动）"));
        return Ok(info.pack_id);
    }

    let child = launch
        .run()
        .await
        .map_err(|e| format!("下载或启动失败：{e}"))?;
    let pid = child.id();
    emit(
        &app,
        progress(
            "launch",
            format!("游戏已启动{}", pid.map(|p| format!("（PID {p}）")).unwrap_or_default()),
        ),
    );

    // 记住子进程，便于后续「结束游戏」；如果已有旧进程先放弃引用（不杀，交给系统回收）
    *guard.lock().await = Some(child);
    emit(&app, progress("done", "启动完成"));
    Ok(info.pack_id)
}

/// 结束上一次启动的游戏进程（如果有）
pub async fn kill_running(guard: &Arc<Mutex<Option<tokio::process::Child>>>) -> Result<(), String> {
    let mut slot = guard.lock().await;
    if let Some(mut child) = slot.take() {
        child
            .kill()
            .await
            .map_err(|e| format!("结束游戏进程失败：{e}"))?;
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 造一个「外层 zip 套内层 mrpack」的样本，模拟 PCL 精简导出的结构
    fn make_pcl_style_pack(dir: &Path, loader_key: &str, loader_ver: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let index = format!(
            r#"{{"formatVersion":1,"name":"测试整合包","dependencies":{{"minecraft":"1.21.4","{loader_key}":"{loader_ver}"}},"files":[]}}"#
        );
        // 内层 mrpack
        let mut mrpack = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut mrpack));
            let o: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            w.start_file("modrinth.index.json", o).unwrap();
            w.write_all(index.as_bytes()).unwrap();
            w.start_file("overrides/options.txt", o).unwrap();
            w.write_all(b"fov:0.5").unwrap();
            w.start_file("overrides/mods/example.jar", o).unwrap();
            w.write_all(&[1u8, 2, 3]).unwrap();
            // PCL 自己的配置不应铺进游戏目录
            w.start_file("overrides/PCL/Setup.ini", o).unwrap();
            w.write_all(b"[Setup]").unwrap();
            w.finish().unwrap();
        }
        // 外层 zip
        let outer_path = dir.join("pack.zip");
        {
            let f = std::fs::File::create(&outer_path).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let o: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            w.start_file("Plain Craft Launcher.exe", o).unwrap();
            w.write_all(b"fake").unwrap();
            w.start_file("modpack.mrpack", o).unwrap();
            w.write_all(&mrpack).unwrap();
            w.finish().unwrap();
        }
        outer_path
    }

    #[test]
    fn inspect_reads_neoforge_pack() {
        let base = std::env::temp_dir().join("ljx-mrpack-neoforge");
        let _ = std::fs::remove_dir_all(&base);
        let pack = make_pcl_style_pack(&base, "neoforge", "21.4.157");

        let info = inspect(&pack).unwrap();
        assert_eq!(info.game_version, "1.21.4");
        assert_eq!(info.loader, "neoforge");
        assert_eq!(info.loader_version, "21.4.157");
        assert_eq!(info.name, "测试整合包");
        // overrides 下 3 个文件（含 PCL/Setup.ini，它只在铺的时候被跳过）
        assert_eq!(info.override_files, 3);
        assert_eq!(info.remote_files, 0);
        assert_eq!(info.pack_id.len(), 16, "pack_id 应是 16 位十六进制");
    }

    #[test]
    fn inspect_reads_fabric_and_vanilla() {
        let base = std::env::temp_dir().join("ljx-mrpack-fabric");
        let _ = std::fs::remove_dir_all(&base);
        let info = inspect(&make_pcl_style_pack(&base, "fabric-loader", "0.16.9")).unwrap();
        assert_eq!(info.loader, "fabric");

        // 没有任何加载器声明 → vanilla
        let bare = std::env::temp_dir().join("ljx-mrpack-vanilla");
        let _ = std::fs::remove_dir_all(&bare);
        std::fs::create_dir_all(&bare).unwrap();
        let path = bare.join("pack.zip");
        {
            let mut mrpack = Vec::new();
            {
                let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut mrpack));
                let o: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
                w.start_file("modrinth.index.json", o).unwrap();
                w.write_all(br#"{"dependencies":{"minecraft":"1.20.1"}}"#).unwrap();
                w.finish().unwrap();
            }
            let f = std::fs::File::create(&path).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let o: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            w.start_file("modpack.mrpack", o).unwrap();
            w.write_all(&mrpack).unwrap();
            w.finish().unwrap();
        }
        let info = inspect(&path).unwrap();
        assert_eq!(info.loader, "vanilla");
        assert_eq!(info.game_version, "1.20.1");
    }

    #[test]
    fn apply_overrides_skips_pcl_dir_and_keeps_game_files() {
        let base = std::env::temp_dir().join("ljx-mrpack-apply");
        let _ = std::fs::remove_dir_all(&base);
        let pack = make_pcl_style_pack(&base, "neoforge", "21.4.157");
        let bytes = read_mrpack_bytes(&pack).unwrap();

        let dest = base.join("client");
        let n = apply_overrides(&bytes, &dest).unwrap();
        assert_eq!(n, 2, "PCL/ 下的文件不应被铺进游戏目录");
        assert!(dest.join("options.txt").is_file());
        assert!(dest.join("mods").join("example.jar").is_file());
        assert!(!dest.join("PCL").exists(), "PCL 自己的配置不该出现");
    }

    #[test]
    fn inspect_rejects_non_mrpack_zip() {
        let base = std::env::temp_dir().join("ljx-mrpack-bad");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let path = base.join("plain.zip");
        {
            let f = std::fs::File::create(&path).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let o: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            w.start_file("readme.txt", o).unwrap();
            w.write_all(b"not a modpack").unwrap();
            w.finish().unwrap();
        }
        let err = inspect(&path).unwrap_err();
        assert!(err.contains("modpack.mrpack"), "错误信息应说明缺什么：{err}");
        // 不存在的路径也要有清晰报错
        assert!(inspect(&base.join("nope.zip")).is_err());
    }

    #[test]
    fn loader_kind_maps_known_names() {
        assert!(loader_kind("neoforge").is_some());
        assert!(loader_kind("Forge").is_some());
        assert!(loader_kind("fabric").is_some());
        assert!(loader_kind("quilt").is_some());
        assert!(loader_kind("vanilla").is_none());
        assert!(loader_kind("unknown-loader").is_none());
    }

    /// 锁住「与前端之间的字段命名」契约。
    ///
    /// 踩过的坑：Tauri 只对**命令参数名**做驼峰转换，**不会**转换嵌套结构体的字段名。
    /// 少了 `rename_all = "camelCase"` 时：
    ///   - 前端传 `packPath` → Rust 收不到 `pack_path`，报 "missing field `pack_path`"；
    ///   - Rust 返回 `game_version` → 前端读 `gameVersion` 得到 undefined（界面上就是空值）。
    #[test]
    fn serializes_with_camel_case_for_frontend() {
        let info = MrpackInfo {
            name: "包".into(),
            game_version: "1.21.4".into(),
            loader: "neoforge".into(),
            loader_version: "21.4.157".into(),
            override_files: 6,
            remote_files: 0,
            pack_id: "abc123".into(),
        };
        let j = serde_json::to_value(&info).unwrap();
        for key in ["gameVersion", "loaderVersion", "overrideFiles", "remoteFiles", "packId"] {
            assert!(j.get(key).is_some(), "前端要读 {key}，但序列化结果里没有：{j}");
        }
        assert!(j.get("game_version").is_none(), "不应出现下划线命名，否则前端读到 undefined");

        // 进度事件同理
        let p = ClientBuildProgress {
            stage: "download".into(),
            element: "Assets".into(),
            downloaded: 1,
            total: 2,
            message: String::new(),
        };
        assert!(serde_json::to_value(&p).unwrap().get("stage").is_some());

        // 反向：前端按 camelCase 传参能被正确解析
        let req: ClientBuildRequest = serde_json::from_str(
            r#"{"packPath":"C:/a.zip","playerName":"Steve","maxMemory":"4G","launchAfterBuild":true}"#,
        )
        .unwrap();
        assert_eq!(req.pack_path, "C:/a.zip");
        assert_eq!(req.player_name.as_deref(), Some("Steve"));
        assert_eq!(req.max_memory.as_deref(), Some("4G"));
        assert!(req.launch_after_build);

        // launchAfterBuild 缺省时应为 true（默认构建完就启动）
        let d: ClientBuildRequest = serde_json::from_str(r#"{"packPath":"C:/a.zip"}"#).unwrap();
        assert!(d.launch_after_build);
    }
}
