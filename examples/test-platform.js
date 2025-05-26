#!/usr/bin/env node

/**
 * Secure and Scalable Compute Platform - Test Script
 * 
 * This script demonstrates how to use the compute platform API
 * to submit tasks, monitor their progress, and retrieve results.
 */

const API_BASE_URL = process.env.API_URL || 'https://your-api-url-here.com';

// Test scenarios
const TEST_SCENARIOS = [
  {
    name: 'CPU Intensive Task',
    command: 'cpu-intensive',
    priority: 3,
    expectedDuration: 5000
  },
  {
    name: 'Memory Intensive Task',
    command: 'memory-intensive',
    priority: 2,
    expectedDuration: 3000
  },
  {
    name: 'I/O Intensive Task',
    command: 'io-intensive',
    priority: 1,
    expectedDuration: 4000
  },
  {
    name: 'Network Test',
    command: 'network-test',
    priority: 4,
    expectedDuration: 2000
  },
  {
    name: 'High Priority Task',
    command: 'cpu-intensive',
    priority: 8,
    expectedDuration: 5000
  },
  {
    name: 'Custom Command',
    command: 'custom-data-processing',
    priority: 5,
    expectedDuration: 3000
  },
  {
    name: 'Error Simulation',
    command: 'error',
    priority: 1,
    expectedDuration: 1000,
    expectError: true
  }
];

// Utility functions
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logInfo(message) {
  log(`[INFO] ${message}`, 'blue');
}

function logSuccess(message) {
  log(`[SUCCESS] ${message}`, 'green');
}

function logError(message) {
  log(`[ERROR] ${message}`, 'red');
}

