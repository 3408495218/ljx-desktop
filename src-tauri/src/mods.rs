use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 内容类型：对应服务端工作目录下的两个子目录。
/// 平台不参与分发，这里只管理房主本机的 jar 文件，扫描结果上报后供玩家查看。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentKind {
    Plugin,
    Mod,
}

impl ContentKind {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "plugin" => Ok(ContentKind::Plugin),
            "mod" => Ok(ContentKind::Mod),
            other => Err(format!("未知内容类型：{other}")),
        }
    }

    fn dir_name(self) -> &'static str {
        match self {
            ContentKind::Plugin => "plugins",
            ContentKind::Mod => "mods",
        }
    }

    fn label(self) -> &'static str {
        match self {
            ContentKind::Plugin => "插件",
            ContentKind::Mod => "Mod",
        }
    }
}

/// 停用靠重命名实现（`X.jar` ↔ `X.jar.disabled`），不改动文件内容
const DISABLED_SUFFIX: &str = ".disabled";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentEntry {
    /// 展示名（去掉停用后缀），同时作为上报平台的键
    pub name: String,
    /// 磁盘上的真实文件名，删除 / 启停用它定位
    pub file_name: String,
    pub size_bytes: u64,
    pub enabled: bool,
}

/// 所有操作都限定在工作目录内：拒绝空路径与根目录，防止误删磁盘
fn require_work_dir(work_dir: &str) -> Result<PathBuf, String> {
    let trimmed = work_dir.trim();
    if trimmed.is_empty() {
        return Err("尚未绑定服务端工作目录，请先在控制台配置服务端".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(format!("服务端工作目录不存在：{trimmed}"));
    }
    if path.parent().is_none() {
        return Err("拒绝对根目录执行内容管理操作".into());
    }
    Ok(path)
}

/// 只接受纯文件名：拒绝路径分隔符与 `..`，避免越出 plugins / mods 目录
fn sanitize_file_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("文件名不能为空".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("文件名不合法：{raw}"));
    }
    Ok(name.to_string())
}

fn display_name(file_name: &str) -> String {
    file_name
        .strip_suffix(DISABLED_SUFFIX)
        .unwrap_or(file_name)
        .to_string()
}

/// 只收 jar：plugins 目录下还有各插件的配置子目录，不应混进清单
fn is_jar(file_name: &str) -> bool {
    display_name(file_name).to_ascii_lowercase().ends_with(".jar")
}

fn entry_of(path: &Path) -> Option<ContentEntry> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let file_name = path.file_name()?.to_string_lossy().to_string();
    if !is_jar(&file_name) {
        return None;
    }
    Some(ContentEntry {
        name: display_name(&file_name),
        enabled: !file_name.ends_with(DISABLED_SUFFIX),
        file_name,
        size_bytes: meta.len(),
    })
}

/// 扫描本地目录，返回可直接上报平台的清单（目录不存在时视为空）
pub fn list_contents(work_dir: &str, kind: ContentKind) -> Result<Vec<ContentEntry>, String> {
    let work = require_work_dir(work_dir)?;
    let dir = work.join(kind.dir_name());
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut items: Vec<ContentEntry> = std::fs::read_dir(&dir)
        .map_err(|e| format!("读取{}目录失败：{e}", kind.label()))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry_of(&entry.path()))
        .collect();
    items.sort_by_key(|item| item.name.to_ascii_lowercase());
    Ok(items)
}

/// 把外部 jar 复制进本地目录。先整体校验再落盘，避免拷到一半留下半套文件
pub fn import_contents(
    work_dir: &str,
    kind: ContentKind,
    sources: &[String],
) -> Result<Vec<ContentEntry>, String> {
    let work = require_work_dir(work_dir)?;
    if sources.is_empty() {
        return Err("请选择要导入的文件".into());
    }
    let dir = work.join(kind.dir_name());

    let mut planned: Vec<(PathBuf, String)> = Vec::new();
    for raw in sources {
        let src = PathBuf::from(raw);
        if !src.is_file() {
            return Err(format!("文件不存在：{raw}"));
        }
        let file_name = sanitize_file_name(
            src.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default(),
        )?;
        if !is_jar(&file_name) {
            return Err(format!("{}目录只接受 jar 文件：{file_name}", kind.label()));
        }
        if dir.join(&file_name).exists() {
            return Err(format!(
                "{}目录下已存在同名文件：{file_name}",
                kind.label()
            ));
        }
        planned.push((src, file_name));
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("创建{}目录失败：{e}", kind.label()))?;
    for (src, file_name) in planned {
        std::fs::copy(&src, dir.join(&file_name))
            .map_err(|e| format!("导入 {file_name} 失败：{e}"))?;
    }
    list_contents(work_dir, kind)
}

/// 删除本地文件（幂等：已不存在视为成功）
pub fn delete_content(
    work_dir: &str,
    kind: ContentKind,
    file_name: &str,
) -> Result<Vec<ContentEntry>, String> {
    let work = require_work_dir(work_dir)?;
    let name = sanitize_file_name(file_name)?;
    let target = work.join(kind.dir_name()).join(&name);
    if target.is_file() {
        std::fs::remove_file(&target).map_err(|e| format!("删除 {name} 失败：{e}"))?;
    }
    list_contents(work_dir, kind)
}

