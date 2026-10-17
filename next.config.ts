import type { NextConfig } from 'next';
import { initializeRoutingSecret } from './lib/internal-routing';

initializeRoutingSecret();

/** docs/15. The real profile builds separately, into its own directory. */
const real = process.env.DATA_PROFILE === 'real';

const config: NextConfig = {
  // Runtime data is supplied separately, never copied by Next's file tracer. Build from
  // a clean tracked-file tree too: excludes are not a substitute for build isolation.
  outputFileTracingExcludes: {
    '*': ['data/**', '**/data/**', 'issues/inbox/**', '**/plcos-data/**'],
  },
  // PGlite ships a wasm bundle; it must stay outside the bundler and run in Node.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'tsx', 'esbuild'],
  typedRoutes: false,
  // Next appends its own block to CLAUDE.md otherwise. That file is the handoff for this
  // repo and is not Next's to edit.
  agentRules: false,
  // The floating dev badge sits on top of the user switcher in the rail.
  devIndicators: false,
  // Both servers can run at once — the demo for screenshots, the real one for work — and two
  // dev servers cannot share a build directory.
  // A production build of the real profile (npm run build:real, issue 0023) has its own directory
  // too, so it can be built while the development server runs.
  distDir: process.env.NEXT_DIST_DIR ?? (real ? '.next-real' : '.next'),
  /**
   * Both servers bind 0.0.0.0, so another computer on the same network can open them: the demo
   * from the start, the real one since 24 Sep 2026 (Juan: "I'm in a small private network so no
   * problem w/ exposing the port"). Next refuses cross-origin dev requests unless the origin is
   * listed, and a private LAN range is the only place either is served from — there is no
   * deployment. There is no sign-in either: anyone on that network can read and change the
   * real data.
   */
  experimental: {
    // A page fetched ahead of a click (components/ui/prefetch.ts) or just seen is shown from the browser's copy for
    // this long (seconds) when opened, rather than built again: tabs and back-and-forth answer at once. Next keeps a
    // prefetched page 5 minutes otherwise. A person's own change empties it (revalidatePath, router.refresh); a
    // colleague's or an agent's shows after at most this long (15–16 Oct 2026). GUESS: 30 s.
    staleTimes: { dynamic: 30, static: 30 },
  },
  allowedDevOrigins: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '*.local', 'localhost', '127.0.0.1'],
  /**
   * Framed only by itself and LabOS (scripts/kit-contract.ts holds that LabOS may frame it), never sniffed, and no full
   * address sent to another site (red team, 17 Oct 2026: approval buttons could be framed by any page).
   */
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://os.pl.xyz" },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};

export default config;
