//! Harbor Boost: built-in frame generation (RIFE, via VapourSynth inside mpv)
//! and GPU upscaling (FSR / NIS / CAS mpv shaders). No external program runs:
//! everything happens inside Harbor's own mpv.
//!
//! Runtime layout (downloaded on demand, ~60 MB + one model):
//!   %LOCALAPPDATA%\app.harbor\boost\
//!     vs\            embeddable Python 3.12 + VapourSynth wheel
//!     rife\          librife.dll + models\<model>\flownet.{bin,param}
//!     shaders\       FSR.glsl, NVScaler.glsl, CAS-scaled.glsl (+ generated variants)
//!     scripts\       generated .vpy

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const PY_URL: &str = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip";
const PY_PTH: &str = "python312._pth";
const VS_URL: &str =
    "https://github.com/vapoursynth/vapoursynth/releases/download/R79/VapourSynth64-Portable-R79.zip";
const RIFE_DLL_URL: &str =
    "https://github.com/styler00dollar/VapourSynth-RIFE-ncnn-Vulkan/releases/download/r9_mod_v33/librife_windows_x86-64.dll";
const RIFE_MODELS_BASE: &str =
    "https://raw.githubusercontent.com/styler00dollar/VapourSynth-RIFE-ncnn-Vulkan/c3ec6aabc07c8fa37a4f58d7fed9e2ad1fc1b13f/models";

/// (id used by the UI, plugin model index, folder name)
const MODELS: &[(&str, u32, &str)] = &[
    ("4.6", 23, "rife-v4.6_ensembleFalse"),
    ("4.22-lite", 65, "rife-v4.22_lite_ensembleFalse"),
    ("4.25-lite", 70, "rife-v4.25-lite_ensembleFalse"),
    ("4.26", 72, "rife-v4.26_ensembleFalse"),
];

/// (kind, url, file name, sharpness #define, maps UI 0..10 to the shader's own range)
const SHADERS: &[(&str, &str, &str, &str)] = &[
    (
        "FSR",
        "https://gist.github.com/agyild/82219c545228d70c5604f865ce0b0ce5/raw/2623d743b9c23f500ba086f05b385dcb1557e15d/FSR.glsl",
        "FSR.glsl",
        "SHARPNESS",
    ),
    (
        "NIS",
        "https://gist.github.com/agyild/7e8951915b2bf24526a9343d951db214/raw/05f00864228871ffd157daa9beb2db8fa7412cfa/NVScaler.glsl",
        "NVScaler.glsl",
        "SHARPNESS",
    ),
    (
        "CAS",
        "https://gist.github.com/agyild/bbb4e58298b2f86aa24da3032a0d2ee6/raw/10e4ca1b6ef173b64391ce2c81b9a95fcd095931/CAS-scaled.glsl",
        "CAS-scaled.glsl",
        "SHARPENING",
    ),
];

static PRIMED: Mutex<Option<Result<(), String>>> = Mutex::new(None);
static INSTALL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn root() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|p| PathBuf::from(p).join("app.harbor").join("boost"))
}

fn vs_dir(r: &Path) -> PathBuf {
    r.join("vs")
}
fn rife_dir(r: &Path) -> PathBuf {
    r.join("rife")
}
fn shader_dir(r: &Path) -> PathBuf {
    r.join("shaders")
}

fn find_vsscript(r: &Path) -> Option<PathBuf> {
    let p = vs_dir(r).join("Lib").join("site-packages").join("vapoursynth");
    let entries = std::fs::read_dir(&p).ok()?;
    for e in entries.flatten() {
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        if n == "vsscript.dll" {
            return Some(e.path());
        }
    }
    None
}

fn runtime_ready(r: &Path) -> bool {
    vs_dir(r).join("python.exe").is_file() && vs_dir(r).join("python3.dll").is_file() && find_vsscript(r).is_some()
}

fn model_entry(id: &str) -> &'static (&'static str, u32, &'static str) {
    MODELS.iter().find(|m| m.0 == id).unwrap_or(&MODELS[0])
}

fn model_ready(r: &Path, id: &str) -> bool {
    let m = model_entry(id);
    let d = rife_dir(r).join("models").join(m.2);
    d.join("flownet.bin").is_file() && d.join("flownet.param").is_file()
}

fn rife_ready(r: &Path) -> bool {
    rife_dir(r).join("librife.dll").is_file()
}

