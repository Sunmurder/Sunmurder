import express from 'express';
import cors from 'cors';
import { EngineManager } from './engine-manager.js';
import { createRouter } from './routes.js';
import { MockAdapter } from './adapters/mock-adapter.js';
import { AnaplanAdapter } from './adapters/anaplan-adapter.js';

const PORT = Number(process.env.PORT) || 3001;

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── Register engine adapters ──
  const engines = new EngineManager();

  const mock = new MockAdapter();
  await mock.connect();
  engines.register(mock);

  const anaplan = new AnaplanAdapter();
  engines.register(anaplan);
  // Anaplan connects lazily when the user calls POST /api/engines/anaplan/connect

  // ── Mount API ──
  app.use('/api', createRouter(engines));

  app.listen(PORT, () => {
    console.log(`Planning API server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
