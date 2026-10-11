import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@shared": path.resolve(__dirname, "../../shared") } },
  server: { port: 5173, fs: { allow: [path.resolve(__dirname, "../..")] } },
});
