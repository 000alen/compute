import { ContainerAdapter, CreateRunOptions, ExecInstance, ExecOptions } from '@000alen/compute-types';
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { procedure, router } from './trpc.js';
import { Run } from "../runs.server.js";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
import { TRPCError } from '@trpc/server';
import { EventSource } from "eventsource";

globalThis.EventSource = EventSource;

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

    execWait: procedure
      .input(ExecOptions.extend({ id: z.string() }))
      .mutation(async ({ input }) => {
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

        return await run.execWait(opts);
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

    createRun: procedure
      .input(CreateRunOptions)
      .mutation(async ({ input: opts }) => {
        // 1. Prepare workspace
        const tmpDir = await mkdtemp(join(tmpdir(), "runws-"));

        // 2. Materialise source code ➜ tmpDir/workspace
        const workspace = join(tmpDir, "workspace");
        await containerAdapter.materializeSource(opts.source, workspace);

        // 3. Build or pull runtime image
        const image = await containerAdapter.ensureRuntimeImage(opts.runtime);

        // 4. Create container
        const portMap: Record<number, number> = {};
        const exposedPorts: Record<string, {}> = {};
        const hostConfig: { PortBindings?: Record<string, Array<{ HostPort: string }>> } = { PortBindings: {} };
        for (const p of opts.ports ?? []) {
          exposedPorts[`${p}/tcp`] = {};
          hostConfig.PortBindings![`${p}/tcp`] = [{ HostPort: "0" }]; // 0 ➜ random host port
        }

        const container = await containerAdapter.createContainer({
          Image: image,
          Cmd: ["sleep", "86400"], // long‑running idle process. Keep container alive, commands exec via Docker Exec.
          Tty: true,
          WorkingDir: "/workspace",
          Labels: opts.labels,
          ExposedPorts: exposedPorts,
          HostConfig: {
            ...hostConfig,
            AutoRemove: true,
            Binds: [`${workspace}:/workspace`],
          },
        });

        await container.start();

        // Retrieve host ports
        const insp = await container.inspect();
        for (const [k, v] of Object.entries(insp.NetworkSettings.Ports ?? {})) {
          const containerPort = parseInt(k.split("/")[0], 10);
          const hostPort = v?.[0]?.HostPort ? parseInt(v[0].HostPort, 10) : undefined;
          if (hostPort) portMap[containerPort] = hostPort;
        }

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

// export type ComputeRouter = typeof computeRouter;
export type ComputeRouter = ReturnType<typeof createComputeRouter>;
