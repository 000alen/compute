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
