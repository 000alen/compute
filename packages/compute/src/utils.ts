import { ContainerAdapter } from "@000alen/compute-types";

export async function ensureRuntimeImage(containerAdapter: ContainerAdapter, runtime: string): Promise<string /*image id*/> {
  // For the demo we support only Node variants mapped to Docker Hub "node:<ver>-slim" images.
  if (runtime.startsWith("node")) {
    const tag = runtime.replace(/^node/, ""); // "22" ➜ "22"
    const image = `node:${tag}-slim`;
    await pullIfMissing(containerAdapter, image);
    return image;
  }
  throw new Error(`Unsupported runtime ${runtime}`);
}

export async function pullIfMissing(containerAdapter: ContainerAdapter, ref: string): Promise<void> {
  try {
    await containerAdapter.getImage(ref).inspect();
  } catch (_) {
    await new Promise<void>((res, rej) => {
      containerAdapter.pull(ref, {}, (err, stream) => {
        if (err) return rej(err);
        if (!stream) return rej(new Error("No stream"));
        containerAdapter.modem.followProgress(stream, (e) => e ? rej(e) : res());
      });
    });
  }
}
