import Docker from "dockerode";
import { ContainerAdapter, ContainerInstance, ExecInstance } from "./container-adapter";

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
}

class DockerContainerInstance implements ContainerInstance {
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

class DockerExecInstance implements ExecInstance {
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