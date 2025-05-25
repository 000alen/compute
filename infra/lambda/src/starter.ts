import "./types"; // Load Resource type overrides
import { Resource } from "sst";
import { task } from "sst/aws/task";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

interface TaskRequest {
  command?: string;
  body?: { command?: string };
  timeout?: number;
  metadata?: Record<string, any>;
}

export async function handler(event: TaskRequest) {
  const dynamoClient = new DynamoDBClient({});
  const requestId = crypto.randomUUID();
  const command = event.command || event.body?.command || "default";
  const timeout = event.timeout || 300; // 5 minutes default
  
  try {
    console.log(`Starting task with command: ${command}, requestId: ${requestId}`);
    
    // Start the task
    const runRet = await task.run(
      Resource.ComputeTask,
      {
        COMPUTE_COMMAND: command,
        REQUEST_ID: requestId,
        RESULTS_TABLE: Resource.TaskResults.name,
        RESULTS_BUCKET: Resource.TaskResultsBucket.name
      }
    );
    
    const taskArn = runRet.arn;
    const taskId = taskArn.split('/').pop()!;
    
    console.log('Task started with ARN:', taskArn, 'Task ID:', taskId);
    
    // Store task metadata in DynamoDB
    await dynamoClient.send(new PutItemCommand({
      TableName: Resource.TaskResults.name,
      Item: {
        taskId: { S: taskId },
        taskArn: { S: taskArn },
        requestId: { S: requestId },
        command: { S: command },
        status: { S: "RUNNING" },
        createdAt: { S: new Date().toISOString() },
        timeout: { N: timeout.toString() },
        metadata: { S: JSON.stringify(event.metadata || {}) }
      }
    }));
    
    console.log(`Task started successfully: ${taskId}`);
    
    return {
      statusCode: 202, // Accepted
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        taskId,
        taskArn,
        requestId,
        status: "RUNNING",
        message: "Task started successfully",
        statusUrl: `${Resource.TaskStatusHandler.url}?taskId=${taskId}`
      }, null, 2),
    };
    
  } catch (error) {
    console.error('Failed to start task:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId
      }, null, 2),
    };
  }
} 