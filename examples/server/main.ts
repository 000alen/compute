import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { computeRouter } from '@000alen/compute/trpc/server';

const server = createHTTPServer({
  router: computeRouter,
});

server.listen(3000);
