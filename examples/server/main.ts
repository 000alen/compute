import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createComputeRouter } from '@000alen/compute/trpc/server';
import { DockerAdapter } from '@000alen/compute-docker-adapter';

const containerAdapter = new DockerAdapter();

const router = createComputeRouter({ containerAdapter });

const server = createHTTPServer({ router });

server
  .listen(3000)
