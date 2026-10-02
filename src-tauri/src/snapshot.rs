use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 快照目录名（位于服务端工作目录下，不参与备份，避免自包含）
pub const SNAPSHOT_DIR: &str = "ljx-snapshots";

/// 快照包含内容：地图存档 + 关键配置。
/// 插件 jar 不入快照——它们可由平台内容库重新安装，排除后快照体积可控。
const SNAPSHOT_ENTRIES: &[&str] = &[
    "world",
    "world_nether",
    "world_the_end",
    "server.properties",
    "ops.json",
    "whitelist.json",
    "banned-players.json",
    "banned-ips.json",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub name: String,
    pub size_bytes: u64,
    pub created_at: String,
}

pub fn snapshots_dir(work_dir: &str) -> PathBuf {
    Path::new(work_dir).join(SNAPSHOT_DIR)
}

/// 快照名只允许字母数字与 `-` `_` `.`，避免路径穿越与非法文件名
fn sanitize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("快照名不能为空".into());
    }
    if trimmed.len() > 64 {
        return Err("快照名不能超过 64 字符".into());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("快照名只能包含字母、数字、-、_、.".into());
    }
    Ok(trimmed.to_string())
}

fn escape_ps(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// 统一以 UTF-8 读取 PowerShell 输出，避免中文路径乱码
fn run_powershell(script: &str) -> Result<String, String> {
    let full = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; {script}"
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &full]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let out = cmd
        .output()
        .map_err(|e| format!("调用 PowerShell 失败：{e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("系统命令执行失败：{}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 列出工作目录下的本地快照（新建优先）
pub fn list_snapshots(work_dir: &str) -> Result<Vec<SnapshotMeta>, String> {
    if work_dir.trim().is_empty() {
        return Ok(Vec::new());
    }
    let dir = snapshots_dir(work_dir);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let script = format!(
        "$items = @(Get-ChildItem -LiteralPath {} -Filter '*.zip' -File -ErrorAction SilentlyContinue \
         | Sort-Object LastWriteTime -Descending \
         | ForEach-Object {{ [pscustomobject]@{{ name = $_.BaseName; sizeBytes = $_.Length; \
         createdAt = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') }} }}); \
         ConvertTo-Json -InputObject $items -Compress",
        escape_ps(&dir.to_string_lossy())
    );
    let raw = run_powershell(&script)?;
    let raw = raw.trim();
    if raw.is_empty() || raw == "null" {
        return Ok(Vec::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("解析快照列表失败：{e}"))?;
    let items = match value {
        serde_json::Value::Array(items) => items,
        other => vec![other],
    };
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<SnapshotMeta>(item).ok())
        .collect())
}

/// 打包当前工作目录的地图与配置为本地快照
pub fn create_snapshot(work_dir: &str, name: &str) -> Result<SnapshotMeta, String> {
    if work_dir.trim().is_empty() {
        return Err("尚未绑定服务端工作目录，请先在控制台配置服务端".into());
    }
    let safe = sanitize_name(name)?;
    let work = Path::new(work_dir);
    if !work.is_dir() {
        return Err(format!("服务端工作目录不存在：{work_dir}"));
    }

    let existing: Vec<PathBuf> = SNAPSHOT_ENTRIES
        .iter()
        .map(|entry| work.join(entry))
        .filter(|path| path.exists())
        .collect();
    if existing.is_empty() {
        return Err("工作目录下暂无可备份内容（未找到地图或配置文件）".into());
    }

    let dir = snapshots_dir(work_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建快照目录失败：{e}"))?;
    let target = dir.join(format!("{safe}.zip"));
    if target.exists() {
        return Err(format!("同名快照已存在：{safe}"));
    }

    let paths = existing
        .iter()
        .map(|path| escape_ps(&path.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        "Compress-Archive -Path {paths} -DestinationPath {} -CompressionLevel Optimal -Force",
        escape_ps(&target.to_string_lossy())
    );
    // 打包失败时必须清理半成品，否则危险操作会因残留文件误判「快照成功」
    if let Err(e) = run_powershell(&script) {
        let _ = std::fs::remove_file(&target);
        return Err(format!("创建快照失败：{e}"));
    }
    if !target.is_file() {
        return Err("创建快照失败：未生成快照文件".into());
    }

    list_snapshots(work_dir)?
        .into_iter()
        .find(|item| item.name == safe)
        .ok_or_else(|| "创建快照失败：快照未登记".to_string())
}

pub fn delete_snapshot(work_dir: &str, name: &str) -> Result<(), String> {
    let safe = sanitize_name(name)?;
    let target = snapshots_dir(work_dir).join(format!("{safe}.zip"));
    if !target.is_file() {
        return Ok(()); // 幂等：已不存在视为成功
    }
    std::fs::remove_file(&target).map_err(|e| format!("删除快照失败：{e}"))
}

/// 恢复的暂存目录：先解压到这里，全部成功后才替换正式内容，避免解压失败导致地图被清空
const RESTORE_STAGING_DIR: &str = ".ljx-restore-staging";

fn remove_entry(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("读取 {path:?} 失败：{e}"))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| format!("删除目录失败 {path:?}：{e}"))
    } else {
        std::fs::remove_file(path).map_err(|e| format!("删除文件失败 {path:?}：{e}"))
    }
}

/// 从本地快照恢复地图与配置，返回被还原的条目名。
/// <p>
/// 采用「先解压到暂存目录、再整体替换」的两段式流程：解压失败时工作目录保持原样，
/// 不会出现地图已删、快照又没铺回去的半成品状态。
pub fn restore_snapshot(work_dir: &str, name: &str) -> Result<Vec<String>, String> {
    if work_dir.trim().is_empty() {
        return Err("尚未绑定服务端工作目录，请先在控制台配置服务端".into());
    }
    let safe = sanitize_name(name)?;
    let work = Path::new(work_dir);
    if !work.is_dir() {
        return Err(format!("服务端工作目录不存在：{work_dir}"));
    }
    let source = snapshots_dir(work_dir).join(format!("{safe}.zip"));
    if !source.is_file() {
        return Err(format!("快照文件不存在：{safe}"));
    }

    let staging = work.join(RESTORE_STAGING_DIR);
    let _ = remove_entry(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("创建恢复暂存目录失败：{e}"))?;

    let script = format!(
        "Expand-Archive -LiteralPath {} -DestinationPath {} -Force",
        escape_ps(&source.to_string_lossy()),
        escape_ps(&staging.to_string_lossy())
    );
    if let Err(e) = run_powershell(&script) {
        let _ = remove_entry(&staging);
        return Err(format!("恢复快照失败：{e}"));
    }

    // 只有快照里确实存在的条目才替换；缺失条目保留现状，避免误删快照外的数据
    let mut restored = Vec::new();
    for entry in SNAPSHOT_ENTRIES {
        let from = staging.join(entry);
        if !from.exists() {
            continue;
        }
        let to = work.join(entry);
        remove_entry(&to)?;
        std::fs::rename(&from, &to).map_err(|e| {
            let _ = remove_entry(&staging);
            format!("恢复 {entry} 失败：{e}")
        })?;
        restored.push((*entry).to_string());
    }
    let _ = remove_entry(&staging);

    if restored.is_empty() {
        return Err("快照内容为空，未恢复任何文件".into());
    }
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_room(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ljx-snapshot-test-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("world").join("region")).unwrap();
        std::fs::write(dir.join("world").join("level.dat"), b"fake-level").unwrap();
        std::fs::write(dir.join("world").join("region").join("r.0.0.mca"), vec![7u8; 4096]).unwrap();
        std::fs::write(dir.join("server.properties"), b"max-players=10\n").unwrap();
        dir
    }

    #[test]
    fn create_list_delete_round_trip() {
        let dir = temp_room("round-trip");
        let work = dir.to_string_lossy().to_string();

        assert!(list_snapshots(&work).unwrap().is_empty());

        let created = create_snapshot(&work, "pre-destroy-2026-09-30").unwrap();
        assert_eq!(created.name, "pre-destroy-2026-09-30");
        assert!(created.size_bytes > 0, "快照体积应大于 0");
        assert!(!created.created_at.is_empty());

        let listed = list_snapshots(&work).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "pre-destroy-2026-09-30");

        // 同名重复创建必须报错，避免覆盖既有保护点
        assert!(create_snapshot(&work, "pre-destroy-2026-09-30").is_err());

        delete_snapshot(&work, "pre-destroy-2026-09-30").unwrap();
        assert!(list_snapshots(&work).unwrap().is_empty());
        // 重复删除幂等
        delete_snapshot(&work, "pre-destroy-2026-09-30").unwrap();

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_brings_back_snapshot_state() {
        let dir = temp_room("restore");
        let work = dir.to_string_lossy().to_string();

        create_snapshot(&work, "point-a").unwrap();

        // 快照之后继续玩：改动地图、新增区块、改配置
        std::fs::write(dir.join("world").join("level.dat"), b"mutated").unwrap();
        std::fs::write(dir.join("world").join("region").join("new.mca"), b"new-chunk").unwrap();
        std::fs::write(dir.join("server.properties"), b"max-players=99\n").unwrap();

        let restored = restore_snapshot(&work, "point-a").unwrap();
        assert!(restored.contains(&"world".to_string()));
        assert!(restored.contains(&"server.properties".to_string()));

        // 精确还原：内容回到快照时点，快照之后新增的区块不再存在
        assert_eq!(
            std::fs::read(dir.join("world").join("level.dat")).unwrap(),
            b"fake-level"
        );
        assert!(!dir.join("world").join("region").join("new.mca").exists());
        assert_eq!(
            std::fs::read(dir.join("server.properties")).unwrap(),
            b"max-players=10\n"
        );

        // 恢复后快照本身仍在（可反复回滚）
        assert_eq!(list_snapshots(&work).unwrap().len(), 1);
        // 暂存目录已清理
        assert!(!dir.join(RESTORE_STAGING_DIR).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_rejects_missing_snapshot_and_unsafe_name() {
        let dir = temp_room("restore-missing");
        let work = dir.to_string_lossy().to_string();

        let err = restore_snapshot(&work, "nope").unwrap_err();
        assert!(err.contains("快照文件不存在"), "实际错误：{err}");
        assert!(restore_snapshot(&work, "../escape").is_err());
        assert!(restore_snapshot("", "any").is_err());

        // 失败不破坏现有数据
        assert_eq!(
            std::fs::read(dir.join("world").join("level.dat")).unwrap(),
            b"fake-level"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unsafe_names() {
        let dir = temp_room("unsafe");
        let work = dir.to_string_lossy().to_string();
        for bad in ["", "  ", "../escape", "a/b", "a\\b", "name:bad"] {
            assert!(
                create_snapshot(&work, bad).is_err(),
                "非法名称应被拒绝：{bad:?}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_room_reports_no_content() {
        let dir = std::env::temp_dir().join(format!("ljx-snapshot-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let work = dir.to_string_lossy().to_string();

        let err = create_snapshot(&work, "empty").unwrap_err();
        assert!(err.contains("无可备份内容"), "实际错误：{err}");
        assert!(list_snapshots(&work).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