// ---------------------------------------------------------------------------
// VSScript priming (same approach Harbor uses for SVP's VapourSynth)
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn load_dll(p: &Path) -> Result<(), u32> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{LoadLibraryExW, LOAD_WITH_ALTERED_SEARCH_PATH};
    let w: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        LoadLibraryExW(PCWSTR(w.as_ptr()), None, LOAD_WITH_ALTERED_SEARCH_PATH)
            .map(|_| ())
            .map_err(|e| (e.code().0 as u32) & 0xffff)
    }
}

#[cfg(windows)]
fn crt_putenv(key: &str, value: &str) {
    use windows::core::{s, PCWSTR};
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    let entry: Vec<u16> = format!("{}={}", key, value).encode_utf16().chain(std::iter::once(0)).collect();
    for module in ["ucrtbase.dll\0", "msvcrt.dll\0"] {
        let mw: Vec<u16> = module.encode_utf16().collect();
        unsafe {
            let Ok(h) = GetModuleHandleW(PCWSTR(mw.as_ptr())) else { continue };
            if let Some(p) = GetProcAddress(h, s!("_wputenv")) {
                let f: unsafe extern "C" fn(*const u16) -> i32 = std::mem::transmute(p);
                let _ = f(entry.as_ptr());
            }
        }
    }
}

/// Point mpv's VapourSynth filter at Harbor's own runtime. Returns true when
/// the runtime is installed and was primed (then SVP's runtime is skipped).
pub fn prime_env() -> bool {
    let Some(r) = root() else { return false };
    if !runtime_ready(&r) {
        return false;
    }
    let result = prime_inner(&r);
    let ok = result.is_ok();
    if let Ok(mut g) = PRIMED.lock() {
        *g = Some(result);
    }
    ok
}

fn prime_inner(r: &Path) -> Result<(), String> {
    let vs = vs_dir(r);
    let script = find_vsscript(r).ok_or("VSScript.dll missing")?;
    let script_dir = script.parent().map(Path::to_path_buf).unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let mut add = Vec::new();
    for d in [&vs, &script_dir] {
        let s = d.to_string_lossy().into_owned();
        if !current.split(';').any(|p| p.eq_ignore_ascii_case(&s)) {
            add.push(s);
        }
    }
    if !add.is_empty() {
        std::env::set_var("PATH", format!("{};{}", add.join(";"), current));
    }
    let script_str = script.to_string_lossy().into_owned();
    std::env::set_var("VSSCRIPT_PATH", &script_str);
    #[cfg(windows)]
    {
        crt_putenv("VSSCRIPT_PATH", &script_str);
        for name in ["python3.dll", "python312.dll"] {
            let _ = load_dll(&vs.join(name));
        }
        let _ = load_dll(&script_dir.join("VapourSynth.dll"));
        load_dll(&script).map_err(|c| format!("VSScript.dll failed to load (0x{:x})", c))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    step: String,
    done: u64,
    total: u64,
}

async fn download(app: &tauri::AppHandle, client: &reqwest::Client, url: &str, dest: &Path, step: &str) -> Result<(), String> {
    use tauri::Emitter;
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("create {}: {e}", p.display()))?;
    }
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("{step}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{step}: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("part");
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("{step}: {e}"))? {
        buf.extend_from_slice(&chunk);
        let done = buf.len() as u64;
        if done - last > 512 * 1024 || done == total {
            last = done;
            let _ = app.emit("boost-progress", Progress { step: step.to_string(), done, total });
        }
    }
    if buf.is_empty() {
        return Err(format!("{step}: empty download"));
    }
    std::fs::write(&tmp, &buf).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, dest).map_err(|e| format!("move {}: {e}", dest.display()))
}

