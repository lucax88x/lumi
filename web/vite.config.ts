import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.LUMI_DEV_UI_PORT || 5173),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.LUMI_DEV_API_PORT || 8080}`, '/auth': `http://127.0.0.1:${process.env.LUMI_DEV_API_PORT || 8080}`, '/keycloak': { target: 'http://127.0.0.1:19090', xfwd: true } },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
