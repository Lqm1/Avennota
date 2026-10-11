use std::{
    path::{Path, PathBuf},
    process::Command,
};
use tauri_plugin_fs::FsExt;

fn allowed(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if app.fs_scope().is_allowed(path) {
        Ok(())
    } else {
        Err("選択したフォルダ・ファイルへのアクセスだけ許可されています。".into())
    }
}
#[tauri::command]
pub fn open_folder_manager(app: tauri::AppHandle, path: String) -> Result<(), String> {
    allowed(&app, Path::new(&path))?;
    if !Path::new(&path).is_dir() {
        return Err("フォルダがありません。".into());
    }
    #[cfg(windows)]
    let mut command = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command.arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn open_parent_folder(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let current = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    allowed(&app, &current)?;
    let parent = current.parent().ok_or("親フォルダがありません。")?;
    app.fs_scope()
        .allow_directory(parent, false)
        .map_err(|e| e.to_string())?;
    Ok(parent.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn configure_window(
    window: tauri::WebviewWindow,
    topmost: bool,
    opacity: f64,
) -> Result<(), String> {
    if !opacity.is_finite() || !(0.2..=1.0).contains(&opacity) {
        return Err("透過率が不正です。".into());
    }
    window
        .set_always_on_top(topmost)
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GWL_EXSTYLE, GetWindowLongW, LWA_ALPHA, SetLayeredWindowAttributes, SetWindowLongW,
            WS_EX_LAYERED,
        };
        let hwnd =
            window.hwnd().map_err(|e| e.to_string())?.0 as windows_sys::Win32::Foundation::HWND;
        // SAFETY: HWNDは呼び出し元の生存するウィンドウ。透過率を検証済み。
        unsafe {
            let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
            SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED as i32);
            if SetLayeredWindowAttributes(hwnd, 0, (opacity * 255.0).round() as u8, LWA_ALPHA) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
    }
    Ok(())
}
#[tauri::command]
pub fn write_document(app: tauri::AppHandle, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    allowed(&app, &target)?;
    if target.is_dir() {
        return Err("ファイルを選択してください。".into());
    }
    let backup = PathBuf::from(format!("{path}.bak"));
    let temporary = PathBuf::from(format!("{path}.avennota-tmp"));
    let before = if target.exists() {
        Some(std::fs::read(&target).map_err(|e| e.to_string())?)
    } else {
        None
    };
    if let Some(original) = &before {
        std::fs::write(&backup, original).map_err(|e| e.to_string())?;
    }
    let result = (|| {
        std::fs::write(&temporary, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
        if std::fs::read(&target).map_err(|e| e.to_string())? != bytes {
            return Err("書き出し結果が一致しません。".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
        let restored = match &before {
            Some(original) => std::fs::write(&target, original),
            None => {
                if target.exists() {
                    std::fs::remove_file(&target)
                } else {
                    Ok(())
                }
            }
        };
        if let Err(error) = restored {
            return Err(format!(
                "保存に失敗し、元の内容を復帰できません。.bakを確認してください: {error}"
            ));
        }
    }
    result
}
