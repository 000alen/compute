import { Client } from "@containers-js/containerd";
import {
  ContainerAdapter,
  ContainerInstance,
  ExecInstance,
  ExecInfo,
  CreateRunOptions,
  Source,
  ContainerConfig,
  ExecConfig,
  ExecStartOptions,
  RunResult,
  WorkspaceResult,
  PortMap,
  ExposedPorts,
  PortBindings,
  ContainerInfo
} from "@000alen/compute-types";
import { SimpleGit, simpleGit } from "simple-git";
import * as stream from "stream";
import * as fs from "fs";
import * as tar from "tar";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

export class ContainerdAdapter implements ContainerAdapter {
  private client: Client;

  constructor(options?: { socket?: string; namespace?: string }) {
    const socket = options?.socket || "/run/containerd/containerd.sock";
    const namespace = options?.namespace || "default";
    this.client = new Client(socket, namespace);
  }

  // ------------------------------
  // Container Management Methods
  // ------------------------------

  async createContainer(config: ContainerConfig): Promise<ContainerInstance> {
    const id = uuidv4();
    const containersService = this.client.containers;

    // Convert from Docker-style config to containerd-style
    const spec = {
      id,
      image: config.Image,
      snapshotter: "overlayfs",
      labels: config.Labels || {},
      // Note: containerd API differs from Docker, so we need to adapt
      // the configuration to match what containerd expects
    };

    const container = await containersService.create({
      container: {
        id: spec.id,
        image: spec.image,
        snapshotter: spec.snapshotter
      }
    });

    return new ContainerdContainerInstance(container, this.client, config.HostConfig?.PortBindings);
  }

  getImage(name: string) {
    const imagesService = this.client.images;

    return {
      async inspect() {
        return await imagesService.get({ name });
      }
    };
  }

  async pullImage(name: string, options: Record<string, never>): Promise<NodeJS.ReadableStream> {
    const imagesService = this.client.images;

    await imagesService.create({
      image: {
        name,
        labels: {}
      }
    });

    // Create a pass-through stream since containerd client doesn't return a stream
    const passThrough = new stream.PassThrough();
    passThrough.end();
    return passThrough;
  }

  get modem() {
    // This is a Docker-specific concept that doesn't exist in containerd
    // We implement a compatible interface
    return {
      followProgress: (stream: NodeJS.ReadableStream, onFinished: (err: Error | null) => void) => {
        // Since we already completed the pull operation synchronously in pullImage,
        // we just need to signal completion
        stream.on('end', () => {
          onFinished(null);
        });

        stream.on('error', (err) => {
          onFinished(err);
        });
      }
    };
  }

  // ------------------------------
  // Workspace Management Methods
  // ------------------------------

  async prepareWorkspace(): Promise<WorkspaceResult> {
    const tmpDir = await mkdtemp(join(tmpdir(), "runws-"));
    const workspace = join(tmpDir, "workspace");
    await fs.promises.mkdir(workspace, { recursive: true });
    return { workspace, tmpDir };
  }

  // ------------------------------
  // Source Management Methods
  // ------------------------------

  async materializeSource(source: Source, targetDir: string): Promise<void> {
    if (source.type === "git") {
      await this.cloneGit(source, targetDir);
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }
  }

  async cloneGit(src: { url: string; ref?: string; depth?: number }, targetDir: string): Promise<void> {
    const git: SimpleGit = simpleGit();
    await git.clone(src.url, targetDir, ["--depth", `${src.depth ?? 1}`]);
    if (src.ref) {
      await git.cwd(targetDir);
      await git.checkout(src.ref);
    }
  }

  // ------------------------------
  // Runtime/Image Management Methods
  // ------------------------------

  async ensureImage(runtime: string): Promise<string /*image id*/> {
    // For the demo we support only Node variants mapped to containerd "node:<ver>-slim" images.
    if (runtime.startsWith("node")) {
      const tag = runtime.replace(/^node/, ""); // "22" ➜ "22"
      const image = `docker.io/library/node:${tag}-slim`;
      await this.pullImageIfMissing(image);
      return image;
    }
    throw new Error(`Unsupported runtime ${runtime}`);
  }

  async pullImageIfMissing(ref: string): Promise<void> {
    try {
      await this.getImage(ref).inspect();
    } catch (_) {
      const stream = await this.pullImage(ref, {});

      await new Promise<void>((res, rej) => {
        this.modem.followProgress(stream, (e: Error | null) => e ? rej(e) : res());
      });
    }
  }

  // ------------------------------
  // High-level Operations
  // ------------------------------

  async createRun(options: CreateRunOptions): Promise<RunResult> {
    // 1. Prepare workspace
    const { workspace, tmpDir } = await this.prepareWorkspace();

    // 2. Materialize source code
    await this.materializeSource(options.source, workspace);

    // 3. Build or pull runtime image
    const image = await this.ensureImage(options.runtime);

    // 4. Configure container
    const containerConfig = this.createContainerConfig(options, image, workspace);

    // 5. Create and start container
    const container = await this.createContainer(containerConfig);
    await container.start();

    // 6. Get port mappings
    const portMap = await this.getPortMappings(container);

    return { container, tmpDir, portMap };
  }

  // ------------------------------
  // Helper Methods
  // ------------------------------

