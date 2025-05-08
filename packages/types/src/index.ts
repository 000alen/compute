import { z } from "zod";

export const GitSource = z.object({
  type: z.literal("git"),
  url: z.string(),
  ref: z.string().optional(),
  depth: z.number().optional(),
});
export type GitSource = z.infer<typeof GitSource>;

export const LocalTarSource = z.object({
  type: z.literal("tar"),
  path: z.string(),
});
export type LocalTarSource = z.infer<typeof LocalTarSource>;

export const Source = z.discriminatedUnion("type", [GitSource, LocalTarSource]);
export type Source = z.infer<typeof Source>;

export const CreateRunOptions = z.object({
  source: Source,
  runtime: z.union([z.literal("node22"), z.literal("node20"), z.literal("python312"), z.string()]),
  ports: z.array(z.number()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type CreateRunOptions = z.infer<typeof CreateRunOptions>;

export const ExecOptions = z.object({
  cmd: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  workdir: z.string().optional(),
});
export type ExecOptions = z.infer<typeof ExecOptions>;

export interface ContainerInstance {
  exec(options: {
    Cmd: string[];
    WorkingDir: string;
    Env: string[];
    AttachStdout: boolean;
    AttachStderr: boolean;
  }): Promise<ExecInstance>;

  start(): Promise<void>;
  stop(options?: { t: number }): Promise<void>;
  remove(options?: { force: boolean }): Promise<void>;
  inspect(): Promise<{ NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }> | undefined> } }>;
}

export interface ExecInstance {
  start(options: { hijack: boolean; stdin: boolean }): Promise<void>;
  inspect(): Promise<{ ExitCode: number | null }>;
}

// Source materialization interfaces
export interface SourceProvider {
  materializeSource(source: any, targetDir: string): Promise<void>;
}

export interface ContainerAdapter {
  createContainer(options: {
    Image: string;
    Cmd: string[];
    Tty: boolean;
    WorkingDir: string;
    Labels?: Record<string, string>;
    ExposedPorts?: Record<string, {}>;
    HostConfig?: {
      AutoRemove?: boolean;
      Binds?: string[];
      PortBindings?: Record<string, Array<{ HostPort: string }>>;
    };
  }): Promise<ContainerInstance>;

  getImage(name: string): { inspect(): Promise<any> };
  pull(imageName: string, options: {}, callback: (err: Error | null, stream?: NodeJS.ReadableStream) => void): void;
  modem: { followProgress(stream: NodeJS.ReadableStream, onFinished: (err: Error | null) => void): void };

  // Source materialization methods
  materializeSource(source: any, targetDir: string): Promise<void>;
  cloneGit(src: { url: string; ref?: string; depth?: number }, targetDir: string): Promise<void>;
  extractTar(tarPath: string, targetDir: string): Promise<void>;

  // Runtime methods
  ensureRuntimeImage(runtime: string): Promise<string>;
  pullIfMissing(ref: string): Promise<void>;
} 