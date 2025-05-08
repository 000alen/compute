import { ContainerAdapter, CreateRunOptions } from '@000alen/compute-types';
import { procedure, router } from './trpc.js';

interface CreateComputeRouterOptions {
  containerAdapter: ContainerAdapter;
}

export function createComputeRouter(options: CreateComputeRouterOptions) {
  const computeRouter = router({
    container: router({
      exec: procedure.mutation(async ({ input }) => { }),

      start: procedure.mutation(async ({ input }) => { }),

      stop: procedure.mutation(async ({ input }) => { }),

      remove: procedure.mutation(async ({ input }) => { }),

      inspect: procedure.query(async ({ input }) => { }),
    }),

    createRun: procedure
      .input(CreateRunOptions)
      .mutation(async ({ input: opts }) => { }),
  });

  return computeRouter;
}

// export type ComputeRouter = typeof computeRouter;
export type ComputeRouter = ReturnType<typeof createComputeRouter>;
