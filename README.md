# Compute

A minimal open-source re-implementation of the experimental `@vercel/runs` API. This module allows for executing commands in Docker containers, with support for streaming logs, exposing ports, and automatic cleanup.

## Features

- Execute commands in isolated Docker containers
- Stream command output logs
- Expose container ports to the host
- Easy cleanup of containers and workspaces
- Support for Git repositories and tar archives as source code

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

## Usage

```typescript
import { createRun } from '@000alen/compute';

// Create a run from a Git repository
const run = await createRun({
  source: {
    type: 'git',
    url: 'https://github.com/username/repo.git',
    ref: 'main' // Optional: branch, tag, or commit hash
  },
  runtime: {
    name: 'node',
    tag: '18'
  },
  ports: [3000, 8080], // Ports to expose
});

// Execute a command in the container
const { output } = await run.exec('npm install && npm start');
console.log(output);

// Get mapped port
const hostPort = run.getHostPort(3000);
console.log(`App is running on http://localhost:${hostPort}`);

// Clean up when done
await run.cleanup();
```

## API

### `createRun(options)`

Creates a new run instance.

#### Options

- `source`: Source code configuration
  - Git source: `{ type: 'git', url: string, ref?: string }`
  - Tar source: `{ type: 'tar', path: string }`
- `runtime`: Runtime configuration
  - `{ name: string, tag: string }`
- `ports` (optional): Array of container ports to expose
- `labels` (optional): Docker container labels

#### Returns

A `Run` instance with methods:

- `exec(command)`: Execute a command in the container
- `getHostPort(containerPort)`: Get the host port mapped to a container port
- `cleanup()`: Remove the container and temporary files

## License

MIT