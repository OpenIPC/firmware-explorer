import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match the gh-pages subpath (https://openipc.github.io/firmware-explorer/)
export default defineConfig({
  base: "/firmware-explorer/",
  plugins: [react()],
});
