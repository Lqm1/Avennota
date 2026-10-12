/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host =
  process.env.TAURI_DEV_HOST === "" ? undefined : process.env.TAURI_DEV_HOST;

export default defineConfig({
  // TanStack Routerのプラグインはreact()より前に置く。
  plugins: [
    tanstackRouter({ autoCodeSplitting: true, target: "react" }),
    react(),
    tailwindcss(),
  ],

  // Tauriのエラー表示を隠さず、Tauriが期待する固定ポートで起動する。
  clearScreen: false,
  optimizeDeps: {
    // WASMが参照するJSと同じインスタンスを使うため、事前バンドルしない。
    exclude: ["@shiro-rs/wasm"],
  },
  server: {
    hmr: host === undefined ? undefined : { host, port: 1421, protocol: "ws" },
    host: host ?? false,
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // デスクトップのChrome・EdgeとWebView2を対象にする。
    target: "es2023",
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
