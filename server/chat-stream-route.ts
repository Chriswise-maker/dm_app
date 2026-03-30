import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { createContext } from './_core/context';
import { executeMessageSend } from './message-send';

const bodySchema = z.object({
  sessionId: z.number(),
  characterId: z.number(),
  message: z.string().min(1),
});

function writeSse(res: Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/chat/stream — SSE stream of DM narrative tokens (real LLM deltas).
 * Same auth as tRPC; body matches messages.send input.
 */
export function registerChatStreamRoute(app: Express) {
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const ctx = await createContext({ req, res } as any);
    if (!ctx.user) {
      writeSse(res, { type: 'error', message: 'Unauthorized' });
      res.end();
      return;
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      writeSse(res, { type: 'error', message: parsed.error.message });
      res.end();
      return;
    }

    try {
      const result = await executeMessageSend(
        ctx,
        parsed.data,
        {
          onNarrativeDelta: (text) => {
            if (text) writeSse(res, { type: 'token', text });
          },
        }
      );
      writeSse(res, {
        type: 'done',
        response: result.response,
        combatTriggered: result.combatTriggered,
        enemiesAdded: result.enemiesAdded,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      writeSse(res, { type: 'error', message });
    }
    res.end();
  });
}
