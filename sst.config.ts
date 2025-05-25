/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "compute",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("ComputeVpc");

    const cluster = new sst.aws.Cluster("ComputeCluster", {
      vpc,
    });

    // DynamoDB table to store task results
    const resultsTable = new sst.aws.Dynamo("TaskResults", {
      fields: {
        taskId: "string",
        status: "string",
        createdAt: "string"
      },
      primaryIndex: { hashKey: "taskId" },
      globalIndexes: {
        statusIndex: { hashKey: "status", rangeKey: "createdAt" }
      }
    });

    // S3 bucket for storing detailed logs and results
    const resultsBucket = new sst.aws.Bucket("TaskResultsBucket");

    const task = new sst.aws.Task("ComputeTask", {
      cluster: cluster,
      link: [resultsTable, resultsBucket],

      dev: {
        directory: "infra/fargate",
        command: "pnpm dev",
      },

      image: {
        context: "infra/fargate",
        dockerfile: "Dockerfile",
      },

      // Enable CloudWatch logging
      logging: {
        retention: "1 week"
      }
    });

    const queue = new sst.aws.Queue("ComputeQueue");

    // Lambda to handle task completion events
    const taskCompleteHandler = new sst.aws.Function("TaskCompleteHandler", {
      link: [resultsTable, resultsBucket],
      handler: "infra/lambda/src/completion.handler",
    });

    // Lambda to get task status and results
    const taskStatusHandler = new sst.aws.Function("TaskStatusHandler", {
      link: [resultsTable, resultsBucket],
      handler: "infra/lambda/src/status.handler",
      url: true,
    });

    // Note: EventBridge integration will be added via direct AWS resources if needed
    // For now, we'll use the polling approach but with better separation of concerns

    // Lambda to start tasks
    const taskStarter = new sst.aws.Function("TaskStarter", {
      link: [task, queue, resultsTable, resultsBucket, taskCompleteHandler, taskStatusHandler],
      handler: "infra/lambda/src/starter.handler",
      url: true,
    });

    queue.subscribe(taskStarter.arn);

    return {
      taskStarterUrl: taskStarter.url,
      taskStatusUrl: taskStatusHandler.url,
    }
  },
});
