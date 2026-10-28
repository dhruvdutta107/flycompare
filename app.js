'use strict';

// Vercel detects this root Express entrypoint. The actual application requires an async DB
// initialization step, so initialize it lazily on the first request and cache it per instance.
// Until DATABASE_URL is added, use in-memory SQLite so the UI/API can boot for smoke tests;
// this fallback is temporary and does not persist data between function instances.
if (process.env.VERCEL && !process.env.DATABASE_URL && !process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = ':memory:';
}

const express = require('express');
const { open } = require('./src/db');
const { createApp } = require('./src/app');

const app = express();
let appPromise;

app.use((req, res, next) => {
  if (!appPromise) {
    appPromise = open().ready().then((db) => createApp({ db }));
  }
  appPromise
    .then((instance) => instance(req, res, next))
    .catch((err) => {
      console.error('[startup] FlyCompare initialization failed:', err && err.message);
      if (res.headersSent) return next(err);
      res.status(503).json({ error: 'service_unavailable', message: 'FlyCompare is starting or its database is not configured.' });
    });
});

module.exports = app;