function logWarning(message) {
  log(`[WARNING] ${message}`, 'yellow');
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// API functions
async function makeRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data.error || data.message || 'Unknown error'}`);
    }
    
    return data;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error(`Network error: Unable to connect to ${url}. Please check the API_URL.`);
    }
    throw error;
  }
}

async function checkHealth() {
  logInfo('Checking platform health...');
  
  try {
    const health = await makeRequest('/health');
    
    if (health.status === 'healthy') {
      logSuccess('Platform is healthy');
      log(`  Database: ${health.checks.database ? '✓' : '✗'}`, health.checks.database ? 'green' : 'red');
      log(`  Storage: ${health.checks.storage ? '✓' : '✗'}`, health.checks.storage ? 'green' : 'red');
      log(`  Compute: ${health.checks.compute ? '✓' : '✗'}`, health.checks.compute ? 'green' : 'red');
      log(`  Active Tasks: ${health.metrics.activeTasks}`, 'cyan');
      log(`  Queued Tasks: ${health.metrics.queuedTasks}`, 'cyan');
      log(`  Completed Tasks: ${health.metrics.completedTasks}`, 'cyan');
      log(`  Failed Tasks: ${health.metrics.failedTasks}`, 'cyan');
    } else {
      logWarning(`Platform status: ${health.status}`);
    }
    
    return health.status === 'healthy';
  } catch (error) {
    logError(`Health check failed: ${error.message}`);
    return false;
  }
}

async function submitTask(scenario) {
  logInfo(`Submitting task: ${scenario.name}`);
  
  const taskData = {
    command: scenario.command,
    priority: scenario.priority,
    userId: `test-user-${Date.now()}`,
    metadata: {
      testScenario: scenario.name,
      submittedAt: new Date().toISOString(),
      expectedDuration: scenario.expectedDuration
    }
  };
  
  try {
    const response = await makeRequest('/tasks', {
      method: 'POST',
      body: JSON.stringify(taskData)
    });
    
    logSuccess(`Task submitted: ${response.taskId}`);
    log(`  Status: ${response.status}`, 'cyan');
    log(`  Priority: ${response.priority}`, 'cyan');
    log(`  Queue Type: ${response.queueType}`, 'cyan');
    log(`  Status URL: ${response.statusUrl}`, 'cyan');
    
    return response;
  } catch (error) {
    logError(`Failed to submit task: ${error.message}`);
    throw error;
  }
}

async function getTaskStatus(taskId) {
  try {
    const status = await makeRequest(`/tasks/${taskId}`);
    return status;
  } catch (error) {
    logError(`Failed to get task status: ${error.message}`);
    throw error;
  }
}

async function waitForTaskCompletion(taskId, maxWaitTime = 300000) { // 5 minutes max
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  
  logInfo(`Waiting for task ${taskId} to complete...`);
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const status = await getTaskStatus(taskId);
      
      if (status.isComplete) {
        return status;
      }
      
      log(`  Status: ${status.status} (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`, 'yellow');
      await sleep(pollInterval);
    } catch (error) {
      logWarning(`Error checking status: ${error.message}`);
      await sleep(pollInterval);
    }
  }
  
  throw new Error(`Task ${taskId} did not complete within ${maxWaitTime / 1000} seconds`);
}

async function runTestScenario(scenario) {
  log(`\n${'='.repeat(60)}`, 'bright');
  log(`Testing: ${scenario.name}`, 'bright');
  log(`${'='.repeat(60)}`, 'bright');
  
  try {
    // Submit the task
    const submission = await submitTask(scenario);
    const taskId = submission.taskId;
    
    // Wait for completion
    const result = await waitForTaskCompletion(taskId);
    
    // Display results
    logSuccess(`Task completed: ${result.status}`);
    log(`  Duration: ${result.duration}ms`, 'cyan');
    log(`  Created: ${result.createdAt}`, 'cyan');
    log(`  Completed: ${result.completedAt}`, 'cyan');
    
    if (result.detailedResults) {
      log(`  Result: ${JSON.stringify(result.detailedResults.result, null, 2)}`, 'magenta');
      
      if (result.detailedResults.metadata) {
        const metadata = result.detailedResults.metadata;
        if (metadata.memoryUsage) {
          log(`  Memory Usage: ${JSON.stringify(metadata.memoryUsage, null, 2)}`, 'cyan');
        }
        if (metadata.containerInfo) {
          log(`  Container: ${metadata.containerInfo.cpu} CPU, ${metadata.containerInfo.memory} memory`, 'cyan');
        }
      }
    }
    
    // Validate expectations
    if (scenario.expectError && result.status === 'SUCCESS') {
      logWarning('Expected task to fail, but it succeeded');
    } else if (!scenario.expectError && result.status === 'FAILED') {
      logWarning('Expected task to succeed, but it failed');
    } else {
      logSuccess('Task result matches expectations');
    }
    
    return { success: true, result };
    
  } catch (error) {
    logError(`Test scenario failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runBatchTest() {
  log(`\n${'='.repeat(60)}`, 'bright');
  log('Running Batch Test (Multiple Concurrent Tasks)', 'bright');
  log(`${'='.repeat(60)}`, 'bright');
  
  const batchTasks = [
    { command: 'cpu-intensive', priority: 1 },
    { command: 'memory-intensive', priority: 2 },
    { command: 'io-intensive', priority: 3 },
    { command: 'network-test', priority: 4 },
    { command: 'cpu-intensive', priority: 5 }
  ];
  
  try {
    // Submit all tasks concurrently
    logInfo('Submitting batch of tasks...');
    const submissions = await Promise.all(
      batchTasks.map(async (task, index) => {
        const taskData = {
          command: task.command,
          priority: task.priority,
          userId: `batch-user-${index}`,
          metadata: { batchIndex: index, batchSize: batchTasks.length }
        };
        
        return await makeRequest('/tasks', {
          method: 'POST',
          body: JSON.stringify(taskData)
        });
      })
    );
    
    logSuccess(`Submitted ${submissions.length} tasks`);
    submissions.forEach((sub, index) => {
      log(`  Task ${index + 1}: ${sub.taskId} (${sub.queueType} queue)`, 'cyan');
    });
    
    // Wait for all to complete
    logInfo('Waiting for all tasks to complete...');
    const results = await Promise.all(
      submissions.map(sub => waitForTaskCompletion(sub.taskId))
    );
    
    // Analyze results
    const successful = results.filter(r => r.status === 'SUCCESS').length;
    const failed = results.filter(r => r.status === 'FAILED').length;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    logSuccess(`Batch test completed: ${successful} successful, ${failed} failed`);
    log(`  Average duration: ${Math.round(avgDuration)}ms`, 'cyan');
    
    return { successful, failed, avgDuration };
    
  } catch (error) {
    logError(`Batch test failed: ${error.message}`);
    throw error;
  }
}

async function main() {
  log('🚀 Secure and Scalable Compute Platform - Test Suite', 'bright');
  log('=' .repeat(60), 'bright');
  
  // Check if API URL is configured
  if (API_BASE_URL === 'https://your-api-url-here.com') {
    logError('Please set the API_URL environment variable to your deployed API endpoint');
    logInfo('Example: export API_URL=https://your-api-gateway-url.amazonaws.com');
    process.exit(1);
  }
  
  logInfo(`Testing API at: ${API_BASE_URL}`);
  
  try {
    // Health check
    const isHealthy = await checkHealth();
    if (!isHealthy) {
      logWarning('Platform is not healthy, but continuing with tests...');
    }
    
    // Run individual test scenarios
    const results = [];
    for (const scenario of TEST_SCENARIOS) {
      const result = await runTestScenario(scenario);
      results.push({ scenario: scenario.name, ...result });
      
      // Small delay between tests
      await sleep(2000);
    }
    
    // Run batch test
    await sleep(5000);
    const batchResult = await runBatchTest();
    
    // Summary
    log(`\n${'='.repeat(60)}`, 'bright');
    log('Test Summary', 'bright');
    log(`${'='.repeat(60)}`, 'bright');
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    logInfo(`Individual Tests: ${successful} passed, ${failed} failed`);
    logInfo(`Batch Test: ${batchResult.successful} successful, ${batchResult.failed} failed`);
    
    if (failed === 0) {
      logSuccess('All tests passed! 🎉');
    } else {
      logWarning(`${failed} tests failed. Check the logs above for details.`);
    }
    
    // Failed test details
    const failedTests = results.filter(r => !r.success);
    if (failedTests.length > 0) {
      log('\nFailed Tests:', 'red');
      failedTests.forEach(test => {
        log(`  - ${test.scenario}: ${test.error}`, 'red');
      });
    }
    
  } catch (error) {
    logError(`Test suite failed: ${error.message}`);
    process.exit(1);
  }
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node test-platform.js [options]

Environment Variables:
  API_URL    The base URL of your deployed compute platform API

Options:
  -h, --help    Show this help message

Examples:
  export API_URL=https://your-api.amazonaws.com
  node test-platform.js
  
  # Or inline:
  API_URL=https://your-api.amazonaws.com node test-platform.js
`);
  process.exit(0);
}

// Run the test suite
main().catch(error => {
  logError(`Unhandled error: ${error.message}`);
  process.exit(1);
});