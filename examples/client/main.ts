import { createRun } from "@000alen/compute";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const run = await createRun({
    source: {
      type: "git",
      url: "https://github.com/gudmundur/nextjs-boilerplate.git",
    },
    runtime: "node22",
    ports: [3000],
    labels: { "created-by": "runs.ts example" },
  });

  await run.execWait({ cmd: "npm", args: ["install"] });
  await run.exec({ cmd: "npm", args: ["run", "dev"] });
  console.log("App available at", run.publicUrl(3000));

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
