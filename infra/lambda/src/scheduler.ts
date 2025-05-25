import "./types";
import { Resource } from "sst";
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

interface SchedulerEvent {
  batchSize?: number;
  priorityThreshold?: number;
}

export async function handler(event: SchedulerEvent = {}) {
  const dynamoClient = new DynamoDBClient({});
  const sqsClient = new SQSClient({});
  
  const batchSize = event.batchSize || 10;
  const priorityThreshold = event.priorityThreshold || 5;
  
  try {
    console.log('Starting task scheduler batch processing');
    
    // Get pending tasks from DynamoDB
    const scanResponse = await dynamoClient.send(new ScanCommand({
      TableName: Resource.TaskResults.name,
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": { S: "PENDING" }
      },
      Limit: batchSize
    }));
    
    if (!scanResponse.Items || scanResponse.Items.length === 0) {
      console.log('No pending tasks found');
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No pending tasks to process",
          processedCount: 0
        })
      };
    }
    
    // Check queue depths to determine routing
    const [mainQueueAttrs, priorityQueueAttrs] = await Promise.all([
      sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: Resource.ComputeQueue.url,
        AttributeNames: ["ApproximateNumberOfMessages"]
      })),
      sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: Resource.ComputePriorityQueue.url,
        AttributeNames: ["ApproximateNumberOfMessages"]
      }))
    ]);
    
    const mainQueueDepth = parseInt(mainQueueAttrs.Attributes?.ApproximateNumberOfMessages || "0");
    const priorityQueueDepth = parseInt(priorityQueueAttrs.Attributes?.ApproximateNumberOfMessages || "0");
    
    console.log(`Queue depths - Main: ${mainQueueDepth}, Priority: ${priorityQueueDepth}`);
    
    let processedCount = 0;
    
    // Process each pending task
    for (const item of scanResponse.Items) {
      const taskId = item.taskId?.S;
      const priority = parseInt(item.priority?.N || "0");
      const command = item.command?.S || "default";
      
      if (!taskId) continue;
      
      // Determine which queue to use based on priority and queue depths
      const useHighPriorityQueue = priority >= priorityThreshold || 
                                  (mainQueueDepth > 50 && priorityQueueDepth < 10);
      
      const targetQueueUrl = useHighPriorityQueue ? 
        Resource.ComputePriorityQueue.url : 
        Resource.ComputeQueue.url;
      
      try {
        // Send task to appropriate queue
        await sqsClient.send(new SendMessageCommand({
          QueueUrl: targetQueueUrl,
          MessageBody: JSON.stringify({
            taskId,
            command,
            priority,
            scheduledAt: new Date().toISOString()
          }),
          MessageAttributes: {
            taskId: {
              DataType: "String",
              StringValue: taskId
            },
            priority: {
              DataType: "Number",
              StringValue: priority.toString()
            }
          }
        }));
        
        // Update task status to QUEUED
        await dynamoClient.send(new UpdateItemCommand({
          TableName: Resource.TaskResults.name,
          Key: { taskId: { S: taskId } },
          UpdateExpression: "SET #status = :status, queuedAt = :queuedAt, queueType = :queueType",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ":status": { S: "QUEUED" },
            ":queuedAt": { S: new Date().toISOString() },
            ":queueType": { S: useHighPriorityQueue ? "priority" : "standard" }
          }
        }));
        
        processedCount++;
        console.log(`Queued task ${taskId} to ${useHighPriorityQueue ? 'priority' : 'standard'} queue`);
        
      } catch (error) {
        console.error(`Failed to queue task ${taskId}:`, error);
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Batch processing completed",
        processedCount,
        totalPending: scanResponse.Items.length,
        queueDepths: {
          main: mainQueueDepth,
          priority: priorityQueueDepth
        }
      })
    };
    
  } catch (error) {
    console.error('Scheduler error:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        message: "Scheduler batch processing failed"
      })
    };
  }
}