use std::path::{Path, PathBuf};

/// 「清空地图」删除的目录：世界存档与下界 / 末地维度
const WORLD_DIRS: &[&str] = &["world", "world_nether", "world_the_end"];

/// 「全部重置」额外清除的运行时文件（下次启动会重新生成）
const RESET_FILES: &[&str] = &[
    "server.properties",
    "ops.json",
    "whitelist.json",
    "banned-players.json",
    "banned-ips.json",
];

/// 「全部重置」额外清除的目录
const RESET_DIRS: &[&str] = &["logs", "crash-reports"];

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
        return Err("拒绝对根目录执行危险操作".into());
    }
    Ok(path)
}

fn delete_path(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("读取 {path:?} 失败：{e}"))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| format!("删除目录失败 {path:?}：{e}"))?;
    } else {
        std::fs::remove_file(path).map_err(|e| format!("删除文件失败 {path:?}：{e}"))?;
    }
    Ok(true)
}

/// 清空地图：仅删除世界存档目录（服务端下次启动会重新生成地图）
pub fn clear_world(work_dir: &str) -> Result<Vec<String>, String> {
    let work = require_work_dir(work_dir)?;
    let mut removed = Vec::new();
    for name in WORLD_DIRS {
        if delete_path(&work.join(name))? {
            removed.push((*name).to_string());
        }
    }
    if removed.is_empty() {
        return Err("未找到地图存档目录（world / world_nether / world_the_end）".into());
    }
    Ok(removed)
}

/// 全部重置：清空地图 + 清除运行时配置与日志，回到「初始开服」状态
pub fn reset_all(work_dir: &str) -> Result<Vec<String>, String> {
    let work = require_work_dir(work_dir)?;
    let mut removed = Vec::new();
    for name in WORLD_DIRS {
        if delete_path(&work.join(name))? {
            removed.push((*name).to_string());
        }
    }
    for name in RESET_DIRS {
        if delete_path(&work.join(name))? {
            removed.push((*name).to_string());
        }
    }
    for name in RESET_FILES {
        if delete_path(&work.join(name))? {
            removed.push((*name).to_string());
        }
    }
    if removed.is_empty() {
        return Err("工作目录下没有可重置的内容".into());
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_room(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ljx-world-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for sub in ["world", "world_nether", "world_the_end", "logs", "crash-reports"] {
            std::fs::create_dir_all(dir.join(sub)).unwrap();
        }
        std::fs::write(dir.join("world").join("level.dat"), b"x").unwrap();
        std::fs::write(dir.join("server.properties"), b"max-players=10\n").unwrap();
        std::fs::write(dir.join("ops.json"), b"[]").unwrap();
        dir
    }

    #[test]
    fn clear_world_keeps_configs() {
        let dir = temp_room("clear");
        let work = dir.to_string_lossy().to_string();

        let removed = clear_world(&work).unwrap();
        assert!(removed.contains(&"world".to_string()));
        assert!(removed.contains(&"world_nether".to_string()));
        assert!(removed.contains(&"world_the_end".to_string()));

        assert!(!dir.join("world").exists());
        // 配置与日志不受「清空地图」影响
        assert!(dir.join("server.properties").is_file());
        assert!(dir.join("ops.json").is_file());
        assert!(dir.join("logs").is_dir());

        // 再次执行应报「无可清空内容」而不是静默成功
        assert!(clear_world(&work).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reset_all_also_clears_configs() {
        let dir = temp_room("reset");
        let work = dir.to_string_lossy().to_string();

        let removed = reset_all(&work).unwrap();
        assert!(removed.contains(&"server.properties".to_string()));
        assert!(removed.contains(&"ops.json".to_string()));
        assert!(removed.contains(&"logs".to_string()));

        assert!(!dir.join("world").exists());
        assert!(!dir.join("server.properties").exists());
        assert!(!dir.join("logs").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_empty_or_missing_dir() {
        assert!(clear_world("").is_err());
        assert!(reset_all("   ").is_err());
        let missing = std::env::temp_dir().join("ljx-world-does-not-exist-xyz");
        assert!(clear_world(&missing.to_string_lossy()).is_err());
    }

    #[test]
    fn refuses_root_directory() {
        assert!(clear_world("C:\\").is_err());
    }
}