  private createContainerConfig(
    options: CreateRunOptions,
    image: string,
    workspace: string
  ): ContainerConfig {
    // Create port configurations
    const { exposedPorts, portBindings } = this.createPortConfig(options.ports ?? []);

    return {
      Image: image,
      Cmd: ["sleep", "86400"], // long-running idle process
      Tty: true,
      WorkingDir: "/workspace",
      Labels: options.labels,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        AutoRemove: true,
        Binds: [`${workspace}:/workspace`],
      },
    };
  }

  private createPortConfig(ports: number[]): {
    exposedPorts: ExposedPorts;
    portBindings: PortBindings;
  } {
    const exposedPorts: ExposedPorts = {};
    const portBindings: PortBindings = {};

    for (const p of ports) {
      const portKey = `${p}/tcp`;
      exposedPorts[portKey] = {};
      portBindings[portKey] = [{ HostPort: "0" }]; // 0 → random host port
    }

    return { exposedPorts, portBindings };
  }

  private async getPortMappings(container: ContainerInstance): Promise<PortMap> {
    const portMap: PortMap = {};
    const insp = await container.inspect();

    // In a real implementation, we would extract port mappings from the container inspection
    // For containerd, the port mapping mechanism differs from Docker
    // This is a simplistic implementation that would need to be expanded

    return portMap;
  }
}

export class ContainerdContainerInstance implements ContainerInstance {
  private container: any; // containerd container
  private client: Client;
  private portBindings?: PortBindings;

  constructor(container: any, client: Client, portBindings?: PortBindings) {
    this.container = container;
    this.client = client;
    this.portBindings = portBindings;
  }

  async exec(options: ExecConfig): Promise<ExecInstance> {
    // In containerd, we use the tasks API to run exec commands
    const task = await this.container.task();
    const execId = uuidv4();

    // The containerd API for exec is different, we adapt it to our interface
    const exec = await task.exec(execId, {
      args: options.Cmd,
      cwd: options.WorkingDir,
      env: options.Env,
      stdout: options.AttachStdout,
      stderr: options.AttachStderr,
    });

    return new ContainerdExecInstance(exec, execId, task);
  }

  async start(): Promise<void> {
    const task = await this.container.newTask({
      // Configure task with appropriate options
      // This would need to include volume mounts and network setup
    });
    await task.start();
  }

  async stop(options?: { t: number }): Promise<void> {
    const task = await this.container.task();
    const timeout = options?.t || 10;
    await task.kill('SIGTERM', { timeout });
  }

  async remove(options?: { force: boolean }): Promise<void> {
    const force = options?.force || false;
    if (force) {
      try {
        const task = await this.container.task();
        await task.kill('SIGKILL');
        await task.delete();
      } catch (e) {
        // Task might already be gone
      }
    }
    await this.container.delete();
  }

  async inspect(): Promise<ContainerInfo> {
    // Get container info from containerd
    const info = await this.container.get();

    // Convert to the ContainerInfo format expected by the interface
    // This is a simplified version, a real implementation would populate this properly
    return {
      NetworkSettings: {
        Ports: this.portBindings ?
          Object.entries(this.portBindings).reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
          }, {} as Record<string, Array<{ HostPort: string }> | undefined>) : {}
      }
    };
  }

  async download(srcPath: string): Promise<NodeJS.ReadableStream> {
    // Containerd doesn't have a direct container filesystem access API like Docker
    // A real implementation would need to use containerd's features or a side-car
    // For now, we create a mock stream
    const passThrough = new stream.PassThrough();
    passThrough.end(Buffer.from(''));
    return passThrough;
  }
}

export class ContainerdExecInstance implements ExecInstance {
  private exec: any; // containerd exec instance
  private execId: string;
  private task: any; // containerd task

  constructor(exec: any, execId: string, task: any) {
    this.exec = exec;
    this.execId = execId;
    this.task = task;
  }

  async start(options: ExecStartOptions): Promise<stream.Duplex> {
    // Start the exec process
    const io = await this.exec.start();

    // Create a duplex stream to interact with the process
    const duplex = new stream.Duplex({
      write(chunk, encoding, callback) {
        if (io.stdin) {
          io.stdin.write(chunk, encoding, callback);
        } else {
          callback();
        }
      },
      read(size) {
        // The read implementation needs to be connected to stdout/stderr
        // of the containerd process, but this is simplified here
      }
    });

    if (io.stdout) {
      io.stdout.on('data', (data: Buffer) => {
        duplex.push(data);
      });
    }

    if (io.stderr) {
      io.stderr.on('data', (data: Buffer) => {
        duplex.push(data);
      });
    }

    io.stdout?.on('end', () => {
      if (!io.stderr || io.stderr.ended) {
        duplex.push(null);
      }
    });

    io.stderr?.on('end', () => {
      if (!io.stdout || io.stdout.ended) {
        duplex.push(null);
      }
    });

    return duplex;
  }

  async inspect(): Promise<ExecInfo> {
    // Get the status of the exec process
    // Containerd doesn't have a direct equivalent of Docker's exec inspect
    // This is a simplified version to match the interface
    return {
      CanRemove: true,
      DetachKeys: "",
      ID: this.execId,
      Running: false, // Would need proper implementation
      ExitCode: 0, // Would need proper implementation
      ProcessConfig: {
        privileged: false,
        user: "",
        tty: false,
        entrypoint: "",
        arguments: [],
      },
      OpenStdin: false,
      OpenStderr: true,
      OpenStdout: true,
      ContainerID: this.task.id,
      Pid: 0, // Would need proper implementation
    };
  }
} 