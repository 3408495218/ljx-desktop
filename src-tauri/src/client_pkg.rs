use std::path::PathBuf;

/// 客户端压缩包的下载与落地。
///
/// 本软件不参与打包：房主把 zip 上传到平台，玩家点「启动游戏」选好目录后下载，


/// 只保留文件名本身，剥掉平台侧可能带回的路径，避免写到目标目录之外
pub(crate) fn sanitize_file_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("压缩包文件名不合法".into());
    }
    let mut last: Option<&str> = None;
    for segment in trimmed.split(['/', '\\']) {
        if segment.is_empty() {
            continue;
        }
        if segment == ".." {
            return Err("压缩包文件名不合法".into());
        }
        last = Some(segment);
    }
    let name = last.unwrap_or_default().trim();
    if name.is_empty() || name.contains("..") {
        return Err("压缩包文件名不合法".into());
    }
    Ok(name.to_string())
}

/// 下载房主上传的压缩包到指定目录，返回落盘路径
pub fn download(
    base_url: &str,
    room_id: i64,
    token: &str,
    dest_dir: &str,
    file_name: &str,
) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("尚未配置云服务器地址，请先在设置中填写".into());
    }
    if dest_dir.trim().is_empty() {
        return Err("请先选择压缩包的下载目录".into());
    }
    let name = sanitize_file_name(file_name)?;
    let dir = PathBuf::from(dest_dir.trim());
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    let dest = dir.join(&name);
    let url = format!("{base}/api/rooms/{room_id}/client-package/file");

    // 用 Rust 原生下载，不再走 PowerShell：
    // 之前用 `Invoke-WebRequest -OutFile`，而 PowerShell 的 -OutFile **把路径当通配符**，
    // 于是文件名里带 `[` / `]`（例如 PCL 导出的 `1.21.4[mod].zip`）会直接报
    // "通配符路径无法解析为文件"。改成原生实现后与文件名无关，也不再依赖系统 PowerShell。
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("初始化下载器失败：{e}"))?;
    let mut resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| format!("下载失败：{e}"))?;

    let status = resp.status();
    if !status.is_success() {
        // 服务端会返回 JSON 错误体，尽量把原因透出来（例如 1301=房间不存在、1404=未上传）
        let body = resp.text().unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("下载失败：{detail}"));
    }

    // 先落临时文件再改名：中途失败不会留下一个"看起来完整"的坏包
    let tmp = dest.with_extension("part");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败：{e}"))?;
        std::io::copy(&mut resp, &mut file).map_err(|e| format!("写入文件失败：{e}"))?;
        file.flush().map_err(|e| format!("写入文件失败：{e}"))?;
    }
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("保存文件失败：{e}")
    })?;

    let meta = std::fs::metadata(&dest).map_err(|e| format!("下载失败，未生成文件：{e}"))?;
    if meta.len() == 0 {
        let _ = std::fs::remove_file(&dest);
        return Err("下载失败：压缩包内容为空".into());
    }
    Ok(dest.to_string_lossy().to_string())
}

/// 在资源管理器中打开目录，便于玩家找到刚下载的压缩包交给 PCL 导入
pub fn open_folder(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".into());
    }
    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(format!("路径不存在：{trimmed}"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(target.as_os_str())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("打开目录失败：{e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("当前平台暂不支持打开目录".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_file_names() {
        assert!(sanitize_file_name("").is_err());
        assert!(sanitize_file_name("..").is_err());
        assert!(sanitize_file_name("a/../../evil.zip").is_err());
        // 带路径时只取最后一段
        assert_eq!(sanitize_file_name("C:\\tmp\\client.zip").unwrap(), "client.zip");
        assert_eq!(sanitize_file_name("dir/client.zip").unwrap(), "client.zip");
    }

    #[test]
    fn download_validates_inputs_before_touching_disk() {
        let err = download("", 1, "token", "C:\\tmp", "client.zip").unwrap_err();
        assert!(err.contains("云服务器地址"), "实际错误：{err}");

        let err = download("http://127.0.0.1:8080", 1, "token", "  ", "client.zip").unwrap_err();
        assert!(err.contains("下载目录"), "实际错误：{err}");

        let err = download("http://127.0.0.1:8080", 1, "token", "C:\\tmp", "../x.zip").unwrap_err();
        assert!(err.contains("不合法"), "实际错误：{err}");
    }

    #[test]
    fn open_folder_checks_path() {
        assert!(open_folder("").is_err());
        let missing = std::env::temp_dir().join("ljx-pkg-does-not-exist-xyz");
        assert!(open_folder(&missing.to_string_lossy()).is_err());
    }
}