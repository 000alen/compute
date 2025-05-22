import Docker from "dockerode";
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
import { pipeline } from "stream/promises";
import * as tar from "tar";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export class DockerAdapter implements ContainerAdapter {
  private docker: Docker;

  constructor(options?: Docker.DockerOptions) {
    this.docker = new Docker(options);
  }

  // ------------------------------
  // Container Management Methods
  // ------------------------------

  async createContainer(config: ContainerConfig): Promise<ContainerInstance> {
    const container = await this.docker.createContainer(config as Docker.ContainerCreateOptions);
    return new DockerContainerInstance(container);
  }

  getImage(name: string) {
    return this.docker.getImage(name);
  }

  async pullImage(name: string, options: Record<string, never>): Promise<NodeJS.ReadableStream> {
    return await this.docker.pull(name, options);
  }

  get modem() {
    return this.docker.modem as any;
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

  // This method is kept for backward compatibility but is not part of the interface
  async extractTar(tarPath: string, targetDir: string): Promise<void> {
    const { spawn } = await import("child_process");
    await new Promise<void>((res, rej) => {
      const p = spawn("tar", ["-xf", tarPath, "-C", targetDir]);
      p.on("exit", code => code === 0 ? res() : rej(new Error(`tar exited with ${code}`)));
    });
  }

  // ------------------------------
  // Runtime/Image Management Methods
  // ------------------------------

  async ensureImage(runtime: string): Promise<string /*image id*/> {
    // For the demo we support only Node variants mapped to Docker Hub "node:<ver>-slim" images.
    if (runtime.startsWith("node")) {
      const tag = runtime.replace(/^node/, ""); // "22" ➜ "22"
      const image = `node:${tag}-slim`;
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

    for (const [k, v] of Object.entries(insp.NetworkSettings.Ports ?? {})) {
      const containerPort = parseInt(k.split("/")[0], 10);
      const hostPort = v?.[0]?.HostPort ? parseInt(v[0].HostPort, 10) : undefined;
      if (hostPort) portMap[containerPort] = hostPort;
    }

    return portMap;
  }
}

export class DockerContainerInstance implements ContainerInstance {
  private container: Docker.Container;

  constructor(container: Docker.Container) {
    this.container = container;
  }

  async exec(options: ExecConfig): Promise<ExecInstance> {
    const dockerExec = await this.container.exec(options);
    return new DockerExecInstance(dockerExec);
  }

  start(): Promise<void> {
    return this.container.start();
  }

  stop(options?: { t: number }): Promise<void> {
    return this.container.stop(options);
  }

  remove(options?: { force: boolean }): Promise<void> {
    return this.container.remove(options);
  }

  inspect(): Promise<ContainerInfo> {
    return this.container.inspect();
  }

  async download(srcPath: string): Promise<NodeJS.ReadableStream> {
    // Docker will stream back a .tar containing srcPath.
    return this.container.getArchive({ path: srcPath });
  }

  // This method is kept for backward compatibility but is not part of the interface
  async copyToHost(srcPath: string, destPath: string): Promise<void> {
    // Ensure destination directory exists.
    await fs.promises.mkdir(destPath, { recursive: true });

    const tarStream = await this.download(srcPath);

    // Extract the tar stream into destPath.  `tar.x` handles
    // path sanitisation, so traversal attacks are avoided.
    // `cwd` is where the archive will be exploded.
    await pipeline(
      tarStream,
      tar.x({ cwd: destPath, strip: 0 })  // keep original layout
    );
  }
}

export class DockerExecInstance implements ExecInstance {
  private exec: Docker.Exec;

  constructor(exec: Docker.Exec) {
    this.exec = exec;
  }

  async start(options: ExecStartOptions): Promise<stream.Duplex> {
    const duplex = await this.exec.start(options);
    return duplex;
  }

  inspect(): Promise<ExecInfo> {
    return this.exec.inspect();
  }
} 