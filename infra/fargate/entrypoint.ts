import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

interface TaskResult {
  success: boolean;
  startTime: string;
  endTime: string;
  duration: number; // in milliseconds
  command: string;
  result?: any;
  error?: string;
  metadata: {
    memoryUsage: NodeJS.MemoryUsage;
    platform: string;
    nodeVersion: string;
    requestId?: string;
    taskId?: string;
    userId?: string;
    priority?: number;
    containerInfo?: {
      cpu: string;
      memory: string;
      architecture: string;
    };
  };
}

async function executeCommand(command: string, metadata: any = {}): Promise<any> {
  console.log(`Executing command: ${command} with metadata:`, metadata);
  
  // Simulate different types of workloads based on command
  switch (command.toLowerCase()) {
    case "cpu-intensive":
      return await simulateCPUIntensiveTask();
    case "memory-intensive":
      return await simulateMemoryIntensiveTask();
    case "io-intensive":
      return await simulateIOIntensiveTask();
    case "network-test":
      return await simulateNetworkTask();
    case "error":
      throw new Error("Simulated command error");
    case "timeout":
      // Simulate a long-running task
      await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
      return { message: "Long task completed" };
    default:
      return await simulateDefaultTask(command);
  }
}

async function simulateCPUIntensiveTask(): Promise<any> {
  const startTime = Date.now();
  let result = 0;
  
  // CPU-intensive calculation
  for (let i = 0; i < 1000000; i++) {
    result += Math.sqrt(i) * Math.sin(i);
  }
  
  const duration = Date.now() - startTime;
  return {
    message: "CPU-intensive task completed",
    result: result.toFixed(2),
    duration,
    iterations: 1000000
  };
}

