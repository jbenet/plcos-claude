import type { NextConfig } from 'next';

/** docs/15. The real profile builds separately, into its own directory. */
const real = process.env.DATA_PROFILE === 'real';

const config: NextConfig = {
  // PGlite ships a wasm bundle; it must stay outside the bundler and run in Node.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
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
  allowedDevOrigins: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '*.local', 'localhost', '127.0.0.1'],
};

export default config;
