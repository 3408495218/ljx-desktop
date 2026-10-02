use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyLine {
    pub key: String,
    pub value: String,
    pub comment: bool,
}

pub fn read_properties(path: &str) -> Result<Vec<PropertyLine>, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取失败：{e}"))?;
    let mut result = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            result.push(PropertyLine {
                key: trimmed.to_string(),
                value: String::new(),
                comment: true,
            });
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            result.push(PropertyLine {
                key: k.trim().to_string(),
                value: v.trim().to_string(),
                comment: false,
            });
        }
    }
    Ok(result)
}

/// 逐行替换键值，保留注释与空行；新键追加到文件末尾。
pub fn write_properties(path: &str, entries: &[PropertyLine]) -> Result<(), String> {
    let updates: HashMap<String, String> = entries
        .iter()
        .filter(|e| !e.comment)
        .map(|e| (e.key.clone(), e.value.clone()))
        .collect();

    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let mut written: HashSet<String> = HashSet::new();
    let mut out = String::new();

    for line in existing.lines() {
        let trimmed = line.trim();
        let replaced = if !trimmed.starts_with('#') && !trimmed.is_empty() {
            trimmed
                .split_once('=')
                .and_then(|(k, _)| {
                    let key = k.trim();
                    updates.get(key).map(|v| {
                        written.insert(key.to_string());
                        format!("{key}={v}")
                    })
                })
        } else {
            None
        };
        match replaced {
            Some(new_line) => {
                out.push_str(&new_line);
                out.push('\n');
            }
            None => {
                out.push_str(line);
                out.push('\n');
            }
        }
    }

    for (k, v) in &updates {
        if !written.contains(k) {
            out.push_str(&format!("{k}={v}\n"));
        }
    }

    if let Some(parent) = Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, out).map_err(|e| format!("写入失败：{e}"))
}
