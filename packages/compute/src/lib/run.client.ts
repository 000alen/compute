import { ExecOptions, ExecInfo } from "@000alen/compute-types";
import { TRPCClient } from "@trpc/client";
import type { ComputeRouter } from "../trpc/server.js";

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

  async inspect(): Promise<ExecInfo> {
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
   * Starts a command *without* waiting. Returns ExecInstance handle.
   */
  async exec(opts: ExecOptions): Promise<{ id: string, exec: ClientExecInstance, stream: ReadableStream }> {
    const self = this;

    let id: string | null = null;

    const promise = new Promise<{ id: string, exec: ClientExecInstance, stream: ReadableStream }>((resolve, reject) => {
      const stream = new ReadableStream({
        start(controller) {
          self.trpc.run.exec.subscribe(
            { ...opts, id: self.id },
            {
              onData({ type, chunk }) {
                if (type === "start") {
                  id = chunk;

                  if (!id) return reject(new Error("Exec ID not found"));

                  const exec = new ClientExecInstance(self.trpc, id);
                  resolve({ id, exec, stream });
                } else if (type === "data") {
                  controller.enqueue(chunk);
                }
              },
              onError(error) {
                controller.close();
                reject(error);
              },
              onStopped() {
                controller.close();

                if (!id) return reject(new Error("Exec ID not found"));
              },
            }
          );
        },
      });

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

  async download(path: string): Promise<ReadableStream> {
    const self = this;
    return new ReadableStream({
      start(controller) {
        self.trpc.download.subscribe(
          { path, id: self.id },
          {
            onData(chunk) {
              if (typeof chunk === "string") {
                const dataArray = new TextEncoder().encode(chunk);
                controller.enqueue(Buffer.from(dataArray));
              } else {
                controller.enqueue(Buffer.from(chunk.data));
              }
            },
            onStopped() {
              controller.close();
            },
          }
        );
      }
    })
  }
}
