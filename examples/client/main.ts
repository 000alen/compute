import { createRun } from "@000alen/compute";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const run = await createRun({
    apiUrl: "http://localhost:3000",
    source: {
      type: "git",
      url: "https://github.com/gudmundur/nextjs-boilerplate.git",
    },
    runtime: "node22",
    ports: [3000],
    labels: { "created-by": "runs.ts example" },
  });
  console.log("Run created", run.id);

  const { exec: installExec, stream: installStream } = await run.exec({
    cmd: "npm",
    args: ["install"]
  });
  console.log("Install exec started", installExec.id);
  for await (const chunk of installStream) {
    console.log(chunk);
  }

  const { exec: devExec, stream: devStream } = await run.exec({
    cmd: "npm",
    args: ["run", "dev"]
  });
  console.log("Dev exec started", devExec.id);

  (async () => {
    for await (const chunk of devStream) {
      console.log(chunk);
    }
  })()

  console.log("App available at", await run.publicUrl(3000));

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
