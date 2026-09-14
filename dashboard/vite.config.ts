import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    // In dev il frontend usa URL relativi (/api/...): proxy verso il backend.
    proxy: {
      "/api": {
        target: "http://192.168.68.166:8000",
        changeOrigin: true,
      },
    },
  },
})
