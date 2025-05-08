import Docker from "dockerode";
import { ContainerAdapter, ContainerInstance, ExecInstance } from "@000alen/compute-types";
import { SimpleGit, simpleGit } from "simple-git";

export class DockerAdapter implements ContainerAdapter {
  private docker: Docker;

  constructor(options?: Docker.DockerOptions) {
    this.docker = new Docker(options);
  }

  async createContainer(options: Docker.ContainerCreateOptions): Promise<ContainerInstance> {
    const container = await this.docker.createContainer(options);
    return new DockerContainerInstance(container);
  }

  getImage(name: string) {
    return this.docker.getImage(name);
  }

  pull(imageName: string, options: {}, callback: (err: Error | null, stream?: NodeJS.ReadableStream) => void): void {
    this.docker.pull(imageName, options, callback);
  }

  get modem() {
    return this.docker.modem as any;
  }

  // Source materialization methods
  async materializeSource(source: any, targetDir: string): Promise<void> {
    if (source.type === "git") {
      await this.cloneGit(source, targetDir);
    } else if (source.type === "tar") {
      await this.extractTar(source.path, targetDir);
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

  async extractTar(tarPath: string, targetDir: string): Promise<void> {
    const { spawn } = await import("child_process");
    await new Promise<void>((res, rej) => {
      const p = spawn("tar", ["-xf", tarPath, "-C", targetDir]);
      p.on("exit", code => code === 0 ? res() : rej(new Error(`tar exited with ${code}`)));
    });
  }

  async ensureRuntimeImage(runtime: string): Promise<string /*image id*/> {
    // For the demo we support only Node variants mapped to Docker Hub "node:<ver>-slim" images.
    if (runtime.startsWith("node")) {
      const tag = runtime.replace(/^node/, ""); // "22" ➜ "22"
      const image = `node:${tag}-slim`;
      await this.pullIfMissing(image);
      return image;
    }
    throw new Error(`Unsupported runtime ${runtime}`);
  }

  async pullIfMissing(ref: string): Promise<void> {
    try {
      await this.getImage(ref).inspect();
    } catch (_) {
      await new Promise<void>((res, rej) => {
        this.pull(ref, {}, (err, stream) => {
          if (err) return rej(err);
          if (!stream) return rej(new Error("No stream"));
          this.modem.followProgress(stream, (e: Error | null) => e ? rej(e) : res());
        });
      });
    }
  }
}

export class DockerContainerInstance implements ContainerInstance {
  private container: Docker.Container;

  constructor(container: Docker.Container) {
    this.container = container;
  }

  async exec(options: {
    Cmd: string[];
    WorkingDir: string;
    Env: string[];
    AttachStdout: boolean;
    AttachStderr: boolean;
  }): Promise<ExecInstance> {
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

  inspect(): Promise<{ NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }> | undefined> } }> {
    return this.container.inspect();
  }
}

export class DockerExecInstance implements ExecInstance {
  private exec: Docker.Exec;

  constructor(exec: Docker.Exec) {
    this.exec = exec;
  }

  async start(options: { hijack: boolean; stdin: boolean }): Promise<void> {
    await this.exec.start(options);
  }

  inspect(): Promise<{ ExitCode: number | null }> {
    return this.exec.inspect();
  }
} 