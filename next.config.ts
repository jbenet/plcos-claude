import type { NextConfig } from 'next';

const config: NextConfig = {
  // PGlite ships a wasm bundle; it must stay outside the bundler and run in Node.
  serverExternalPackages: ['@electric-sql/pglite'],
  typedRoutes: false,
  // Next appends its own block to CLAUDE.md otherwise. That file is the handoff for this
  // repo and is not Next's to edit.
  agentRules: false,
  // The floating dev badge sits on top of the user switcher in the rail.
  devIndicators: false,
};

export default config;
