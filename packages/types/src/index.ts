import { z } from "zod";
import * as stream from "stream";

//---------------------------------------------
// Source Types
//---------------------------------------------

/**
 * Represents a Git source for code
 */
export const GitSource = z.object({
  type: z.literal("git"),
  url: z.string(),
  ref: z.string().optional(),
  depth: z.number().optional(),
});
export type GitSource = z.infer<typeof GitSource>;

// Commented code for LocalTarSource for future reference

export const Source = GitSource;
export type Source = z.infer<typeof Source>;

//---------------------------------------------
// Container Types
//---------------------------------------------

/**
 * Port mapping types
 */
export type PortMap = Record<number, number>;
export type ExposedPorts = Record<string, Record<string, never>>;
export type PortBindings = Record<string, Array<{ HostPort: string }>>;

/**
 * Container configuration
 */
export interface ContainerConfig {
  Image: string;
  Cmd: string[];
  Tty: boolean;
  WorkingDir: string;
  Labels?: Record<string, string>;
  ExposedPorts?: ExposedPorts;
  HostConfig?: {
    AutoRemove?: boolean;
    Binds?: string[];
    PortBindings?: PortBindings;
  };
}

/**
 * Network settings from container inspection
 */
export interface NetworkSettings {
  Ports: Record<string, Array<{ HostPort: string }> | undefined>;
}

/**
 * Container inspection info
 */
export interface ContainerInfo {
  NetworkSettings: NetworkSettings;
}

/**
 * Represents a container instance
 */
export interface ContainerInstance {
  /**
   * Creates an exec instance for running commands inside the container
   */
  exec(options: ExecConfig): Promise<ExecInstance>;

  /**
   * Starts the container
   */
  start(): Promise<void>;

  /**
   * Stops the container
   */
  stop(options?: { t: number }): Promise<void>;

  /**
   * Removes the container
   */
  remove(options?: { force: boolean }): Promise<void>;

  /**
   * Inspects the container
   */
  inspect(): Promise<ContainerInfo>;

  /**
   * Returns a tar stream containing files from the container
   * @param srcPath Path inside the container
   */
  download(srcPath: string): Promise<NodeJS.ReadableStream>;
}

//---------------------------------------------
// Execution Types
//---------------------------------------------

/**
 * Options for creating a new run
 */
export const CreateRunOptions = z.object({
  /** Source code to execute */
  source: Source,
  /** Runtime environment to use */
  runtime: z.union([
    z.literal("node22"),
    z.literal("node20"),
    z.literal("python312"),
    z.string()
  ]),
  /** Ports to expose from the container */
  ports: z.number().array().optional(),
  /** Labels to apply to the container */
  labels: z.record(z.string()).optional(),
});
export type CreateRunOptions = z.infer<typeof CreateRunOptions>;

/**
 * Result of creating a run
 */
export interface RunResult {
  container: ContainerInstance;
  tmpDir: string;
  portMap: PortMap;
}

/**
 * Options for executing a command in a container
 */
export const ExecOptions = z.object({
  /** Command to execute */
  cmd: z.string(),
  /** Command arguments */
  args: z.string().array().optional(),
  /** Environment variables */
  env: z.record(z.string()).optional(),
  /** Working directory */
  workdir: z.string().optional(),
});
export type ExecOptions = z.infer<typeof ExecOptions>;

/**
 * Configuration for executing a command
 */
export interface ExecConfig {
  Cmd: string[];
  WorkingDir: string;
  Env: string[];
  AttachStdout: boolean;
  AttachStderr: boolean;
}

/**
 * Options for starting an exec instance
 */
export interface ExecStartOptions {
  hijack: boolean;
  stdin: boolean;
}

/**
 * Information about an exec instance
 */
export interface ExecInfo {
  CanRemove: boolean;
  DetachKeys: string;
  ID: string;
  Running: boolean;
  ExitCode: number | null;
  ProcessConfig: {
    privileged: boolean;
    user: string;
    tty: boolean;
    entrypoint: string;
    arguments: string[];
  };
  OpenStdin: boolean;
  OpenStderr: boolean;
  OpenStdout: boolean;
  ContainerID: string;
  Pid: number;
}

/**
 * Represents an execution instance within a container
 */
export interface ExecInstance {
  /**
   * Starts the execution instance
   * @param options Options for starting the execution
   */
  start(options: ExecStartOptions): Promise<stream.Duplex>;

  /**
   * Inspects the execution instance
   */
  inspect(): Promise<ExecInfo>;
}

//---------------------------------------------
// Workspace Types
//---------------------------------------------

/**
 * Result of preparing a workspace
 */
export interface WorkspaceResult {
  workspace: string;
  tmpDir: string;
}

//---------------------------------------------
// Adapter Interface
//---------------------------------------------

/**
 * ContainerAdapter provides an abstraction for container-based runtime environments
 */
export interface ContainerAdapter {
  // Container Management
  /**
   * Creates a container with the given configuration
   */
  createContainer(config: ContainerConfig): Promise<ContainerInstance>;

  // Image Management
  /**
   * Gets an image by name
   */
  getImage(name: string): { inspect(): Promise<unknown> };

  /**
   * Pulls an image from a registry
   */
  pullImage(name: string, options: Record<string, never>): Promise<NodeJS.ReadableStream>;

  /**
   * Ensures an image exists, pulling it if necessary
   */
  ensureImage(name: string): Promise<string>;

  /**
   * Pulls an image if it's not already present
   */
  pullImageIfMissing(ref: string): Promise<void>;

  // Workspace Management
  /**
   * Prepares a workspace for a run
   */
  prepareWorkspace(): Promise<WorkspaceResult>;

  // Source Management
  /**
   * Materializes source code in the target directory
   */
  materializeSource(source: Source, targetDir: string): Promise<void>;

  /**
   * Clones a git repository to the target directory
   */
  cloneGit(src: GitSource, targetDir: string): Promise<void>;

  // High-level Operations
  /**
   * Creates a run with the given options
   */
  createRun(options: CreateRunOptions): Promise<RunResult>;
} 