import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const db = openDb();
// Demo clinic DEMO42: on by default in development, off in production unless RISE_SEED=true.
const seedOn = process.env.RISE_SEED ? process.env.RISE_SEED === 'true' : process.env.NODE_ENV !== 'production';
if (seedOn) seed(db);
if (!process.env.RISE_SECRET) console.warn('RISE_SECRET is not set: clinic AI keys will be stored unencrypted.');
if (process.env.ANTHROPIC_API_KEY && !process.env.RISE_AI_CLINICS) console.warn('ANTHROPIC_API_KEY is set but RISE_AI_CLINICS is empty, so no clinic uses it. Set RISE_AI_CLINICS=DEMO42 (or *).');
const app = createApp(db);

// Serve the built web app in production.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(models|mediapipe)\//, (_req, res) => res.status(404).end());
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Myovia server on http://localhost:${port}`));
