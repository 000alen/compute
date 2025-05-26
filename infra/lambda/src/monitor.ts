import "./types";
import { Resource } from "sst";
import { DynamoDBClient, ScanCommand, UpdateItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ECSClient, DescribeTasksCommand, ListTasksCommand } from "@aws-sdk/client-ecs";

interface MonitorEvent {
  action?: "health" | "cleanup" | "metrics";
  maxAge?: number; // in hours
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    database: boolean;
    storage: boolean;
    compute: boolean;
  };
  metrics: {
    activeTasks: number;
    queuedTasks: number;
    failedTasks: number;
    completedTasks: number;
  };
  timestamp: string;
}

export async function handler(event: MonitorEvent = {}) {
  const action = event.action || "health";
  
  switch (action) {
    case "health":
      return await performHealthCheck();
    case "cleanup":
      return await performCleanup(event.maxAge || 24);
    case "metrics":
      return await collectMetrics();
    default:
      return await performHealthCheck();
  }
}

async function performHealthCheck(): Promise<any> {
  const dynamoClient = new DynamoDBClient({});
  const s3Client = new S3Client({});
  const ecsClient = new ECSClient({});
  
  const healthStatus: HealthStatus = {
    status: "healthy",
    checks: {
      database: false,
      storage: false,
      compute: false
    },
    metrics: {
      activeTasks: 0,
      queuedTasks: 0,
      failedTasks: 0,
      completedTasks: 0
    },
    timestamp: new Date().toISOString()
  };
  
  try {
    // Check DynamoDB health
    try {
      const dbResponse = await dynamoClient.send(new ScanCommand({
        TableName: Resource.TaskResults.name,
        Limit: 1
      }));
      healthStatus.checks.database = true;
    } catch (error) {
      console.error('Database health check failed:', error);
      healthStatus.checks.database = false;
    }
    
    // Check S3 health
    try {
      await s3Client.send(new ListObjectsV2Command({
        Bucket: Resource.TaskResultsBucket.name,
        MaxKeys: 1
      }));
      healthStatus.checks.storage = true;
    } catch (error) {
      console.error('Storage health check failed:', error);
      healthStatus.checks.storage = false;
    }
    
    // Check ECS cluster health
    try {
      const tasksResponse = await ecsClient.send(new ListTasksCommand({
        cluster: Resource.ComputeCluster.name,
        maxResults: 10
      }));
      healthStatus.checks.compute = true;
      healthStatus.metrics.activeTasks = tasksResponse.taskArns?.length || 0;
    } catch (error) {
      console.error('Compute health check failed:', error);
      healthStatus.checks.compute = false;
    }
    
    // Collect task metrics from DynamoDB
    try {
      const [queuedTasks, failedTasks, completedTasks] = await Promise.all([
        dynamoClient.send(new ScanCommand({
          TableName: Resource.TaskResults.name,
          FilterExpression: "#status = :status",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": { S: "QUEUED" } },
          Select: "COUNT"
        })),
        dynamoClient.send(new ScanCommand({
          TableName: Resource.TaskResults.name,
          FilterExpression: "#status = :status",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": { S: "FAILED" } },
          Select: "COUNT"
        })),
        dynamoClient.send(new ScanCommand({
          TableName: Resource.TaskResults.name,
          FilterExpression: "#status = :status",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": { S: "SUCCESS" } },
          Select: "COUNT"
        }))
      ]);
      
      healthStatus.metrics.queuedTasks = queuedTasks.Count || 0;
      healthStatus.metrics.failedTasks = failedTasks.Count || 0;
      healthStatus.metrics.completedTasks = completedTasks.Count || 0;
    } catch (error) {
      console.error('Failed to collect metrics:', error);
    }
    
    // Determine overall health status
    const failedChecks = Object.values(healthStatus.checks).filter(check => !check).length;
    if (failedChecks === 0) {
      healthStatus.status = "healthy";
    } else if (failedChecks === 1) {
      healthStatus.status = "degraded";
    } else {
      healthStatus.status = "unhealthy";
    }
    
    // Always return 200 and include health status in the body
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(healthStatus, null, 2)
    };
    
  } catch (error) {
    console.error('Health check error:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: "unhealthy",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      })
    };
  }
}

