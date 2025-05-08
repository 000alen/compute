import { rm } from "fs/promises";
import Docker, { Container, Exec, ExecStartOptions } from "dockerode";
import { ExecOptions } from "./types";

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
