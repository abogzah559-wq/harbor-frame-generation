//! Silent self-update for Harbor Frame Generation.
//!
//! The front end finds a newer GitHub release and calls `selfupdate_stage`:
//! the installer is downloaded in the background (progress goes out as
//! `selfupdate-progress`), its SHA-256 checked against the one GitHub
//! publishes, and a hidden helper waits for Harbor to exit and then runs the
//! installer silently. `selfupdate_install_now` exits Harbor right away and
//! has the helper start it again once the new version is installed.

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use std::path::PathBuf;
use tauri::Emitter;

/// Present while "Restart now" was chosen: the helper relaunches Harbor.
fn relaunch_marker() -> PathBuf {
    std::env::temp_dir().join("harbor-update").join("relaunch")
}

const ALLOWED_PREFIX: &str = "https://github.com/abogzah559-wq/harbor-frame-generation/releases/download/";

#[tauri::command]
pub async fn selfupdate_stage(app: tauri::AppHandle, url: String, sha256: Option<String>, tag: String) -> Result<String, String> {
    if !url.starts_with(ALLOWED_PREFIX) || !url.ends_with(".exe") {
        return Err("refusing an installer from outside this project's releases".into());
    }
    let safe_tag: String = tag.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '.').collect();
    let dir = std::env::temp_dir().join("harbor-update");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join(format!("Harbor-setup-{}.exe", safe_tag));
    let part = path.with_extension("part");

    let client = reqwest::Client::builder()
        .user_agent("HarborFrameGeneration-updater")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut stream = resp.bytes_stream();
    let mut done: u64 = 0;
    let mut last_pct: u64 = u64::MAX;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        let pct = if total > 0 { done * 100 / total } else { 0 };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit("selfupdate-progress", (done, total));
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    let got: String = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect();
    if let Some(want) = sha256.as_deref() {
        let want = want.trim_start_matches("sha256:").to_ascii_lowercase();
        if !want.is_empty() && want != got {
            let _ = tokio::fs::remove_file(&part).await;
            return Err("installer checksum mismatch".into());
        }
    }
    let _ = tokio::fs::remove_file(&path).await;
    tokio::fs::rename(&part, &path).await.map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let pid = std::process::id();
        let q = |p: &std::path::Path| p.to_string_lossy().replace('\'', "''");
        let exe = q(&path);
        let marker = q(&relaunch_marker());
        let app_exe = std::env::current_exe().map(|p| q(&p)).unwrap_or_default();
        let _ = std::fs::remove_file(relaunch_marker());
        // Wait for this Harbor to exit, install silently (/S), and start it
        // again if the update was installed with "Restart now".
        let script = format!(
            "Wait-Process -Id {pid} -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; \
             Start-Process -FilePath '{exe}' -ArgumentList '/S' -Wait; \
             if (Test-Path -LiteralPath '{marker}') {{ Remove-Item -LiteralPath '{marker}' -Force; \
             if ('{app_exe}' -ne '') {{ Start-Process -FilePath '{app_exe}' }} }}"
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", &script])
            // CREATE_NO_WINDOW | DETACHED_PROCESS
            .creation_flags(0x0800_0000 | 0x0000_0008)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

/// Install the staged update now: Harbor exits, the helper started by
/// `selfupdate_stage` installs it and opens Harbor again.
#[tauri::command]
pub fn selfupdate_install_now(app: tauri::AppHandle) -> Result<(), String> {
    let m = relaunch_marker();
    if let Some(dir) = m.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&m, b"1").map_err(|e| e.to_string())?;
    crate::shutdown_services(&app);
    app.exit(0);
    Ok(())
}
