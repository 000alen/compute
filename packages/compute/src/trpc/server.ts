import { procedure, router } from './trpc.js';

export const computeRouter = router({
  container: router({
    exec: procedure.mutation(async ({ input }) => { }),

    start: procedure.mutation(async ({ input }) => { }),

    stop: procedure.mutation(async ({ input }) => { }),

    remove: procedure.mutation(async ({ input }) => { }),

    inspect: procedure.query(async ({ input }) => { }),
  }),

  createContainer: procedure.mutation(async ({ input }) => { }),
});

export type ComputeRouter = typeof computeRouter;
