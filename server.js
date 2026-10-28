'use strict';
const config = require('./src/config');
const { open } = require('./src/db');
const { createApp } = require('./src/app');

async function main() {
  const db = await open().ready(); // connects (and, for Supabase, applies supabase/schema.sql if needed)
  const app = createApp({ db });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`FlyCompare listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'}, database: ${db.kind === 'postgres' ? 'Supabase/PostgreSQL' : 'SQLite'})`);
  });
  function shutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    app.locals.close();
    server.close(() => { Promise.resolve(db.close()).catch(() => {}).then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
}
main().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