/// 启用 / 停用：重命名文件，服务端下次启动时生效
pub fn set_content_enabled(
    work_dir: &str,
    kind: ContentKind,
    file_name: &str,
    enabled: bool,
) -> Result<Vec<ContentEntry>, String> {
    let work = require_work_dir(work_dir)?;
    let name = sanitize_file_name(file_name)?;
    let dir = work.join(kind.dir_name());
    let current = dir.join(&name);
    if !current.is_file() {
        return Err(format!("{}不存在：{name}", kind.label()));
    }
    if enabled == !name.ends_with(DISABLED_SUFFIX) {
        return list_contents(work_dir, kind);
    }
    let target = if enabled {
        dir.join(display_name(&name))
    } else {
        dir.join(format!("{name}{DISABLED_SUFFIX}"))
    };
    if target.exists() {
        return Err(format!("目标文件名已存在：{}", target.display()));
    }
    std::fs::rename(&current, &target)
        .map_err(|e| format!("{} {name} 失败：{e}", if enabled { "启用" } else { "停用" }))?;
    list_contents(work_dir, kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_room(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ljx-mods-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("plugins")).unwrap();
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        // 插件目录下的配置子目录不应出现在清单里
        std::fs::create_dir_all(dir.join("plugins").join("EssentialsX")).unwrap();
        std::fs::write(dir.join("plugins").join("EssentialsX").join("config.yml"), b"x").unwrap();
        std::fs::write(dir.join("plugins").join("EssentialsX.jar"), vec![1u8; 512]).unwrap();
        std::fs::write(dir.join("mods").join("jei.jar"), vec![2u8; 256]).unwrap();
        dir
    }

    /// 在独立临时目录里放一个待导入的 jar，保证文件名与目标名一致
    fn source_jar(tag: &str, name: &str, size: usize) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ljx-mods-src-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, vec![3u8; size]).unwrap();
        path
    }

    fn cleanup_source(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn lists_only_jars_and_sorts() {
        let dir = temp_room("list");
        let work = dir.to_string_lossy().to_string();

        let plugins = list_contents(&work, ContentKind::Plugin).unwrap();
        assert_eq!(plugins.len(), 1, "配置子目录不应入清单");
        assert_eq!(plugins[0].name, "EssentialsX.jar");
        assert!(plugins[0].enabled);
        assert_eq!(plugins[0].size_bytes, 512);

        let mods = list_contents(&work, ContentKind::Mod).unwrap();
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].file_name, "jei.jar");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_dir_lists_empty() {
        let dir = std::env::temp_dir().join(format!("ljx-mods-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let work = dir.to_string_lossy().to_string();

        assert!(list_contents(&work, ContentKind::Plugin).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_rejects_duplicates_and_non_jar() {
        let dir = temp_room("import-dup");
        let work = dir.to_string_lossy().to_string();

        let dup = source_jar("dup", "EssentialsX.jar", 64);
        let err = import_contents(&work, ContentKind::Plugin, &[dup.to_string_lossy().to_string()])
            .unwrap_err();
        assert!(err.contains("已存在同名文件"), "实际错误：{err}");

        let txt = source_jar("txt", "notes.txt", 16);
        let err = import_contents(&work, ContentKind::Plugin, &[txt.to_string_lossy().to_string()])
            .unwrap_err();
        assert!(err.contains("只接受 jar"), "实际错误：{err}");

        // 校验失败不应留下任何新文件
        assert_eq!(list_contents(&work, ContentKind::Plugin).unwrap().len(), 1);

        cleanup_source(&dup);
        cleanup_source(&txt);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_copies_and_lists() {
        let dir = temp_room("import");
        let work = dir.to_string_lossy().to_string();
        let src = source_jar("new", "Vault.jar", 128);

        let after = import_contents(&work, ContentKind::Plugin, &[src.to_string_lossy().to_string()])
            .unwrap();
        assert_eq!(after.len(), 2);
        assert!(after.iter().any(|item| item.name == "Vault.jar"));
        assert!(dir.join("plugins").join("Vault.jar").is_file());

        // 源文件保留，导入是复制而非移动
        assert!(src.is_file());

        cleanup_source(&src);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn toggle_enabled_renames_both_ways() {
        let dir = temp_room("toggle");
        let work = dir.to_string_lossy().to_string();

        let disabled =
            set_content_enabled(&work, ContentKind::Plugin, "EssentialsX.jar", false).unwrap();
        assert!(!disabled[0].enabled);
        assert_eq!(disabled[0].name, "EssentialsX.jar");
        assert_eq!(disabled[0].file_name, "EssentialsX.jar.disabled");
        assert!(dir.join("plugins").join("EssentialsX.jar.disabled").is_file());

        // 用真实文件名再启用一次，应恢复原名
        let enabled = set_content_enabled(
            &work,
            ContentKind::Plugin,
            "EssentialsX.jar.disabled",
            true,
        )
        .unwrap();
        assert!(enabled[0].enabled);
        assert_eq!(enabled[0].file_name, "EssentialsX.jar");
        assert!(dir.join("plugins").join("EssentialsX.jar").is_file());

        // 幂等：状态已一致时直接返回清单
        assert!(set_content_enabled(&work, ContentKind::Plugin, "EssentialsX.jar", true).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_is_idempotent() {
        let dir = temp_room("delete");
        let work = dir.to_string_lossy().to_string();

        assert!(delete_content(&work, ContentKind::Mod, "jei.jar").unwrap().is_empty());
        assert!(!dir.join("mods").join("jei.jar").exists());
        // 再删一次不报错
        assert!(delete_content(&work, ContentKind::Mod, "jei.jar").is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unsafe_paths_and_missing_dir() {
        let dir = temp_room("unsafe");
        let work = dir.to_string_lossy().to_string();

        for bad in ["../escape.jar", "sub/dir.jar", "sub\\dir.jar", ""] {
            assert!(
                delete_content(&work, ContentKind::Plugin, bad).is_err(),
                "非法文件名应被拒绝：{bad:?}"
            );
        }
        assert!(list_contents("", ContentKind::Plugin).is_err());
        assert!(list_contents("C:\\", ContentKind::Plugin).is_err());
        assert!(ContentKind::parse("unknown").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}