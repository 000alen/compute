import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createComputeRouter } from '@000alen/compute/trpc/server';
import { DockerAdapter } from '@000alen/compute-docker-adapter';
import debug from 'debug';

const log = debug('compute:server');
debug.enable('compute:*');

const containerAdapter = new DockerAdapter();

const router = createComputeRouter({ containerAdapter });

const server = createHTTPServer({
  router,
  middleware: async (req, res, next) => {
    log(req.url);

    next();
  }
});

server
  .listen(3000)
