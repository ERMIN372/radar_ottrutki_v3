import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 — нативный модуль, бандлить его нельзя.
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
