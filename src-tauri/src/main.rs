// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod webview_check;

fn main() {
    if !webview_check::ensure_runtime() {
        return;
    }
    avennota_lib::run()
}
