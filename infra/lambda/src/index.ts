import { Resource } from "sst";
import { task } from "sst/aws/task";
import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { CloudWatchLogsClient, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";

interface TaskResult {
  success: boolean;
  startTime: string;
  endTime: string;
  duration: number;
  command: string;
  result?: any;
  error?: string;
  metadata: {
    memoryUsage: any;
    platform: string;
    nodeVersion: string;
  };
}

interface TaskResponse {
  taskArn: string;
  status: string;
  result?: TaskResult;
  logs?: string[];
  executionStats: {
    waitTime: number;
    totalDuration: number;
  };
}

async function waitForTaskCompletion(taskArn: string, maxWaitTime = 300000): Promise<string> {
  const ecsClient = new ECSClient({});
  const startTime = Date.now();
  
  // Extract cluster name from task ARN
  // ARN format: arn:aws:ecs:region:account:task/cluster-name/task-id
  const clusterName = taskArn.split('/')[1];
  
  while (Date.now() - startTime < maxWaitTime) {
    const response = await ecsClient.send(new DescribeTasksCommand({
      cluster: clusterName,
      tasks: [taskArn]
    }));
    
    const task = response.tasks?.[0];
    if (!task) {
      throw new Error("Task not found");
    }
    
    const status = task.lastStatus;
    console.log(`Task status: ${status}`);
    
    if (status === "STOPPED") {
      return task.stopCode === "EssentialContainerExited" && 
             task.containers?.[0]?.exitCode === 0 ? "SUCCESS" : "FAILED";
    }
    
    // Wait 5 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  return "TIMEOUT";
}

async function getTaskLogs(taskArn: string): Promise<{ logs: string[], result?: TaskResult }> {
  const logsClient = new CloudWatchLogsClient({});
  const taskId = taskArn.split('/').pop();
  
  // Try different log group naming conventions
  const possibleLogGroups = [
    `/aws/ecs/ComputeTask`,
    `/ecs/ComputeTask`,
    `/aws/ecs/containerinsights/ComputeTask`,
    'ComputeTask'
  ];
  
  for (const logGroupName of possibleLogGroups) {
    try {
      // Try different log stream naming patterns
      const possibleLogStreams = [
        `ecs/ComputeTask/${taskId}`,
        `ComputeTask/${taskId}`,
        taskId,
        `fargate/${taskId}`
      ];
      
      for (const logStreamName of possibleLogStreams) {
        try {
          console.log(`Trying log group: ${logGroupName}, stream: ${logStreamName}`);
          
          const response = await logsClient.send(new GetLogEventsCommand({
            logGroupName,
            logStreamName,
            startFromHead: true
          }));
          
          const logs = response.events?.map(event => event.message || '') || [];
          let taskResult: TaskResult | undefined;
          
          // Parse the structured logs to extract the task result
          for (const log of logs) {
            if (log.includes('[TASK_SUCCESS]') || log.includes('[TASK_ERROR]')) {
              try {
                const resultJson = log.substring(log.indexOf('{'));
                taskResult = JSON.parse(resultJson);
                break;
              } catch (e) {
                console.warn('Failed to parse task result from log:', e);
              }
            }
          }
          
          if (logs.length > 0) {
            console.log(`Successfully retrieved logs from ${logGroupName}/${logStreamName}`);
            return { logs, result: taskResult };
          }
        } catch (streamError) {
          // Continue to next stream
          console.log(`Stream ${logStreamName} not found in ${logGroupName}`);
        }
      }
    } catch (groupError) {
      // Continue to next group
      console.log(`Log group ${logGroupName} not found`);
    }
  }
  
  console.warn('No logs found in any of the attempted log groups/streams');
  return { logs: [`No logs found for task ${taskId}. Task may still be starting or logs may not be available yet.`] };
}

export async function handler(event: { command?: string; body?: { command?: string } }) {
  const executionStart = Date.now();
  const command = event.command || event.body?.command || "default";
  
  try {
    console.log(`Starting task with command: ${command}`);
    
    // Start the task
    const runRet = await task.run(
      Resource.ComputeTask,
      {
        COMPUTE_COMMAND: command
      }
    );
    
    const taskArn = runRet.arn;
    console.log(`Task started with ARN: ${taskArn}`);
    
    // Wait for task completion
    const waitStart = Date.now();
    const finalStatus = await waitForTaskCompletion(taskArn);
    const waitTime = Date.now() - waitStart;
    
    // Get logs and results
    const { logs, result } = await getTaskLogs(taskArn);
    
    const response: TaskResponse = {
      taskArn,
      status: finalStatus,
      result,
      logs,
      executionStats: {
        waitTime,
        totalDuration: Date.now() - executionStart
      }
    };
    
    return {
      statusCode: finalStatus === "SUCCESS" ? 200 : 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(response, null, 2),
    };
    
  } catch (error) {
    console.error('Lambda execution error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        executionStats: {
          totalDuration: Date.now() - executionStart,
          waitTime: 0
        }
      }, null, 2),
    };
  }
}
