use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstall {
    pub path: String,
    pub version: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McEnv {
    pub minecraft_dir: Option<String>,
    pub has_launcher_profiles: bool,
}

pub fn find_java() -> Vec<JavaInstall> {
    let mut result: Vec<JavaInstall> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut candidates: Vec<(PathBuf, String)> = Vec::new();

    if let Ok(home) = std::env::var("JAVA_HOME") {
        candidates.push((Path::new(&home).join("bin").join("java.exe"), "JAVA_HOME".into()));
    }

    let roots = [
        r"C:\Program Files\Java",
        r"C:\Program Files (x86)\Java",
        r"C:\Program Files\Eclipse Adoptium",
        r"C:\Program Files\Microsoft",
    ];
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            candidates.push((entry.path().join("bin").join("java.exe"), root.to_string()));
        }
    }

    for (exe, source) in candidates {
        if let Some(inst) = probe_one(&exe, &source) {
            if seen.insert(inst.path.clone()) {
                result.push(inst);
            }
        }
    }
    result
}

fn probe_one(exe: &Path, source: &str) -> Option<JavaInstall> {
    if !exe.is_file() {
        return None;
    }
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("-version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().ok()?;
    // java -version 输出在 stderr：openjdk version "17.0.2" ...
    let text = String::from_utf8_lossy(&out.stderr);
    let version = text
        .lines()
        .next()
        .and_then(|l| l.split('"').nth(1))
        .map(str::to_string)?;
    Some(JavaInstall {
        path: exe.to_string_lossy().to_string(),
        version,
        source: source.to_string(),
    })
}

pub fn is_port_occupied(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

pub fn probe_mc() -> McEnv {
    let dir = std::env::var("APPDATA")
        .ok()
        .map(|appdata| Path::new(&appdata).join(".minecraft"));
    match dir {
        Some(d) if d.is_dir() => McEnv {
            minecraft_dir: Some(d.to_string_lossy().to_string()),
            has_launcher_profiles: d.join("launcher_profiles.json").is_file(),
        },
        _ => McEnv {
            minecraft_dir: None,
            has_launcher_profiles: false,
        },
    }
}