async function performCleanup(maxAgeHours: number): Promise<any> {
  const dynamoClient = new DynamoDBClient({});
  const s3Client = new S3Client({});
  
  const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  let cleanedTasks = 0;
  let cleanedFiles = 0;
  
  try {
    console.log(`Starting cleanup of tasks older than ${maxAgeHours} hours`);
    
    // Find old completed/failed tasks
    const scanResponse = await dynamoClient.send(new ScanCommand({
      TableName: Resource.TaskResults.name,
      FilterExpression: "#status IN (:success, :failed) AND createdAt < :cutoff",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":success": { S: "SUCCESS" },
        ":failed": { S: "FAILED" },
        ":cutoff": { S: cutoffTime.toISOString() }
      }
    }));
    
    if (scanResponse.Items) {
      for (const item of scanResponse.Items) {
        const taskId = item.taskId?.S;
        if (!taskId) continue;
        
        try {
          // Delete from DynamoDB
          await dynamoClient.send(new DeleteItemCommand({
            TableName: Resource.TaskResults.name,
            Key: { taskId: { S: taskId } }
          }));
          
          // Delete from S3
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: Resource.TaskResultsBucket.name,
              Key: `results/${taskId}.json`
            }));
            cleanedFiles++;
          } catch (s3Error) {
            console.warn(`Failed to delete S3 object for task ${taskId}:`, s3Error);
          }
          
          cleanedTasks++;
          
        } catch (error) {
          console.error(`Failed to cleanup task ${taskId}:`, error);
        }
      }
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "Cleanup completed",
        cleanedTasks,
        cleanedFiles,
        cutoffTime: cutoffTime.toISOString(),
        maxAgeHours
      })
    };
    
  } catch (error) {
    console.error('Cleanup error:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        message: "Cleanup failed"
      })
    };
  }
}

async function collectMetrics(): Promise<any> {
  const dynamoClient = new DynamoDBClient({});
  const ecsClient = new ECSClient({});
  
  try {
    // Get task statistics
    const [totalTasks, runningTasks, successTasks, failedTasks, queuedTasks] = await Promise.all([
      dynamoClient.send(new ScanCommand({
        TableName: Resource.TaskResults.name,
        Select: "COUNT"
      })),
      dynamoClient.send(new ScanCommand({
        TableName: Resource.TaskResults.name,
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": { S: "RUNNING" } },
        Select: "COUNT"
      })),
      dynamoClient.send(new ScanCommand({
        TableName: Resource.TaskResults.name,
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": { S: "SUCCESS" } },
        Select: "COUNT"
      })),
      dynamoClient.send(new ScanCommand({
        TableName: Resource.TaskResults.name,
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": { S: "FAILED" } },
        Select: "COUNT"
      })),
      dynamoClient.send(new ScanCommand({
        TableName: Resource.TaskResults.name,
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": { S: "QUEUED" } },
        Select: "COUNT"
      }))
    ]);
    
    // Get ECS cluster metrics
    const activeTasks = await ecsClient.send(new ListTasksCommand({
      cluster: Resource.ComputeCluster.name
    }));
    
    const metrics = {
      tasks: {
        total: totalTasks.Count || 0,
        running: runningTasks.Count || 0,
        success: successTasks.Count || 0,
        failed: failedTasks.Count || 0,
        queued: queuedTasks.Count || 0,
        active: activeTasks.taskArns?.length || 0
      },
      successRate: totalTasks.Count ? 
        ((successTasks.Count || 0) / totalTasks.Count * 100).toFixed(2) + '%' : 
        'N/A',
      timestamp: new Date().toISOString()
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics, null, 2)
    };
    
  } catch (error) {
    console.error('Metrics collection error:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        message: "Metrics collection failed"
      })
    };
  }
}