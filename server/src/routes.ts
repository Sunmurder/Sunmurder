import { Router, type Request, type Response } from 'express';
import type { EngineManager } from './engine-manager.js';
import type { ModuleDataRequest, CellWrite } from '../../shared/types.js';

export function createRouter(engines: EngineManager): Router {
  const router = Router();

  // ── Engines ──

  router.get('/engines', (_req: Request, res: Response) => {
    res.json(engines.list());
  });

  router.post('/engines/:engineId/connect', async (req: Request, res: Response) => {
    try {
      const adapter = engines.get(req.params.engineId);
      await adapter.connect(req.body);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: String(err) });
    }
  });

  // ── Workspaces ──

  router.get('/engines/:engineId/workspaces', async (req: Request, res: Response) => {
    try {
      const adapter = engines.get(req.params.engineId);
      const workspaces = await adapter.getWorkspaces();
      res.json(workspaces);
    } catch (err: unknown) {
      res.status(400).json({ error: String(err) });
    }
  });

  // ── Schema discovery ──

  router.get(
    '/engines/:engineId/workspaces/:wsId/schema',
    async (req: Request, res: Response) => {
      try {
        const adapter = engines.get(req.params.engineId);
        const schema = await adapter.getSchema(req.params.wsId);
        res.json(schema);
      } catch (err: unknown) {
        res.status(400).json({ error: String(err) });
      }
    },
  );

  // ── Dimension items (supports cascading via query params) ──

  router.get(
    '/engines/:engineId/workspaces/:wsId/dimensions/:dimId/items',
    async (req: Request, res: Response) => {
      try {
        const adapter = engines.get(req.params.engineId);
        const parentDimId = req.query.parentDimensionId as string | undefined;
        const parentItemIds = req.query.parentItemIds
          ? (req.query.parentItemIds as string).split(',')
          : undefined;

        const parentFilter =
          parentDimId && parentItemIds
            ? { dimensionId: parentDimId, itemIds: parentItemIds }
            : undefined;

        const items = await adapter.getDimensionItems(
          req.params.wsId,
          req.params.dimId,
          parentFilter,
        );
        res.json(items);
      } catch (err: unknown) {
        res.status(400).json({ error: String(err) });
      }
    },
  );

  // ── Module data ──

  router.get(
    '/engines/:engineId/workspaces/:wsId/modules/:moduleId/data',
    async (req: Request, res: Response) => {
      try {
        const adapter = engines.get(req.params.engineId);

        const request: ModuleDataRequest = {
          filters: req.query.filters ? JSON.parse(req.query.filters as string) : {},
          version: (req.query.version as string) || 'actual',
          lineItemId: req.query.lineItemId as string | undefined,
          page: req.query.page ? Number(req.query.page) : 1,
          pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
        };

        const data = await adapter.getModuleData(
          req.params.wsId,
          req.params.moduleId,
          request,
        );
        res.json(data);
      } catch (err: unknown) {
        res.status(400).json({ error: String(err) });
      }
    },
  );

  // ── Write-back ──

  router.post(
    '/engines/:engineId/workspaces/:wsId/modules/:moduleId/cells',
    async (req: Request, res: Response) => {
      try {
        const adapter = engines.get(req.params.engineId);
        const { version, cells } = req.body as {
          version: string;
          cells: CellWrite[];
        };

        const result = await adapter.writeCells(
          req.params.wsId,
          req.params.moduleId,
          version,
          cells,
        );
        res.json(result);
      } catch (err: unknown) {
        res.status(400).json({ error: String(err) });
      }
    },
  );

  return router;
}
