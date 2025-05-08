import { ExecOptions, ExecInstance } from "@000alen/compute-types";
import { TRPCClient } from "@trpc/client";
import type { ComputeRouter } from "./trpc/server.js";

export class ClientExecInstance implements ExecInstance {
  private readonly trpc: TRPCClient<ComputeRouter>;
  public readonly id: string;

  constructor(
    trpc: TRPCClient<ComputeRouter>,
    id: string
  ) {
    this.trpc = trpc;
    this.id = id;
  }

  async start(opts: { hijack: boolean, stdin: boolean }): Promise<void> {
    return await this.trpc.run.execs.start.mutate({ id: this.id, ...opts });
  }

  async inspect(): Promise<{ ExitCode: number | null }> {
    return await this.trpc.run.execs.inspect.mutate({ id: this.id });
  }
}

export class ClientRun {
  private readonly trpc: TRPCClient<ComputeRouter>;
  public readonly id: string;

  constructor(
    trpc: TRPCClient<ComputeRouter>,
    id: string
  ) {
    this.trpc = trpc;
    this.id = id;
  }

  /**
   * Executes a command and *waits* for completion, resolving with exit code.
   */
  async execWait(opts: ExecOptions): Promise<number> {
    return await this.trpc.run.execWait.mutate({ ...opts, id: this.id });
  }

  /**
   * Starts a command *without* waiting. Returns ExecInstance handle.
   */
  async exec(opts: ExecOptions): Promise<ExecInstance> {
    const id = await this.trpc.run.exec.mutate({ ...opts, id: this.id });
    return new ClientExecInstance(this.trpc, id);
  }

  /**
   * Map container port → public URL (localhost) after publish.
   */
  async publicUrl(port: number): Promise<string> {
    return await this.trpc.run.publicUrl.mutate({ port, id: this.id });
  }

  /**
   * Stop & remove container, then wipe temp workspace.
   */
  async dispose(): Promise<void> {
    return await this.trpc.run.dispose.mutate({ id: this.id });
  }
}
