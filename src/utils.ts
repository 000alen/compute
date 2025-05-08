import simpleGit, { SimpleGit } from "simple-git";
import Docker from "dockerode";
import { GitSource } from "./types";

export async function cloneGit(src: GitSource, targetDir: string): Promise<void> {
  const git: SimpleGit = simpleGit();
  await git.clone(src.url, targetDir, ["--depth", `${src.depth ?? 1}`]);
  if (src.ref) {
    await git.cwd(targetDir);
    await git.checkout(src.ref);
  }
}

export async function extractTar(tarPath: string, targetDir: string): Promise<void> {
  const { spawn } = await import("child_process");
  await new Promise<void>((res, rej) => {
    const p = spawn("tar", ["-xf", tarPath, "-C", targetDir]);
    p.on("exit", code => code === 0 ? res() : rej(new Error(`tar exited with ${code}`)));
  });
}

export async function ensureRuntimeImage(docker: Docker, runtime: string): Promise<string /*image id*/> {
  // For the demo we support only Node variants mapped to Docker Hub "node:<ver>-slim" images.
  if (runtime.startsWith("node")) {
    const tag = runtime.replace(/^node/, ""); // "22" ➜ "22"
    const image = `node:${tag}-slim`;
    await pullIfMissing(docker, image);
    return image;
  }
  throw new Error(`Unsupported runtime ${runtime}`);
}

export async function pullIfMissing(docker: Docker, ref: string): Promise<void> {
  try {
    await docker.getImage(ref).inspect();
  } catch (_) {
    await new Promise<void>((res, rej) => {
      docker.pull(ref, {}, (err, stream) => {
        if (err) return rej(err);
        if (!stream) return rej(new Error("No stream"));
        docker.modem.followProgress(stream, (e) => e ? rej(e) : res());
      });
    });
  }
}
