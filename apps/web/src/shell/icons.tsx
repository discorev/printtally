// The bottom nav's section icons (20px, 1.5 stroke).
const Icon = ({ children }: { children: React.ReactNode }) =>
  <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>{children}</svg>;

export const SECTION_ICONS = {
  jobs: <Icon><path d="M4 3h12v14H4z" /><path d="M7 7h6M7 10h6M7 13h4" /></Icon>,
  papers: <Icon><path d="M5 4h8l3 3v9H5z" /><path d="M13 4v3h3" /></Icon>,
  ink: <Icon><path d="M10 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z" /></Icon>,
  collect: <Icon><path d="M3 10a7 7 0 0 1 12-5l2 2" /><path d="M17 3v4h-4" /><path d="M17 10a7 7 0 0 1-12 5l-2-2" /><path d="M3 17v-4h4" /></Icon>,
  settings: <Icon><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></Icon>,
};
