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
    // VPC with proper security configuration
    const vpc = new sst.aws.Vpc("ComputeVpc", {
      nat: "managed",
      bastion: false,
    });

    // ECS Cluster with enhanced configuration
    const cluster = new sst.aws.Cluster("ComputeCluster", {
      vpc,
      scaling: {
        min: 0,
        max: 100,
        cooldown: {
          scaleIn: "300s",
          scaleOut: "60s"
        }
      }
    });

    // DynamoDB table to store task results with enhanced schema
    const resultsTable = new sst.aws.Dynamo("TaskResults", {
      fields: {
        taskId: "string",
        status: "string",
        createdAt: "string",
        userId: "string",
        priority: "number"
      },
      primaryIndex: { hashKey: "taskId" },
      globalIndexes: {
        statusIndex: { hashKey: "status", rangeKey: "createdAt" },
        userIndex: { hashKey: "userId", rangeKey: "createdAt" },
        priorityIndex: { hashKey: "priority", rangeKey: "createdAt" }
      },
      pointInTimeRecovery: true,
      stream: "new-and-old-images"
    });

    // S3 bucket for storing detailed logs and results with encryption
    const resultsBucket = new sst.aws.Bucket("TaskResultsBucket", {
      versioning: true,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: ["GET", "PUT", "POST"],
          allowedOrigins: ["*"],
          maxAge: 3000,
        },
      ],
    });

    // Dead letter queue for failed tasks
    const deadLetterQueue = new sst.aws.Queue("ComputeDeadLetterQueue", {
      visibilityTimeout: "30 seconds",
    });

    // Main compute queue with DLQ
    const queue = new sst.aws.Queue("ComputeQueue", {
      visibilityTimeout: "15 minutes",
      dlq: {
        queue: deadLetterQueue.arn,
        retry: 3
      }
    });

    // Priority queue for high-priority tasks
    const priorityQueue = new sst.aws.Queue("ComputePriorityQueue", {
      visibilityTimeout: "15 minutes",
      dlq: {
        queue: deadLetterQueue.arn,
        retry: 3
      }
    });

    // Enhanced compute task with security and monitoring
    const task = new sst.aws.Task("ComputeTask", {
      cluster: cluster,
      link: [resultsTable, resultsBucket],
      vpc: {
        subnets: vpc.privateSubnets
      },
      cpu: "256",
      memory: "512",
      architecture: "x86_64",
      
      dev: {
        directory: "infra/fargate",
        command: "pnpm dev",
      },

      image: {
        context: "infra/fargate",
        dockerfile: "Dockerfile",
      },

      // Enhanced logging configuration
      logging: {
        retention: "1 week"
      }
    });

    // Lambda to handle task completion events
    const taskCompleteHandler = new sst.aws.Function("TaskCompleteHandler", {
      link: [resultsTable, resultsBucket],
      handler: "infra/lambda/src/completion.handler",
      timeout: "30 seconds",
      memory: "256 MB"
    });

    // Lambda to get task status and results
    const taskStatusHandler = new sst.aws.Function("TaskStatusHandler", {
      link: [resultsTable, resultsBucket],
      handler: "infra/lambda/src/status.handler",
      url: true,
      timeout: "30 seconds",
      memory: "256 MB"
    });

    // Enhanced task starter with authentication
    const taskStarter = new sst.aws.Function("TaskStarter", {
      link: [task, queue, priorityQueue, resultsTable, resultsBucket, taskCompleteHandler, taskStatusHandler],
      handler: "infra/lambda/src/starter.handler",
      url: true,
      timeout: "30 seconds",
      memory: "512 MB"
    });

    // Task scheduler for batch processing
    const taskScheduler = new sst.aws.Function("TaskScheduler", {
      link: [queue, priorityQueue, resultsTable],
      handler: "infra/lambda/src/scheduler.handler",
      timeout: "5 minutes",
      memory: "256 MB"
    });

    // Task monitor for health checks and cleanup
    const taskMonitor = new sst.aws.Function("TaskMonitor", {
      link: [resultsTable, resultsBucket, cluster],
      handler: "infra/lambda/src/monitor.handler",
      timeout: "5 minutes",
      memory: "256 MB"
    });

    // API Gateway for REST API
    const api = new sst.aws.ApiGatewayV2("ComputeApi", {
      cors: {
        allowCredentials: true,
        allowHeaders: ["content-type", "authorization"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowOrigins: ["*"],
      },
      accessLog: {
        retention: "1 week"
      }
    });

    // API routes
    api.route("POST /tasks", taskStarter.arn);
    api.route("GET /tasks/{taskId}", taskStatusHandler.arn);
    api.route("GET /health", taskMonitor.arn);

    // Subscribe functions to queues
    queue.subscribe(taskStarter.arn);
    priorityQueue.subscribe(taskStarter.arn);
    deadLetterQueue.subscribe(taskCompleteHandler.arn);

    return {
      api: api.url,
      taskStarterUrl: taskStarter.url,
      taskStatusUrl: taskStatusHandler.url,
      queueUrl: queue.url,
      priorityQueueUrl: priorityQueue.url,
      deadLetterQueueUrl: deadLetterQueue.url,
      bucketName: resultsBucket.name,
      tableName: resultsTable.name,
      clusterName: cluster.name
    }
  },
});
