import { ExecOptions, DockerExecInspectInfo } from "@000alen/compute-types";
import { TRPCClient } from "@trpc/client";
import type { ComputeRouter } from "./trpc/server.js";

export class ClientExecInstance {
  private readonly trpc: TRPCClient<ComputeRouter>;
  public readonly id: string;

  constructor(
    trpc: TRPCClient<ComputeRouter>,
    id: string
  ) {
    this.trpc = trpc;
    this.id = id;
  }

  async start(opts: { hijack: boolean, stdin: boolean }): Promise<{ data: string }> {
    const self = this;

    let data: string = "";
    const promise = new Promise<{ data: string }>((resolve, reject) => {
      this.trpc.run.execs.start.subscribe(
        { id: this.id, ...opts },
        {
          onData({ type, chunk }) {
            if (type === "data") {
              data += chunk;
            }
          },
          onError(error) {
            reject(error);
          },
          onStopped() {
            resolve({ data });
          }
        }
      );

    });

    return await promise;
  }

  async inspect(): Promise<DockerExecInspectInfo> {
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
  async exec(opts: ExecOptions): Promise<{ id: string, exec: ClientExecInstance, data: string }> {
    const self = this;

    let execId: string | null = null;
    let data: string = "";

    const promise = new Promise<{ id: string, exec: ClientExecInstance, data: string }>((resolve, reject) => {
      this.trpc.run.exec.subscribe(
        { ...opts, id: this.id },
        {
          onData({ type, chunk }) {
            if (type === "start") {
              execId = chunk;
            } else if (type === "data") {
              data += chunk;
            }
          },
          onError(error) {
            reject(error);
          },
          onStopped() {
            if (!execId) return reject(new Error("Exec ID not found"));

            resolve({
              id: execId,
              exec: new ClientExecInstance(self.trpc, execId),
              data
            });
          },
        }
      );

    });

    return await promise;
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
