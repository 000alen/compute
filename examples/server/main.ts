import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createComputeRouter } from '@000alen/compute/trpc/server';

const router = createComputeRouter();

const server = createHTTPServer({ router });

server.listen(3000);
