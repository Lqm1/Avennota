//! ポータブルexeはWebView2 Runtimeを同梱しないため、WebViewを作る前に不足を検出して案内する。

#[cfg(windows)]
pub fn ensure_runtime() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};

    if tauri::webview_version().is_ok() {
        return true;
    }

    let title = wide("Avennota");
    let message = wide(
        "Microsoft Edge WebView2 Runtime が見つからないため、Avennota を起動できません。\n\n\
         次のどちらかを行ってから、もう一度起動してください。\n\
         ・Avennota のインストーラー版を使う（不足している Runtime を自動で導入します）\n\
         ・Microsoft 公式の WebView2 Runtime をインストールする\n\
         https://developer.microsoft.com/microsoft-edge/webview2/",
    );
    // SAFETY: 両方の文字列はNUL終端したUTF-16で、呼び出し中は有効。親ウィンドウは持たない。
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
    false
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
pub fn ensure_runtime() -> bool {
    true
}
