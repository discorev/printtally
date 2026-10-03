import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Bun's own HTTP/stream primitives must keep working in server and desktop tests, too.
// Happy DOM still supplies document, elements, events and the browser location.
const native = Object.getOwnPropertyDescriptors(globalThis);
GlobalRegistrator.register({ url: 'http://localhost:3000' });
for (const name of [
  'fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal',
  'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'ReadableStream',
  'WritableStream', 'TransformStream', 'TextEncoder', 'TextDecoder', 'WebSocket',
  'atob', 'btoa', 'crypto', 'performance', 'structuredClone', 'navigator', 'queueMicrotask',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
]) {
  if (native[name]) Object.defineProperty(globalThis, name, native[name]);
}
