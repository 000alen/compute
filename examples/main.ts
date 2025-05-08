import { createRun } from "../main";

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

  // Allow the dev server to run; press Ctrl+C to terminate.
  process.on("SIGINT", async () => {
    await run.dispose();
    process.exit(0);
  });
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
