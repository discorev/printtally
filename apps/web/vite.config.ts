import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { apiProxy } from './dev-proxy.ts';

// The server the UI talks to. Same default port as `printtally serve`;
// override for a remote host or a server started on another port.
const apiTarget = process.env.PRINTTALLY_API ?? 'http://127.0.0.1:4318';

export default defineConfig({
  // One bundle: a lazily loaded route chunk can't be fetched once the server that serves the UI is lost.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: false }), react(), tailwindcss()],
  // A fixed IPv4 address and port: the desktop dev window loads exactly http://127.0.0.1:5173.
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': apiProxy(apiTarget) } },
});
