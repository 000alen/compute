import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { ComputeRouter } from './server.js';

export const trpc = createTRPCClient<ComputeRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000',
    }),
  ],
});
