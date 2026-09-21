import type { NextConfig } from 'next';

const config: NextConfig = {
  // PGlite ships a wasm bundle; it must stay outside the bundler and run in Node.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  typedRoutes: false,
  // Next appends its own block to CLAUDE.md otherwise. That file is the handoff for this
  // repo and is not Next's to edit.
  agentRules: false,
  // The floating dev badge sits on top of the user switcher in the rail.
  devIndicators: false,
  /**
   * `npm run dev` binds 0.0.0.0, so a phone or another laptop on the same network can open
   * it. Next refuses cross-origin dev requests unless the origin is listed, and a private
   * LAN range is the only place this is ever served from — there is no deployment.
   */
  allowedDevOrigins: [
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
    '*.local', 'localhost',
  ],
};

export default config;
