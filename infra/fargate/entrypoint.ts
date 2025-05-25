import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
  };
}

async function executeCommand(command: string): Promise<any> {
  // This is where you'd implement your actual command execution logic
  // For now, let's simulate some work
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (command === "error") {
    throw new Error("Simulated command error");
  }
  
  return {
    message: `Command '${command}' executed successfully`,
    data: { processedAt: new Date().toISOString() }
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
      ContentType: 'application/json'
    }));
    
    console.log(`Results saved to S3: results/${taskId}.json`);
  } catch (error) {
    console.error('Failed to save results to S3:', error);
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
  
  // Get task metadata from ECS
  const { taskId, taskArn } = await getTaskMetadata();
  
  // Fallback: use environment variables if metadata endpoint fails
  const finalTaskId = taskId || process.env.TASK_ID;
  const finalTaskArn = taskArn || process.env.TASK_ARN;
  
  console.log('Task identifiers:', { 
    taskId: finalTaskId, 
    taskArn: finalTaskArn,
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
      taskId: finalTaskId
    }
  };

  try {
    console.log(`[TASK_START] Starting task with command: ${command}, requestId: ${requestId}, taskId: ${taskId}`);
    
    // Execute the actual command
    const result = await executeCommand(command);
    
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
    
    process.exit(1);
  }
}

main();