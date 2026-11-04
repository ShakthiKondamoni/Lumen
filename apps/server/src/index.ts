import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.ts';
import { errorMapper, applyCoreMiddleware, type Deps, type Env } from './middleware.ts';
import { openDb, migrate } from './db/db.ts';
import { log, setLogLevel } from './core.ts';
import { loadMasterKey, RateLimiter } from './security.ts';
import { FileStorage } from './services/storage.ts';
import { JobRunner } from './services/jobs.ts';

export type { Deps, Env };
import { authRouter } from './routes/auth.ts';
import { settingsRouter } from './routes/settings.ts';
import { providersRouter } from './routes/providers.ts';
import { libraryRouter } from './routes/library.ts';
import { searchRouter } from './routes/search.ts';
import { jobsRouter } from './routes/jobs.ts';
import { chatRouter } from './routes/chat.ts';
import { notesRouter } from './routes/notes.ts';
import { reviewRouter } from './routes/review.ts';
import { quizRouter } from './routes/quiz.ts';
import { planRouter } from './routes/plan.ts';
import { miscRouter } from './routes/misc.ts';

export function buildApp(deps: Deps): Hono<Env> {
  const app = new Hono<Env>();
  applyCoreMiddleware(app, deps);

  app.route('/api', authRouter(deps));
  app.route('/api', settingsRouter(deps));
  app.route('/api', providersRouter(deps));
  app.route('/api', libraryRouter(deps));
  app.route('/api', searchRouter(deps));
  app.route('/api', jobsRouter(deps));
  app.route('/api', chatRouter(deps));
  app.route('/api', notesRouter(deps));
  app.route('/api', reviewRouter(deps));
  app.route('/api', quizRouter(deps));
  app.route('/api', planRouter(deps));
  app.route('/api', miscRouter(deps));

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }, 404));
  app.onError((err, c) => {
    const mapped = errorMapper(err);
    return c.json(mapped.body, mapped.status as 200);
  });
  return app;
}

export function startServer() {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const db = openDb(config.dbPath);
  const { applied } = migrate(db);
  if (applied.length > 0) log('info', 'db.migrated', { applied });
  const masterKey = loadMasterKey(config.secretKeyPath);
  const storage = new FileStorage(config.filesDir);
  const runner = new JobRunner(db, config, storage, 2);

  const deps: Deps = {
    config,
    db,
    masterKey,
    storage,
    runner,
    chatCancels: new Map(),
    authLimiter: new RateLimiter(60_000, 20),
  };

  const app = buildApp(deps);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
    log('info', 'server-ready', { port: info.port, dataDir: config.dataDir });
  });

  const shutdown = () => {
    log('info', 'server-stopping', {});
    runner.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, deps };
}
