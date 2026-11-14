/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The in-Claude demo (VITE_ROUTER=memory) is published as one HTML file, so it needs a single JS bundle.
const singleFile = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VITE_ROUTER === 'memory';

export default defineConfig({
  plugins: [react()],
  server: { host: true, proxy: { '/api': 'http://localhost:3001' } },
  build: singleFile ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {},
  test: { environment: 'node' },
});
