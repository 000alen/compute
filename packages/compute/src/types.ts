import { z } from "zod";

// export interface GitSource {
//   type: "git";
//   url: string;         // HTTPS/SSH URL
//   ref?: string;        // optional branch/commit/tag
//   depth?: number;      // shallow clone depth
// }

export const GitSource = z.object({
  type: z.literal("git"),
  url: z.string(),
  ref: z.string().optional(),
  depth: z.number().optional(),
});
export type GitSource = z.infer<typeof GitSource>;

// export interface LocalTarSource {
//   type: "tar";
//   path: string;        // path to local *.tar, *.tar.gz, *.tgz, etc.
// }

export const LocalTarSource = z.object({
  type: z.literal("tar"),
  path: z.string(),
});
export type LocalTarSource = z.infer<typeof LocalTarSource>;

// export type Source = GitSource | LocalTarSource;
export const Source = z.discriminatedUnion("type", [GitSource, LocalTarSource]);
export type Source = z.infer<typeof Source>;

// export interface CreateRunOptions {
//   source: Source;
//   runtime: "node22" | "node20" | "python312" | string; // allow arbitrary
//   /**
//    * List of container ports that should be reachable on the host.
//    * Each port will be published on an ephemeral host port.
//    */
//   ports?: number[];
//   /**
//    * Arbitrary labels that will be stored on the Docker container/image.
//    */
//   labels?: Record<string, string>;
// }

export const CreateRunOptions = z.object({
  source: Source,
  runtime: z.union([z.literal("node22"), z.literal("node20"), z.literal("python312"), z.string()]),
  ports: z.array(z.number()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type CreateRunOptions = z.infer<typeof CreateRunOptions>;

// export interface ExecOptions {
//   cmd: string;          // executable inside the container
//   args?: string[];      // arguments, default: []
//   env?: Record<string, string>; // additional env vars
//   workdir?: string;     // default: /workspace (see below)
// }
export const ExecOptions = z.object({
  cmd: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  workdir: z.string().optional(),
});
export type ExecOptions = z.infer<typeof ExecOptions>;
