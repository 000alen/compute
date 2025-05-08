import { createRun } from "@000alen/compute";
import { Readable } from "stream";
import tar from "tar-stream";
import debug from 'debug';

const log = debug('compute:client');
debug.enable('compute:*');

export async function readFileBuffer(
  tarStream: NodeJS.ReadableStream,
  path: string
): Promise<Buffer> {
  const wanted = path.replace(/^\.?\//, "");

  const extract = tar.extract();

  return new Promise<Buffer>((resolve, reject) => {
    let found = false;

    extract.on("entry", (header, stream, next) => {
      const entryName = header.name.replace(/^\.?\//, "");

      if (entryName === wanted) {
        // Collect the file we want
        const chunks: Buffer[] = [];
        stream.on("data", c => chunks.push(c));
        stream.on("end", () => {
          found = true;
          next();                       // let tar‑stream continue
          resolve(Buffer.concat(chunks));
        });
        stream.on("error", reject);
      } else {
        // Drain unwanted entry quickly
        stream.resume();
        stream.on("end", next);
      }
    });

    extract.on("finish", () => {
      if (!found) reject(new Error(`File ${path} not found in archive`));
    });

    extract.on("error", reject);
    tarStream.pipe(extract as any);
  });
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  log("Creating run");

  const run = await createRun({
    apiUrl: "http://localhost:3000",
    source: {
      type: "git",
      url: "https://github.com/gudmundur/nextjs-boilerplate.git",
    },
    runtime: "node22",
    ports: [3000],
  });

  log("run created", run.id);

  const stream = await run.download("/workspace/package.json");
  const buffer = await readFileBuffer(Readable.fromWeb(stream), "package.json");
  log(buffer.toString("utf-8"));

  log("installing dependencies");

  const { exec: installExec, stream: installStream } = await run.exec({
    cmd: "npm",
    args: ["install"]
  });

  log("install exec started", installExec.id);

  for await (const chunk of installStream) {
    log(chunk);
  }

  log("downloading package.json");

  log("running dev server");

  const { exec: devExec } = await run.exec({
    cmd: "npm",
    args: ["run", "dev"]
  });

  log("dev exec started", devExec.id);

  log("app available at", await run.publicUrl(3000));

  await sleep(30_000)
    .then(async () => {
      await run.dispose();
    })
    .finally(async () => {
      process.exit(0);
    });
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
