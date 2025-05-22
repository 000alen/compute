import { ContainerAdapter, CreateRunOptions, ExecInstance, ExecOptions } from '@000alen/compute-types';
import { procedure, router } from './trpc.js';
import { Run } from "../lib/run.js";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
import { TRPCError } from '@trpc/server';
import { EventSource } from "eventsource";

if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = EventSource as any;
}

interface CreateComputeRouterOptions {
  containerAdapter: ContainerAdapter;
}

interface CreateRunRouterOptions {
  runs: Map<string, Run>;
}

const runs = new Map<string, Run>();
const execs = new Map<string, ExecInstance>();

export function createRunRouter(options: CreateRunRouterOptions) {
  const runRouter = router({
    execs: router({
      start: procedure
        .input(
          z.object({
            id: z.string(),
            hijack: z.boolean(),
            stdin: z.boolean(),
          })
        )
        .subscription(async function* ({ input }) {
          const { id, ...opts } = input;

          if (!execs.has(id))
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Exec ${id} not found`
            });

          const exec = execs.get(id);
          if (!exec)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Exec ${id} not found`
            });

          const duplex = await exec.start(opts);

          for await (const part of duplex) {
            const buffer = part as Buffer;
            const value = buffer.toString("utf-8");
            yield { type: "data", chunk: value };
          }

          return;
        }),

      inspect: procedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input }) => {
          const { id } = input;

          if (!execs.has(id))
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Exec ${id} not found`
            });

          const exec = execs.get(id);
          if (!exec)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Exec ${id} not found`
            });

          return await exec.inspect();
        }),
    }),

    exec: procedure
      .input(ExecOptions.extend({ id: z.string() }))
      .subscription(async function* ({ input }) {
        const { id, ...opts } = input;

        if (!options.runs.has(id))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Run ${id} not found`
          });

        const run = options.runs.get(id);
        if (!run)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Run ${id} not found`
          });

        const execId = uuidv4();
        const { exec, duplex } = await run.exec(opts);
        execs.set(execId, exec);

        yield { type: "start", chunk: execId }

        for await (const part of duplex) {
          const value = part.toString("utf-8");
          yield { type: "data", chunk: value };
        }

        return;
      }),

    publicUrl: procedure
      .input(z.object({ port: z.number(), id: z.string() }))
      .mutation(async ({ input }) => {
        const { id, port } = input;

        if (!options.runs.has(id))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Run ${id} not found`
          });

        const run = options.runs.get(id);
        if (!run)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Run ${id} not found`
          });

        return await run.publicUrl(port);
      }),

    dispose: procedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        const { id } = input;

        if (!options.runs.has(id))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Run ${id} not found`
          });

        const run = options.runs.get(id);
        if (!run)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Run ${id} not found`
          });

        await run.dispose();
        options.runs.delete(id);
      }),
  });

  return runRouter;
}

export function createComputeRouter(options: CreateComputeRouterOptions) {
  const { containerAdapter } = options;

  const runRouter = createRunRouter({ runs });

  const computeRouter = router({
    run: runRouter,

    download: procedure
      .input(
        z.object({
          id: z.string(),
          path: z.string()
        })
      )
      .subscription(async function* ({ input }) {
        const { path, id } = input;

        const run = runs.get(id);
        if (!run)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Run ${id} not found`
          });

        const stream = await run.container.download(path)

        yield* stream;

      }),

    createRun: procedure
      .input(CreateRunOptions)
      .mutation(async ({ input: opts }) => {
        // Delegate container creation to the adapter
        const { container, tmpDir, portMap } = await containerAdapter.createRun(opts);

        // Create and store the run
        const id = uuidv4();
        const run = new Run(container, tmpDir, portMap);
        runs.set(id, run);

        return {
          id,
          tmpDir,
          portMap,
        }
      }),
  });

  return computeRouter;
}

export type ComputeRouter = ReturnType<typeof createComputeRouter>;
