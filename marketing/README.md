# Print Tally marketing site
Static site for https://printtally.ink. Point Vercel at this folder with Root Directory set to `marketing` and no build command.
Vercel only builds when something under `marketing/` changed since the branch's last deployment (`ignoreCommand` in `vercel.json`); other commits show as Canceled.
Domains: printtally.ink is primary; ptly.ink, www.ptly.ink and www.printtally.ink redirect to it (see `vercel.json`).
The Download for Mac buttons resolve the newest `app-v*` GitHub release (the one with a `.dmg`) at runtime, and fall back to the releases page.
Fonts (Public Sans, Zilla Slab) are self-hosted in `fonts/` under the SIL OFL.
