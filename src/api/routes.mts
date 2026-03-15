import { Router, Request, Response } from 'express';
import { log, register } from '@eeveebot/libeevee';

const router = Router();

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'router',
  });
});

// Metrics endpoint
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});

// Default endpoint
router.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    message: 'eevee.bot Router API',
    timestamp: new Date().toISOString(),
  });
});

export default router;
