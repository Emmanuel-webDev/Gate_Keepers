import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import { env } from './config';
import { HttpError } from './chain';
import { metadataDir } from './state';
import { info } from './routes/info';
import { faucet } from './routes/faucet';
import { tickets } from './routes/tickets';
import { verify } from './routes/verify';
import { bonds } from './routes/bonds';
import { organizer } from './routes/organizer';

fs.mkdirSync(metadataDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use('/metadata', express.static(metadataDir));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', info, faucet, tickets, verify, bonds, organizer);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Server error';
  if (status === 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(env.port, '0.0.0.0', () => console.log(`GateKeeper backend on :${env.port}  (public: ${env.publicUrl})`));
