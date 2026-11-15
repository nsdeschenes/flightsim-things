import {unplugin as stylex} from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import {tanstackRouter} from '@tanstack/router-plugin/vite';
import {defineConfig} from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: html =>
        html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
    stylex.vite({runtimeInjection: false}),
    tanstackRouter({target: 'react'}),
    react(),
  ],
  server: {host: '127.0.0.1', port: 5173, strictPort: true},
  build: {outDir: '../electron/dist/renderer', emptyOutDir: true},
});
