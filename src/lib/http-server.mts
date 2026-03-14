import express, { Application, Request, Response } from 'express';
import { log } from '@eeveebot/libeevee';
import apiRoutes from '../api/routes.mjs';

/**
 * Setup HTTP API server
 */
export function setupHttpServer(): void {
  const app: Application = express();
  const port = process.env.HTTP_API_PORT || '9001';

  // Middleware
  app.use(express.json());

  // API routes
  app.use('/api', apiRoutes);

  // Root endpoint
  app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
      message: 'eevee.bot Router API',
      timestamp: new Date().toISOString(),
    });
  });

  // Start server
  const server = app.listen(port, () => {
    log.info(`HTTP API server listening on port ${port}`);
  });

  // Handle server errors
  server.on('error', (err: Error) => {
    log.error('HTTP API server error', err);
  });
}
