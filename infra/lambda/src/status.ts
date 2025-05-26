import "./types"; // Load Resource type overrides
import { Resource } from "sst";
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";

interface StatusRequest {
  taskId?: string;
  queryStringParameters?: { taskId?: string };
}

export async function handler(event: StatusRequest) {
  const taskId = event.taskId || event.queryStringParameters?.taskId;
  
  if (!taskId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: "taskId parameter is required" })
    };
  }
  
  const dynamoClient = new DynamoDBClient({});
  const s3Client = new S3Client({});
  const ecsClient = new ECSClient({});
  
  try {
    // Get task info from DynamoDB
    const dbResponse = await dynamoClient.send(new GetItemCommand({
      TableName: Resource.TaskResults.name,
      Key: { taskId: { S: taskId } }
    }));
    
    if (!dbResponse.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: "Task not found" })
      };
    }
    
    const taskData = {
      taskId: dbResponse.Item.taskId?.S,
      taskArn: dbResponse.Item.taskArn?.S!,
      requestId: dbResponse.Item.requestId?.S,
      command: dbResponse.Item.command?.S,
      status: dbResponse.Item.status?.S,
      createdAt: dbResponse.Item.createdAt?.S,
      completedAt: dbResponse.Item.completedAt?.S,
      metadata: dbResponse.Item.metadata?.S ? JSON.parse(dbResponse.Item.metadata.S) : {}
    };
    
    // Parse duration from DynamoDB (if available)
    const duration = dbResponse.Item.duration?.N ? parseInt(dbResponse.Item.duration.N, 10) : undefined;
    
    // If status is still RUNNING, check ECS for updates
    if (taskData.status === "RUNNING") {
      const clusterName = taskData.taskArn.split('/')[1];
      
      try {
        const ecsResponse = await ecsClient.send(new DescribeTasksCommand({
          cluster: clusterName,
          tasks: [taskData.taskArn]
        }));
        
        const task = ecsResponse.tasks?.[0];
        if (task && task.lastStatus === "STOPPED") {
          const newStatus = task.stopCode === "EssentialContainerExited" && 
                           task.containers?.[0]?.exitCode === 0 ? "SUCCESS" : "FAILED";
          
          // Update status in DynamoDB
          await dynamoClient.send(new UpdateItemCommand({
            TableName: Resource.TaskResults.name,
            Key: { taskId: { S: taskId } },
            UpdateExpression: "SET #status = :status, completedAt = :completedAt",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": { S: newStatus },
              ":completedAt": { S: new Date().toISOString() }
            }
          }));
          
          taskData.status = newStatus;
          taskData.completedAt = new Date().toISOString();
        }
      } catch (ecsError) {
        console.warn('Failed to check ECS status:', ecsError);
      }
    }
    
    // Try to get detailed results from S3 if task is completed
    let detailedResults = null;
    if (taskData.status !== "RUNNING") {
      try {
        const s3Response = await s3Client.send(new GetObjectCommand({
          Bucket: Resource.TaskResultsBucket.name,
          Key: `results/${taskId}.json`
        }));
        
        if (s3Response.Body) {
          const resultText = await s3Response.Body.transformToString();
          detailedResults = JSON.parse(resultText);
        }
      } catch (s3Error) {
        console.warn('No detailed results found in S3:', s3Error);
      }
    }
    
    const response = {
      ...taskData,
      // Include computed duration for client logging
      duration,
      detailedResults,
      isComplete: taskData.status !== "RUNNING",
      links: {
        self: `${Resource.TaskStatusHandler.url}?taskId=${taskId}`,
        ...(taskData.status === "RUNNING" && {
          poll: `${Resource.TaskStatusHandler.url}?taskId=${taskId}&wait=true`
        })
      }
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response, null, 2)
    };
    
  } catch (error) {
    console.error('Status check error:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        taskId
      })
    };
  }
} 