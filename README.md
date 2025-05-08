# Compute

A minimal open-source re-implementation of the experimental `@vercel/runs` API. This module allows for executing commands in Docker containers, with support for streaming logs, exposing ports, and automatic cleanup.

## Features

- Execute commands in isolated Docker containers
- Stream command output logs
- Expose container ports to the host
- Easy cleanup of containers and workspaces
- Support for Git repositories as source code
- Client-server architecture with tRPC

## Installation

```bash
npm install @000alen/compute
# or
yarn add @000alen/compute
# or
pnpm add @000alen/compute
```

## Dependencies

- [simple-git](https://github.com/steveukx/git-js) - Lightweight git client
- [dockerode](https://github.com/apocas/dockerode) - Node.js Docker API
- [uuid](https://github.com/uuidjs/uuid) - Cryptographically-strong UUID generation
- [tRPC](https://trpc.io/) - End-to-end typesafe APIs

## Usage

### Client Example

```typescript
import { createRun } from "@000alen/compute";

// Create a run from a Git repository
const run = await createRun({
  apiUrl: "http://localhost:3000", // URL to your Compute server
  source: {
    type: "git",
    url: "https://github.com/username/repo.git",
  },
  runtime: "node22", // Runtime to use
  ports: [3000], // Ports to expose
  labels: { "created-by": "example" }, // Optional labels
});
console.log("Run created", run.id);

// Execute commands in the container
const { exec: installExec, stream: installStream } = await run.exec({
  cmd: "npm",
  args: ["install"]
});

// Stream the output
for await (const chunk of installStream) {
  console.log(chunk);
}

// Run another command
const { exec: devExec, stream: devStream } = await run.exec({
  cmd: "npm",
  args: ["run", "dev"]
});

// Access the application via the exposed port
console.log("App available at", await run.publicUrl(3000));

// Clean up when done
await run.dispose();
```

### Server Example

```typescript
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createComputeRouter } from '@000alen/compute/trpc/server';
import { DockerAdapter } from '@000alen/compute-docker-adapter';

// Create a Docker adapter
const containerAdapter = new DockerAdapter();

// Create the compute router with the adapter
const router = createComputeRouter({ containerAdapter });

// Create and start a tRPC HTTP server
const server = createHTTPServer({
  router,
  middleware: async (req, res, next) => {
    console.log(req.url);
    next();
  }
});

server.listen(3000);
```

## API

### `createRun(options)`

Creates a new run instance with a connection to the Compute server.

#### Options

- `apiUrl`: URL to the Compute server
- `source`: Source code configuration
  - Git source: `{ type: 'git', url: string, ref?: string }`
- `runtime`: Runtime to use (e.g., "node22")
- `ports` (optional): Array of container ports to expose
- `labels` (optional): Docker container labels

#### Returns

A `ClientRun` instance with methods:

- `exec({ cmd, args })`: Execute a command in the container
- `publicUrl(containerPort)`: Get the public URL for an exposed port
- `dispose()`: Remove the container and clean up resources

## License

MIT