async function simulateMemoryIntensiveTask(): Promise<any> {
  const startTime = Date.now();
  const arrays = [];
  
  // Allocate memory
  for (let i = 0; i < 100; i++) {
    arrays.push(new Array(100000).fill(Math.random()));
  }
  
  const duration = Date.now() - startTime;
  const memoryUsage = process.memoryUsage();
  
  return {
    message: "Memory-intensive task completed",
    arraysCreated: arrays.length,
    duration,
    memoryUsage: {
      heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`
    }
  };
}

async function simulateIOIntensiveTask(): Promise<any> {
  const startTime = Date.now();
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    // Create temporary files
    const tempDir = '/tmp/io-test';
    await fs.mkdir(tempDir, { recursive: true });
    
    const files = [];
    for (let i = 0; i < 10; i++) {
      const filename = path.join(tempDir, `test-${i}.txt`);
      const content = `Test file ${i}\n`.repeat(1000);
      await fs.writeFile(filename, content);
      files.push(filename);
    }
    
    // Read files back
    const contents = [];
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      contents.push(content.length);
    }
    
    // Cleanup
    for (const file of files) {
      await fs.unlink(file);
    }
    await fs.rmdir(tempDir);
    
    const duration = Date.now() - startTime;
    return {
      message: "I/O-intensive task completed",
      filesProcessed: files.length,
      totalBytes: contents.reduce((sum, len) => sum + len, 0),
      duration
    };
  } catch (error) {
    return {
      message: "I/O task completed with limited capabilities",
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    };
  }
}

async function simulateNetworkTask(): Promise<any> {
  const startTime = Date.now();
  
  try {
    // Test network connectivity
    const response = await fetch('https://httpbin.org/json');
    const data = await response.json();
    
    const duration = Date.now() - startTime;
    return {
      message: "Network task completed",
      status: response.status,
      responseSize: JSON.stringify(data).length,
      duration
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      message: "Network task failed",
      error: error instanceof Error ? error.message : String(error),
      duration
    };
  }
}

async function simulateDefaultTask(command: string): Promise<any> {
  // Default simulation with variable delay based on command complexity
  const delay = Math.min(5000, command.length * 100 + Math.random() * 2000);
  await new Promise(resolve => setTimeout(resolve, delay));
  
  return {
    message: `Command '${command}' executed successfully`,
    data: { 
      processedAt: new Date().toISOString(),
      commandLength: command.length,
      processingTime: delay
    }
  };
}

async function saveResultsToS3(taskResult: TaskResult): Promise<void> {
  console.log('saveResultsToS3 called with:', {
    bucket: process.env.RESULTS_BUCKET,
    taskId: taskResult.metadata.taskId,
    hasResult: !!taskResult.result
  });
  
  if (!process.env.RESULTS_BUCKET) {
    console.warn('No RESULTS_BUCKET environment variable set, skipping S3 save');
    return;
  }
  
  const s3Client = new S3Client({});
  const taskId = taskResult.metadata.taskId;
  
  if (!taskId) {
    console.warn('No taskId available in taskResult.metadata, cannot save to S3. Full metadata:', taskResult.metadata);
    return;
  }
  
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.RESULTS_BUCKET,
      Key: `results/${taskId}.json`,
      Body: JSON.stringify(taskResult, null, 2),
      ContentType: 'application/json',
      Metadata: {
        taskId: taskId,
        userId: taskResult.metadata.userId || 'unknown',
        priority: taskResult.metadata.priority?.toString() || '0',
        status: taskResult.success ? 'success' : 'failed'
      }
    }));
    
    console.log(`Results saved to S3: results/${taskId}.json`);
  } catch (error) {
    console.error('Failed to save results to S3:', error);
  }
}

async function updateTaskStatus(taskResult: TaskResult): Promise<void> {
  if (!process.env.RESULTS_TABLE || !taskResult.metadata.taskId) {
    console.warn('Missing RESULTS_TABLE or taskId, skipping DynamoDB update');
    return;
  }
  
  const dynamoClient = new DynamoDBClient({});
  
  try {
    await dynamoClient.send(new UpdateItemCommand({
      TableName: process.env.RESULTS_TABLE,
      Key: {
        taskId: { S: taskResult.metadata.taskId }
      },
      UpdateExpression: "SET #status = :status, completedAt = :completedAt, #duration = :duration, #success = :success",
      ExpressionAttributeNames: {
        "#status": "status",
        "#duration": "duration",
        "#success": "success"
      },
      ExpressionAttributeValues: {
        ":status": { S: taskResult.success ? "SUCCESS" : "FAILED" },
        ":completedAt": { S: taskResult.endTime },
        ":duration": { N: taskResult.duration.toString() },
        ":success": { BOOL: taskResult.success }
      }
    }));
    
    console.log(`Task status updated in DynamoDB: ${taskResult.metadata.taskId}`);
  } catch (error) {
    console.error('Failed to update task status in DynamoDB:', error);
  }
}

async function getTaskMetadata(): Promise<{ taskId?: string; taskArn?: string }> {
  try {
    // Get ECS task metadata from the metadata endpoint
    const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
    if (!metadataUri) {
      console.warn('ECS_CONTAINER_METADATA_URI_V4 not available');
      return {};
    }
    
    const taskMetadataUrl = metadataUri.replace('/v4/container', '/v4/task');
    const response = await fetch(taskMetadataUrl);
    
    if (!response.ok) {
      console.warn('Failed to fetch task metadata:', response.status);
      return {};
    }
    
    const metadata = await response.json() as { TaskARN: string };
    const taskArn = metadata.TaskARN;
    const taskId = taskArn?.split('/').pop();
    
    console.log('Retrieved task metadata:', { taskId, taskArn });
    return { taskId, taskArn };
    
  } catch (error) {
    console.warn('Failed to get task metadata:', error);
    return {};
  }
}

async function main() {
  const startTime = new Date();
  const command = process.env.COMPUTE_COMMAND || "default";
  const requestId = process.env.REQUEST_ID;
  const userId = process.env.USER_ID || "anonymous";
  const priority = parseInt(process.env.PRIORITY || "0");
  const metadata = process.env.METADATA ? JSON.parse(process.env.METADATA) : {};
  
  // Get task metadata from ECS
  const { taskId, taskArn } = await getTaskMetadata();
  
  // Fallback: use environment variables if metadata endpoint fails
  const finalTaskId = taskId || process.env.TASK_ID;
  const finalTaskArn = taskArn || process.env.TASK_ARN;
  
  console.log('Task identifiers:', { 
    taskId: finalTaskId, 
    taskArn: finalTaskArn,
    userId,
    priority,
    metadataUri: process.env.ECS_CONTAINER_METADATA_URI_V4 
  });
  
  let taskResult: TaskResult = {
    success: false,
    startTime: startTime.toISOString(),
    endTime: "",
    duration: 0,
    command,
    metadata: {
      memoryUsage: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      requestId,
      taskId: finalTaskId,
      userId,
      priority,
      containerInfo: {
        cpu: process.env.ECS_CONTAINER_CPU || "unknown",
        memory: process.env.ECS_CONTAINER_MEMORY || "unknown",
        architecture: process.arch
      }
    }
  };

  try {
    console.log(`[TASK_START] Starting task with command: ${command}, requestId: ${requestId}, taskId: ${finalTaskId}, userId: ${userId}, priority: ${priority}`);
    
    // Execute the actual command with metadata
    const result = await executeCommand(command, { userId, priority, ...metadata });
    
    const endTime = new Date();
    taskResult = {
      ...taskResult,
      success: true,
      endTime: endTime.toISOString(),
      duration: endTime.getTime() - startTime.getTime(),
      result,
      metadata: {
        ...taskResult.metadata,
        memoryUsage: process.memoryUsage()
      }
    };
    
    console.log(`[TASK_SUCCESS]`, JSON.stringify(taskResult, null, 2));
    
    // Save detailed results to S3
    await saveResultsToS3(taskResult);
    
    // Update task status in DynamoDB
    await updateTaskStatus(taskResult);
    
  } catch (error) {
    const endTime = new Date();
    taskResult = {
      ...taskResult,
      success: false,
      endTime: endTime.toISOString(),
      duration: endTime.getTime() - startTime.getTime(),
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        ...taskResult.metadata,
        memoryUsage: process.memoryUsage()
      }
    };
    
    console.error(`[TASK_ERROR]`, JSON.stringify(taskResult, null, 2));
    
    // Save error results to S3
    await saveResultsToS3(taskResult);
    
    // Update task status in DynamoDB
    await updateTaskStatus(taskResult);
    
    process.exit(1);
  }
}

main();