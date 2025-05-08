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
} 