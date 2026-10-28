'use strict';
const config = require('./src/config');
const { open } = require('./src/db');
const { createApp } = require('./src/app');

const db = open();
const app = createApp({ db });
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`FlyCompare listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => { try { db.close(); } catch { /* ignore */ } process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
