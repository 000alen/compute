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

  const installExitCode = await run.execWait({
    cmd: "npm",
    args: ["install"]
  });

  console.log("Install exit code", installExitCode);

  const devExec = await run.exec({
    cmd: "npm",
    args: ["run", "dev"]
  });

  await devExec.start({
    hijack: false,
    stdin: true,
  });

  console.log("App available at", await run.publicUrl(3000));

  await sleep(60_000)
    .then(async () => {
      await run.dispose();
    })
    .finally(() => {
      process.exit(0);
    });
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
