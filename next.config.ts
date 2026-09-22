import type { NextConfig } from 'next';

/** docs/15. The real profile builds separately and is served to this machine only. */
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
  distDir: real ? '.next-real' : '.next',
  /**
   * `npm run dev` binds 0.0.0.0, so a phone or another laptop on the same network can open
   * the demo. Next refuses cross-origin dev requests unless the origin is listed, and a
   * private LAN range is the only place it is ever served from — there is no deployment.
   *
   * `npm run dev:real` binds 127.0.0.1, so nothing else on the network can reach it, and
   * accepts only this machine's own names for itself.
   */
  allowedDevOrigins: real
    ? ['127.0.0.1', 'localhost']
    : ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '*.local', 'localhost', '127.0.0.1'],
};

export default config;