/// Extract a zip (or .whl) with Windows' built-in bsdtar.
fn extract(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|e| format!("create {}: {e}", into.display()))?;
    let mut cmd = std::process::Command::new("tar");
    cmd.arg("-xf").arg(archive).arg("-C").arg(into);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("tar: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "extract {}: {}",
            archive.display(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Harbor")
        .build()
        .map_err(|e| e.to_string())
}

async fn install_runtime(app: &tauri::AppHandle, r: &Path, c: &reqwest::Client) -> Result<(), String> {
    let vs = vs_dir(r);
    let dl = r.join("downloads");
    let py_zip = dl.join("python-embed.zip");
    let vs_zip = dl.join("vapoursynth-portable.zip");
    download(app, c, PY_URL, &py_zip, "Python").await?;
    download(app, c, VS_URL, &vs_zip, "VapourSynth").await?;
    let _ = std::fs::remove_dir_all(&vs);
    extract(&py_zip, &vs)?;
    // Let the embedded interpreter see site-packages.
    let pth = vs.join(PY_PTH);
    let mut text = std::fs::read_to_string(&pth).unwrap_or_default();
    if !text.lines().any(|l| l.trim() == "Lib\\site-packages") {
        if !text.ends_with('\n') && !text.is_empty() {
            text.push_str("\r\n");
        }
        text.push_str("Lib\\site-packages\r\n");
        std::fs::write(&pth, text).map_err(|e| format!("write {PY_PTH}: {e}"))?;
    }
    let staging = dl.join("vs-portable");
    let _ = std::fs::remove_dir_all(&staging);
    extract(&vs_zip, &staging)?;
    let wheel = std::fs::read_dir(staging.join("wheel"))
        .map_err(|_| "VapourSynth wheel not found in portable package".to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().map_or(false, |x| x.eq_ignore_ascii_case("whl")))
        .ok_or("VapourSynth wheel not found in portable package")?;
    // A wheel is a zip laid out for site-packages: installing = extracting.
    extract(&wheel, &vs.join("Lib").join("site-packages"))?;
    let _ = std::fs::remove_dir_all(&dl);
    if !runtime_ready(r) {
        return Err("VapourSynth runtime is incomplete after install".into());
    }
    Ok(())
}

async fn install_model(app: &tauri::AppHandle, r: &Path, c: &reqwest::Client, id: &str) -> Result<(), String> {
    let m = model_entry(id);
    let d = rife_dir(r).join("models").join(m.2);
    for f in ["flownet.param", "flownet.bin"] {
        let dest = d.join(f);
        if dest.is_file() {
            continue;
        }
        let url = format!("{}/{}/{}", RIFE_MODELS_BASE, m.2, f);
        download(app, c, &url, &dest, &format!("RIFE {}", m.0)).await?;
    }
    Ok(())
}

async fn install_shaders(app: &tauri::AppHandle, r: &Path, c: &reqwest::Client) -> Result<(), String> {
    for (_, url, file, _) in SHADERS {
        let dest = shader_dir(r).join(file);
        if dest.is_file() {
            continue;
        }
        download(app, c, url, &dest, "Shaders").await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostStatus {
    supported: bool,
    runtime: bool,
    rife: bool,
    models: Vec<String>,
    shaders: bool,
    primed: Option<bool>,
    prime_error: Option<String>,
}

#[tauri::command]
pub fn boost_status() -> BoostStatus {
    let Some(r) = root() else {
        return BoostStatus {
            supported: false,
            runtime: false,
            rife: false,
            models: vec![],
            shaders: false,
            primed: None,
            prime_error: None,
        };
    };
    let (primed, prime_error) = match PRIMED.lock().ok().and_then(|g| g.clone()) {
        Some(Ok(())) => (Some(true), None),
        Some(Err(e)) => (Some(false), Some(e)),
        None => (None, None),
    };
    BoostStatus {
        supported: cfg!(windows),
        runtime: runtime_ready(&r),
        rife: rife_ready(&r),
        models: MODELS.iter().filter(|m| model_ready(&r, m.0)).map(|m| m.0.to_string()).collect(),
        shaders: SHADERS.iter().all(|s| shader_dir(&r).join(s.2).is_file()),
        primed,
        prime_error,
    }
}

/// Download whatever is missing. `framegen` pulls VapourSynth + RIFE + model,
/// shaders are always fetched (a few hundred KB).
#[tauri::command]
pub async fn boost_install(app: tauri::AppHandle, framegen: bool, model: String) -> Result<BoostStatus, String> {
    let _g = INSTALL_LOCK.lock().await;
    let r = root().ok_or("LOCALAPPDATA is not set")?;
    let c = client()?;
    install_shaders(&app, &r, &c).await?;
    if framegen {
        if !runtime_ready(&r) {
            install_runtime(&app, &r, &c).await?;
        }
        if !rife_ready(&r) {
            download(&app, &c, RIFE_DLL_URL, &rife_dir(&r).join("librife.dll"), "RIFE").await?;
        }
        install_model(&app, &r, &c, &model).await?;
        let already = matches!(PRIMED.lock().ok().and_then(|g| g.clone()), Some(Ok(())));
        if !already {
            prime_env();
        }
    }
    Ok(boost_status())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FrameGenOpts {
    model: String,
    /// "fixed" | "adaptive"
    mode: String,
    multiplier: u32,
    target: u32,
    /// 25..100; below 75 RIFE runs its flow at half resolution (uhd mode).
    flow_scale: u32,
    scene_detect: bool,
    gpu_id: i32,
    gpu_threads: u32,
    /// Largest height RIFE works at (0 = source size). 4K is scaled down to
    /// this before interpolation and mpv scales the result back up.
    max_height: u32,
}

impl Default for FrameGenOpts {
    fn default() -> Self {
        Self {
            model: "4.6".into(),
            mode: "fixed".into(),
            multiplier: 2,
            target: 60,
            flow_scale: 100,
            scene_detect: true,
            gpu_id: -1,
            gpu_threads: 2,
            max_height: 0,
        }
    }
}

const VPY: &str = r#"import vapoursynth as vs
from fractions import Fraction
core = vs.core

try:
    core.std.LoadPlugin(r"__RIFE__")
except vs.Error as e:
    if "already loaded" not in str(e):
        raise

clip = video_in
src = container_fps if container_fps and container_fps > 1 else 23.976
disp = display_fps if display_fps and display_fps > 1 else 0

if "__MODE__" == "adaptive":
    tgt = __TARGET__ if __TARGET__ > 0 else (disp or src * 2)
    if disp:
        tgt = min(tgt, disp)
    fr = Fraction(tgt / src).limit_denominator(100)
else:
    fr = Fraction(__MULT__, 1)

if fr <= 1:
    clip.set_output()
else:
    orig = clip.format
    if orig.bits_per_sample > 8 and clip.height > 1100:
        matrix = "2020ncl"
    elif clip.height > 576:
        matrix = "709"
    else:
        matrix = "170m"
    mh = __MAXH__
    if mh > 0 and clip.height > mh:
        w = int(round(clip.width * mh / clip.height / 2)) * 2
        rgb = core.resize.Spline36(clip, width=w, height=mh, format=vs.RGBS, matrix_in_s=matrix)
    else:
        rgb = core.resize.Bicubic(clip, format=vs.RGBS, matrix_in_s=matrix)
    use_sc = False
    if __SC__:
        try:
            sc = core.misc.SCDetect(clip, threshold=0.12)
            rgb = core.std.CopyFrameProps(rgb, sc)
            use_sc = True
        except Exception:
            use_sc = False
    uhd = __UHD__ or rgb.width > 2560
    kw = dict(model=__MODEL__, factor_num=fr.numerator, factor_den=fr.denominator,
              gpu_thread=__THREADS__, uhd=uhd, sc=use_sc)
    if __GPU__ >= 0:
        kw["gpu_id"] = __GPU__
    out = core.rife.RIFE(rgb, **kw)
    out = core.resize.Bicubic(out, format=orig.id, matrix_s=matrix)
    out.set_output()
"#;

/// Write the frame-generation script and return its path for `vf=vapoursynth`.
#[tauri::command]
pub fn boost_framegen_script(opts: FrameGenOpts) -> Result<String, String> {
    let r = root().ok_or("LOCALAPPDATA is not set")?;
    if !runtime_ready(&r) || !rife_ready(&r) || !model_ready(&r, &opts.model) {
        return Err("Frame generation is not installed yet".into());
    }
    if let Some(Ok(())) = PRIMED.lock().ok().and_then(|g| g.clone()) {
    } else if !prime_env() {
        let msg = PRIMED
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .and_then(|r| r.err())
            .unwrap_or_else(|| "VapourSynth could not be loaded".into());
        return Err(msg);
    }
    let m = model_entry(&opts.model);
    let dll = rife_dir(&r).join("librife.dll");
    let script = VPY
        .replace("__RIFE__", &dll.to_string_lossy())
        .replace("__MODE__", if opts.mode == "adaptive" { "adaptive" } else { "fixed" })
        .replace("__TARGET__", &opts.target.clamp(0, 1000).to_string())
        .replace("__MULT__", &opts.multiplier.clamp(2, 8).to_string())
        .replace("__SC__", if opts.scene_detect { "True" } else { "False" })
        .replace("__UHD__", if opts.flow_scale < 75 { "True" } else { "False" })
        .replace("__MODEL__", &m.1.to_string())
        .replace("__THREADS__", &opts.gpu_threads.clamp(1, 8).to_string())
        .replace("__GPU__", &opts.gpu_id.clamp(-1, 16).to_string())
        .replace("__MAXH__", &max_height(opts.max_height).to_string());
    let dir = r.join("scripts");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    // Unique name per setting so mpv reloads the filter when options change.
    let mut h: u64 = 1469598103934665603;
    for b in script.bytes() {
        h = (h ^ b as u64).wrapping_mul(1099511628211);
    }
    let path = dir.join(format!("framegen-{:016x}.vpy", h));
    if !path.is_file() {
        std::fs::write(&path, script).map_err(|e| format!("write script: {e}"))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Only sensible caps reach the script: 0 (source size) or an even height >= 480.
fn max_height(h: u32) -> u32 {
    if h == 0 {
        0
    } else {
        (h.clamp(480, 4320) / 2) * 2
    }
}

/// Return a shader path for `kind` (FSR | NIS | CAS) with sharpness 0..10 baked in.
#[tauri::command]
pub fn boost_shader(kind: String, sharpness: u32) -> Result<String, String> {
    let r = root().ok_or("LOCALAPPDATA is not set")?;
    let (k, _, file, define) = SHADERS
        .iter()
        .find(|s| s.0.eq_ignore_ascii_case(&kind))
        .ok_or_else(|| format!("unknown shader {kind}"))?;
    let src_path = shader_dir(&r).join(file);
    let src = std::fs::read_to_string(&src_path).map_err(|_| "Upscaling shaders are not installed yet".to_string())?;
    let s = sharpness.min(10) as f64 / 10.0;
    // FSR's RCAS: 0.0 = sharpest .. 2.0 = softest. NIS / CAS: 0.0 .. 1.0 = sharpest.
    let value = if *k == "FSR" { 2.0 * (1.0 - s) } else { s };
    let text = replace_define(&src, define, &format!("{:.2}", value));
    let out = shader_dir(&r).join("gen").join(format!("{}-s{}.glsl", k, sharpness.min(10)));
    if let Some(p) = out.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("create {}: {e}", p.display()))?;
    }
    std::fs::write(&out, text).map_err(|e| format!("write shader: {e}"))?;
    Ok(out.to_string_lossy().into_owned())
}

fn replace_define(src: &str, name: &str, value: &str) -> String {
    let key = format!("#define {name} ");
    src.lines()
        .map(|l| {
            let t = l.trim_start();
            if t.starts_with(&key) {
                let rest = &t[key.len()..];
                let comment = rest.find("//").map(|i| &rest[i..]).unwrap_or("");
                format!("{key}{value} {comment}").trim_end().to_string()
            } else {
                l.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Append diagnostic lines (player/boost events) to boost\player-log.txt.
#[tauri::command]
pub fn boost_log(lines: Vec<String>) {
    let Some(r) = root() else { return };
    let _ = std::fs::create_dir_all(&r);
    let path = r.join("player-log.txt");
    if std::fs::metadata(&path).map(|m| m.len() > 2_000_000).unwrap_or(false) {
        let _ = std::fs::rename(&path, r.join("player-log.old.txt"));
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        for l in lines {
            let _ = writeln!(f, "{}", l);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn define_replace() {
        let src = "x\n#define SHARPNESS 0.2 // amount\ny";
        assert_eq!(replace_define(src, "SHARPNESS", "1.00"), "x\n#define SHARPNESS 1.00 // amount\ny");
    }

    #[test]
    fn script_template_has_no_placeholders_left() {
        let s = VPY
            .replace("__RIFE__", "C:\\x\\librife.dll")
            .replace("__MODE__", "fixed")
            .replace("__TARGET__", "60")
            .replace("__MULT__", "2")
            .replace("__SC__", "True")
            .replace("__UHD__", "False")
            .replace("__MODEL__", "23")
            .replace("__THREADS__", "2")
            .replace("__GPU__", "-1")
            .replace("__MAXH__", "1440");
        assert!(!s.contains("__"));
    }

    #[test]
    fn max_height_is_sane() {
        assert_eq!(max_height(0), 0);
        assert_eq!(max_height(1440), 1440);
        assert_eq!(max_height(1081), 1080);
        assert_eq!(max_height(100), 480);
    }
}
