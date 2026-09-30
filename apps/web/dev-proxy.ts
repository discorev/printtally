import type { ProxyOptions } from 'vite';

// The API accepts a request only when Origin (if sent) names the API itself (apps/server/src/access.ts).
// A page served by this dev server sends its own origin, so the proxy stands in for it; any other
// origin is passed through unchanged and still refused.
export function apiProxy(target: string): ProxyOptions {
  const origin = new URL(target).origin;
  return {
    target, changeOrigin: true,
    configure: proxy => proxy.on('proxyReq', (outgoing, incoming) => {
      if (incoming.headers.origin === 'http://' + incoming.headers.host) outgoing.setHeader('Origin', origin);
    }),
  };
}
