import 'react';

// CSS custom properties in style props (--tone, --fill…).
declare module 'react' {
  interface CSSProperties { [property: `--${string}`]: string | number | undefined }
}
