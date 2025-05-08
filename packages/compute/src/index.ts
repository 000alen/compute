/*
 * Minimal open‑source re‑implementation of the experimental `@vercel/runs` API.
 * Focus: local or remote Docker host. The module exposes a single `createRun` factory
 * that returns a `Run` instance able to execute commands, stream logs, expose ports
 * and clean up afterwards.
 *
 * Dependencies (add to package.json):
 *   simple-git        – lightweight git client                       (MIT)
 *   dockerode         – Node JS Docker client                        (MIT)
 *   uuid              – cryptographically‑strong UUID generation     (MIT)
 *
 * $ npm i simple-git dockerode uuid
 */

import { CreateRunOptions } from "@000alen/compute-types";
import { DockerAdapter } from "@000alen/compute-docker-adapter";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Run } from "./runs.js";

export async function createRun(opts: CreateRunOptions): Promise<Run> {
  // 1. Prepare workspace
  const tmpDir = await mkdtemp(join(tmpdir(), "runws-"));

  // 2. Materialise source code ➜ tmpDir/workspace
  const workspace = join(tmpDir, "workspace");
  const containerAdapter = new DockerAdapter();
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

  return new Run(containerAdapter, container, tmpDir, portMap);
}
