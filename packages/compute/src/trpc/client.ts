import { createTRPCClient as _createTRPCClient, httpBatchLink } from '@trpc/client';
import type { ComputeRouter } from './server.js';

export function createTRPCClient(url: string) {
  const trpc = _createTRPCClient<ComputeRouter>({
    links: [
      httpBatchLink({ url: url }),
    ],
  });

  return trpc;
}
