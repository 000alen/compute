import "./types"; // Load Resource type overrides
import { Resource } from "sst";
import { task } from "sst/aws/task";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

interface TaskRequest {
  command?: string;
  body?: { 
    command?: string;
    priority?: number;
    userId?: string;
    metadata?: Record<string, any>;
  };
  timeout?: number;
  priority?: number;
  userId?: string;
  metadata?: Record<string, any>;
  // API Gateway event properties
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  pathParameters?: Record<string, string>;
  requestContext?: {
    requestId: string;
    identity?: {
      sourceIp: string;
      userAgent: string;
    };
  };
}

interface SQSEvent {
  Records: Array<{
    body: string;
    messageAttributes?: Record<string, any>;
  }>;
}

export async function handler(event: TaskRequest | SQSEvent) {
  // Check if this is an SQS event (queue processing) or direct API call
  if ('Records' in event) {
    return await processSQSMessages(event);
  } else {
    return await handleDirectRequest(event);
  }
}

async function handleDirectRequest(event: TaskRequest) {
  const dynamoClient = new DynamoDBClient({});
  const sqsClient = new SQSClient({});
  const requestId = event.requestContext?.requestId || crypto.randomUUID();
  
  // Extract parameters from event body or direct properties
  const body = event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {};
  const command = event.command || body.command || "default";
  const priority = event.priority || body.priority || 0;
  const userId = event.userId || body.userId || "anonymous";
  const timeout = event.timeout || 300; // 5 minutes default
  const metadata = { 
    ...event.metadata, 
    ...body.metadata,
    sourceIp: event.requestContext?.identity?.sourceIp,
    userAgent: event.requestContext?.identity?.userAgent
  };
  
  try {
    console.log(`Creating task with command: ${command}, priority: ${priority}, userId: ${userId}, requestId: ${requestId}`);
    
    // Validate input
    if (!command || command.trim() === "") {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: "Command is required",
          requestId
        })
      };
    }
    
    // Generate task ID
    const taskId = crypto.randomUUID();
    
    // Store task metadata in DynamoDB with PENDING status
    await dynamoClient.send(new PutItemCommand({
      TableName: Resource.TaskResults.name,
      Item: {
        taskId: { S: taskId },
        requestId: { S: requestId },
        command: { S: command },
        status: { S: "PENDING" },
        priority: { N: priority.toString() },
        userId: { S: userId },
        createdAt: { S: new Date().toISOString() },
        timeout: { N: timeout.toString() },
        metadata: { S: JSON.stringify(metadata || {}) }
      }
    }));
    
    // Determine which queue to use based on priority
    const useHighPriorityQueue = priority >= 5;
    const targetQueueUrl = useHighPriorityQueue ? 
      Resource.ComputePriorityQueue.url : 
      Resource.ComputeQueue.url;
    
    // Send task to appropriate queue for processing
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: targetQueueUrl,
      MessageBody: JSON.stringify({
        taskId,
        command,
        priority,
        userId,
        requestId,
        metadata
      }),
      MessageAttributes: {
        taskId: {
          DataType: "String",
          StringValue: taskId
        },
        priority: {
          DataType: "Number",
          StringValue: priority.toString()
        },
        userId: {
          DataType: "String",
          StringValue: userId
        }
      },
      // Use priority as message group ID for FIFO queues if needed
      ...(priority >= 8 && {
        MessageGroupId: "high-priority",
        MessageDeduplicationId: `${taskId}-${Date.now()}`
      })
    }));
    
    console.log(`Task ${taskId} queued successfully to ${useHighPriorityQueue ? 'priority' : 'standard'} queue`);
    
    // Return REST API-compatible response without exposing internal requestId
    return {
      statusCode: 202, // Accepted
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        taskId,
        status: "PENDING",
        priority,
        queueType: useHighPriorityQueue ? "priority" : "standard",
        message: "Task queued for processing",
        // Point at API Gateway route for task status
        statusUrl: `${Resource.ComputeApi.url}/tasks/${taskId}`,
        estimatedStartTime: new Date(Date.now() + (priority >= 5 ? 30000 : 120000)).toISOString()
      }, null, 2),
    };
    
  } catch (error) {
    console.error('Failed to queue task:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId
      },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId,
        timestamp: new Date().toISOString()
      }, null, 2),
    };
  }
}

async function processSQSMessages(event: SQSEvent) {
  const dynamoClient = new DynamoDBClient({});
  const results = [];
  
  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const { taskId, command, priority, userId, requestId, metadata } = messageBody;
      
      console.log(`Processing SQS message for task: ${taskId}`);
      
      // Update task status to RUNNING
      await dynamoClient.send(new PutItemCommand({
        TableName: Resource.TaskResults.name,
        Item: {
          taskId: { S: taskId },
          status: { S: "RUNNING" },
          startedAt: { S: new Date().toISOString() }
        }
      }));
      
      // Start the actual compute task
      const runRet = await task.run(
        Resource.ComputeTask,
        {
          COMPUTE_COMMAND: command,
          REQUEST_ID: requestId,
          TASK_ID: taskId,
          USER_ID: userId,
          PRIORITY: priority.toString(),
          RESULTS_TABLE: Resource.TaskResults.name,
          RESULTS_BUCKET: Resource.TaskResultsBucket.name,
          METADATA: JSON.stringify(metadata || {})
        }
      );
      
      const taskArn = runRet.arn;
      
      // Update task with ARN and running status
      await dynamoClient.send(new PutItemCommand({
        TableName: Resource.TaskResults.name,
        Item: {
          taskId: { S: taskId },
          taskArn: { S: taskArn },
          status: { S: "RUNNING" },
          startedAt: { S: new Date().toISOString() }
        }
      }));
      
      console.log(`Task ${taskId} started with ARN: ${taskArn}`);
      
      results.push({
        taskId,
        status: "RUNNING",
        taskArn
      });
      
    } catch (error) {
      console.error('Failed to process SQS message:', error);
      results.push({
        error: error instanceof Error ? error.message : String(error),
        record: record.body
      });
    }
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "SQS messages processed",
      results,
      processedCount: results.length
    })
  };
} 