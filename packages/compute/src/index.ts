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

import { CreateRunOptions as _CreateRunOptions } from "@000alen/compute-types";
import { createTRPCClient } from "./trpc/client.js";
import { ClientRun } from "./runs.client.js";

type CreateRunOptions = _CreateRunOptions & {
  apiUrl: string;
}

export async function createRun({ apiUrl, ...opts }: CreateRunOptions): Promise<ClientRun> {
  const trpc = createTRPCClient(apiUrl);
  const { id } = await trpc.createRun.mutate(opts);
  return new ClientRun(trpc, id);
}
