/*
 * Minimal open‑source re‑implementation of the experimental `@vercel/runs` API.
 * Focus: local or remote Docker host. The module exposes a single `createRun` factory
 * that returns a `Run` instance able to execute commands, stream logs, expose ports
 * and clean up afterwards.
 *
 * Dependencies (add to package.json):
 *   simple-git        – lightweight git client                       (MIT)
 *   dockerode         – Node JS Docker client                        (MIT)
 *   uuid              – cryptographically‑strong UUID generation     (MIT)
 *
 * $ npm i simple-git dockerode uuid
 */

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import simpleGit, { SimpleGit } from "simple-git";
import Docker, { Container, Exec, ExecStartOptions } from "dockerode";
import { v4 as uuidv4 } from "uuid";

/**************************************
 *            Types / API             *
 **************************************/

export interface GitSource {
  type: "git";
  url: string;         // HTTPS/SSH URL
  ref?: string;        // optional branch/commit/tag
  depth?: number;      // shallow clone depth
}

export interface LocalTarSource {
  type: "tar";
  path: string;        // path to local *.tar, *.tar.gz, *.tgz, etc.
}

export type Source = GitSource | LocalTarSource;

export interface CreateRunOptions {
  source: Source;
  runtime: "node22" | "node20" | "python312" | string; // allow arbitrary
  /**
   * List of container ports that should be reachable on the host.
   * Each port will be published on an ephemeral host port.
   */
  ports?: number[];
  /**
   * Arbitrary labels that will be stored on the Docker container/image.
   */
  labels?: Record<string, string>;
}

export interface ExecOptions {
  cmd: string;          // executable inside the container
  args?: string[];      // arguments, default: []
  env?: Record<string, string>; // additional env vars
  workdir?: string;     // default: /workspace (see below)
}

/**************************************
 *              Run class             *
 **************************************/

export class Run {
  private readonly docker: Docker;
  private readonly container: Container;
  private readonly tmpDir: string;
  private readonly portMap: Record<number, number>; // container → host
  private cleaned = false;

  constructor(docker: Docker, container: Container, tmpDir: string, portMap: Record<number, number>) {
    this.docker = docker;
    this.container = container;
    this.tmpDir = tmpDir;
    this.portMap = portMap;
  }

  /**
   * Executes a command and *waits* for completion, resolving with exit code.
   */
  async execWait(opts: ExecOptions): Promise<number> {
    const exec = await this.createExec(opts);
    await exec.start({ hijack: true, stdin: false } as ExecStartOptions);
    const { ExitCode } = await exec.inspect();
    return ExitCode ?? -1;
  }

  /**
   * Starts a command *without* waiting. Returns Docker Exec handle.
   */
  async exec(opts: ExecOptions): Promise<Exec> {
    const exec = await this.createExec(opts);
    await exec.start({ hijack: true, stdin: false } as ExecStartOptions);
    return exec;
  }

  /**
   * Map container port → public URL (localhost) after publish.
   */
  publicUrl(port: number): string {
    const hostPort = this.portMap[port];
    if (!hostPort) throw new Error(`Port ${port} was not published`);
    return `http://localhost:${hostPort}`;
  }

  /**
   * Stop & remove container, then wipe temp workspace.
   */
  async dispose(): Promise<void> {
    if (this.cleaned) return;
    try {
      await this.container.stop({ t: 5 });
    } catch { }
    try {
      await this.container.remove({ force: true });
    } catch { }
    await rm(this.tmpDir, { recursive: true, force: true });
    this.cleaned = true;
  }

  /************ Internals ************/

  private async createExec({ cmd, args = [], env = {}, workdir = "/workspace" }: ExecOptions): Promise<Exec> {
    if (!cmd) throw new Error("ExecOptions.cmd is required");
    return this.container.exec({
      Cmd: [cmd, ...args],
      WorkingDir: workdir,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      AttachStdout: true,
      AttachStderr: true,
    });
  }
}

/**************************************
 *          Factory function          *
 **************************************/

export async function createRun(opts: CreateRunOptions): Promise<Run> {
  // 1. Prepare workspace
  const tmpDir = await mkdtemp(join(tmpdir(), "runws-"));

  // 2. Materialise source code ➜ tmpDir/workspace
  const workspace = join(tmpDir, "workspace");
  if (opts.source.type === "git") {
    await cloneGit(opts.source, workspace);
  } else {
    await extractTar(opts.source.path, workspace);
  }

  // 3. Build or pull runtime image
  const docker = new Docker();
  const image = await ensureRuntimeImage(docker, opts.runtime);

  // 4. Create container
  const portMap: Record<number, number> = {};
  const exposedPorts: Record<string, {}> = {};
  const hostConfig: Docker.ContainerCreateOptions["HostConfig"] = { PortBindings: {} };
  for (const p of opts.ports ?? []) {
    exposedPorts[`${p}/tcp`] = {};
    hostConfig.PortBindings![`${p}/tcp`] = [{ HostPort: "0" }]; // 0 ➜ random host port
  }

  const container = await docker.createContainer({
    Image: image,
    Cmd: ["sleep", "86400"], // long‑running idle process. Keep container alive, commands exec via Docker Exec.
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

  return new Run(docker, container, tmpDir, portMap);
}

/**************************************
 *           Helper routines          *
 **************************************/

async function cloneGit(src: GitSource, targetDir: string): Promise<void> {
  const git: SimpleGit = simpleGit();
  await git.clone(src.url, targetDir, ["--depth", `${src.depth ?? 1}`]);
  if (src.ref) {
    await git.cwd(targetDir);
    await git.checkout(src.ref);
  }
}

async function extractTar(tarPath: string, targetDir: string): Promise<void> {
  const { spawn } = await import("child_process");
  await new Promise<void>((res, rej) => {
    const p = spawn("tar", ["-xf", tarPath, "-C", targetDir]);
    p.on("exit", code => code === 0 ? res() : rej(new Error(`tar exited with ${code}`)));
  });
}

async function ensureRuntimeImage(docker: Docker, runtime: string): Promise<string /*image id*/> {
  // For the demo we support only Node variants mapped to Docker Hub "node:<ver>-slim" images.
  if (runtime.startsWith("node")) {
    const tag = runtime.replace(/^node/, ""); // "22" ➜ "22"
    const image = `node:${tag}-slim`;
    await pullIfMissing(docker, image);
    return image;
  }
  throw new Error(`Unsupported runtime ${runtime}`);
}

async function pullIfMissing(docker: Docker, ref: string): Promise<void> {
  try {
    await docker.getImage(ref).inspect();
  } catch (_) {
    await new Promise<void>((res, rej) => {
      docker.pull(ref, {}, (err, stream) => {
        if (err) return rej(err);
        docker.modem.followProgress(stream, (e) => e ? rej(e) : res());
      });
    });
  }
}

/**************************************
 *              Example               *
 **************************************/

if (require.main === module) {
  (async () => {
    const run = await createRun({
      source: {
        type: "git",
        url: "https://github.com/gudmundur/nextjs-boilerplate.git",
      },
      runtime: "node22",
      ports: [3000],
      labels: { "created-by": "runs.ts example" },
    });

    await run.execWait({ cmd: "npm", args: ["install"] });
    await run.exec({ cmd: "npm", args: ["run", "dev"] });
    console.log("App available at", run.publicUrl(3000));

    // Allow the dev server to run; press Ctrl+C to terminate.
    process.on("SIGINT", async () => {
      await run.dispose();
      process.exit(0);
    });
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
