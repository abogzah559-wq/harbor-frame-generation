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
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

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

    // Download in parallel pieces that survive a restart: a single stream
    // from GitHub is slow on many connections, and closing Harbor used to
    // throw away everything downloaded so far.
    let parallel = download_in_pieces(&app, &client, &url, &part).await;
    if let Err(e) = parallel {
        eprintln!("[selfupdate] parallel download unavailable ({e}), using one stream");
        download_single(&app, &client, &url, &part).await?;
    }

    let got = sha256_of_file(&part).await?;
    if let Some(want) = sha256.as_deref() {
        let want = want.trim_start_matches("sha256:").to_ascii_lowercase();
        if !want.is_empty() && want != got {
            let _ = tokio::fs::remove_file(&part).await;
            let _ = tokio::fs::remove_file(pieces_file(&part)).await;
            return Err("installer checksum mismatch".into());
        }
    }
    let _ = tokio::fs::remove_file(pieces_file(&part)).await;
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

const PIECE: u64 = 4 * 1024 * 1024;
const WORKERS: usize = 8;

fn pieces_file(part: &std::path::Path) -> PathBuf {
    part.with_extension("pieces")
}

/// Total size of the file behind `url`, if the server accepts byte ranges.
async fn ranged_size(client: &reqwest::Client, url: &str) -> Result<u64, String> {
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("no range support (HTTP {})", resp.status()));
    }
    let cr = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .ok_or("no content-range")?
        .to_string();
    cr.rsplit('/').next().and_then(|t| t.trim().parse::<u64>().ok()).filter(|n| *n > 0).ok_or_else(|| "bad content-range".into())
}

async fn download_in_pieces(app: &tauri::AppHandle, client: &reqwest::Client, url: &str, part: &std::path::Path) -> Result<(), String> {
    let total = ranged_size(client, url).await?;
    let count = total.div_ceil(PIECE);
    let record = pieces_file(part);

    // Pieces finished by an earlier run, kept only if the file has the same size.
    let mut done_set: BTreeSet<u64> = BTreeSet::new();
    let same_size = tokio::fs::metadata(part).await.map(|m| m.len() == total).unwrap_or(false);
    if same_size {
        if let Ok(txt) = tokio::fs::read_to_string(&record).await {
            if let Some((size, list)) = txt.split_once('\n') {
                if size.trim().parse::<u64>().ok() == Some(total) {
                    done_set.extend(list.split(',').filter_map(|x| x.trim().parse::<u64>().ok()).filter(|i| *i < count));
                }
            }
        }
    } else {
        let f = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
        f.set_len(total).await.map_err(|e| e.to_string())?;
        done_set.clear();
    }

    let done_bytes = Arc::new(AtomicU64::new(
        done_set.iter().map(|i| (total - i * PIECE).min(PIECE)).sum(),
    ));
    let todo: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new((0..count).rev().filter(|i| !done_set.contains(i)).collect()));
    let finished = Arc::new(Mutex::new(done_set));
    let record_lock = Arc::new(tokio::sync::Mutex::new(()));
    let _ = app.emit("selfupdate-progress", (done_bytes.load(Ordering::Relaxed), total));

    let mut tasks = Vec::new();
    for _ in 0..WORKERS {
        let client = client.clone();
        let url = url.to_string();
        let part = part.to_path_buf();
        let record = record.clone();
        let todo = todo.clone();
        let finished = finished.clone();
        let done_bytes = done_bytes.clone();
        let record_lock = record_lock.clone();
        let app = app.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                let Some(idx) = todo.lock().unwrap().pop() else { return Ok::<(), String>(()) };
                let start = idx * PIECE;
                let end = (start + PIECE).min(total) - 1;
                let mut attempt = 0;
                loop {
                    attempt += 1;
                    match fetch_piece(&client, &url, &part, start, end).await {
                        Ok(()) => break,
                        Err(e) if attempt < 4 => {
                            eprintln!("[selfupdate] piece {idx} failed ({e}), retrying");
                            tokio::time::sleep(std::time::Duration::from_millis(800 * attempt)).await;
                        }
                        Err(e) => return Err(e),
                    }
                }
                let now = done_bytes.fetch_add(end - start + 1, Ordering::Relaxed) + (end - start + 1);
                {
                    let _guard = record_lock.lock().await;
                    let line = {
                        let mut f = finished.lock().unwrap();
                        f.insert(idx);
                        format!("{total}\n{}", f.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(","))
                    };
                    let _ = tokio::fs::write(&record, line).await;
                }
                let _ = app.emit("selfupdate-progress", (now, total));
            }
        }));
    }
    for t in tasks {
        t.await.map_err(|e| e.to_string())??;
    }
    Ok(())
}

async fn fetch_piece(client: &reqwest::Client, url: &str, part: &std::path::Path, start: u64, end: u64) -> Result<(), String> {
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 != end - start + 1 {
        return Err("short piece".into());
    }
    let mut f = tokio::fs::OpenOptions::new().write(true).open(part).await.map_err(|e| e.to_string())?;
    f.seek(std::io::SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;
    f.write_all(&bytes).await.map_err(|e| e.to_string())?;
    f.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn download_single(app: &tauri::AppHandle, client: &reqwest::Client, url: &str, part: &std::path::Path) -> Result<(), String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(part).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut done: u64 = 0;
    let mut last_pct: u64 = u64::MAX;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        let pct = if total > 0 { done * 100 / total } else { 0 };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit("selfupdate-progress", (done, total));
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn sha256_of_file(path: &std::path::Path) -> Result<String, String> {
    let mut f = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}
