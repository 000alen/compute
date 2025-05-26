# Secure and Scalable Compute Platform

A cloud-native, secure, and scalable compute platform built with AWS services that provides on-demand task execution using containers. The platform supports priority queuing, user isolation, comprehensive monitoring, and automatic scaling.

## 🏗️ Architecture

The platform is built using modern cloud-native technologies:

- **Container Runtime**: AWS Fargate for secure, isolated task execution
- **Queue System**: Amazon SQS with priority and dead letter queues
- **Storage**: DynamoDB for metadata, S3 for results and logs
- **API**: API Gateway with Lambda functions for REST endpoints
- **Monitoring**: CloudWatch for metrics, alarms, and health checks
- **Infrastructure**: SST (Serverless Stack) for Infrastructure as Code

## 🚀 Features

### Security
- **Container Isolation**: Each task runs in an isolated Fargate container
- **VPC Security**: Private subnets with controlled egress
- **IAM Roles**: Minimal permissions with least-privilege access
- **User Context**: Task execution with user identification and tracking

### Scalability
- **Auto-scaling**: ECS cluster scales from 0 to 100 containers
- **Priority Queues**: High-priority tasks get faster execution
- **Dead Letter Queues**: Failed tasks are captured for analysis
- **Batch Processing**: Efficient handling of multiple tasks

### Monitoring & Observability
- **Health Checks**: Automated system health monitoring
- **Metrics Collection**: Task statistics and performance data
- **CloudWatch Integration**: Comprehensive logging and alerting
- **Status Tracking**: Real-time task status and progress

### Task Management
- **Multiple Workload Types**: CPU, memory, I/O, and network intensive tasks
- **Timeout Handling**: Configurable task timeouts
- **Result Storage**: Detailed results stored in S3
- **Error Handling**: Comprehensive error capture and reporting

## 📋 API Reference

### Submit a Task

```bash
POST /tasks
Content-Type: application/json

{
  "command": "cpu-intensive",
  "priority": 5,
  "userId": "user123",
  "timeout": 300,
  "metadata": {
    "project": "ml-training",
    "environment": "production"
  }
}
```

**Response:**
```json
{
  "success": true,
  "taskId": "uuid-task-id",
  "status": "PENDING",
  "priority": 5,
  "queueType": "priority",
  "message": "Task queued for processing",
  "statusUrl": "https://api.example.com/tasks/uuid-task-id",
  "estimatedStartTime": "2024-01-01T12:30:00Z"
}
```

### Get Task Status

```bash
GET /tasks/{taskId}
```

**Response:**
```json
{
  "taskId": "uuid-task-id",
  "status": "SUCCESS",
  "command": "cpu-intensive",
  "priority": 5,
  "userId": "user123",
  "createdAt": "2024-01-01T12:00:00Z",
  "completedAt": "2024-01-01T12:05:00Z",
  "duration": 300000,
  "detailedResults": {
    "success": true,
    "result": {
      "message": "CPU-intensive task completed",
      "iterations": 1000000,
      "duration": 298000
    },
    "metadata": {
      "memoryUsage": {
        "heapUsed": "45.2 MB",
        "heapTotal": "67.8 MB"
      },
      "containerInfo": {
        "cpu": "256",
        "memory": "512",
        "architecture": "x86_64"
      }
    }
  }
}
```

### Health Check

```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "checks": {
    "database": true,
    "storage": true,
    "compute": true
  },
  "metrics": {
    "activeTasks": 3,
    "queuedTasks": 12,
    "failedTasks": 1,
    "completedTasks": 156
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## 🔧 Supported Task Types

### CPU Intensive
```json
{ "command": "cpu-intensive" }
```
Performs mathematical calculations to test CPU performance.

### Memory Intensive
```json
{ "command": "memory-intensive" }
```
Allocates and processes large arrays to test memory usage.

### I/O Intensive
```json
{ "command": "io-intensive" }
```
Creates, writes, reads, and deletes files to test I/O performance.

### Network Test
```json
{ "command": "network-test" }
```
Makes HTTP requests to test network connectivity and performance.

### Custom Commands
```json
{ "command": "your-custom-command" }
```
Any custom command will be processed with simulated execution time.

### Error Simulation
```json
{ "command": "error" }
```
Simulates task failure for testing error handling.

### Timeout Test
```json
{ "command": "timeout" }
```
Long-running task (5 minutes) for testing timeout handling.

## 🚀 Deployment

### Prerequisites
- Node.js 20+
- pnpm package manager
- AWS CLI configured
- SST CLI installed

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd compute-platform
pnpm install
```

2. **Deploy to AWS:**
```bash
# Deploy to development
pnpm sst deploy

# Deploy to production
pnpm sst deploy --stage production
```

3. **Get deployment outputs:**
```bash
pnpm sst outputs
```

### Environment Configuration

The platform automatically configures the following environments:

- **Development**: Auto-scaling, shorter retention periods
- **Production**: Enhanced security, longer retention, protection enabled

## 📊 Monitoring and Operations

### CloudWatch Metrics

The platform provides comprehensive metrics:

- **Queue Depth**: Number of pending tasks
- **Task Success Rate**: Percentage of successful completions
- **Execution Duration**: Average task execution time
- **Error Rate**: Failed task percentage

### Automated Cleanup

- **Task History**: Automatically cleans up old completed tasks (24h default)
- **Log Retention**: CloudWatch logs retained for 1 week
- **S3 Lifecycle**: Versioned objects with intelligent tiering

### Scaling Behavior

- **Scale Out**: New containers start within 60 seconds under load
- **Scale In**: Containers terminate after 5 minutes of inactivity
- **Queue Routing**: High-priority tasks (priority ≥ 5) use priority queue
- **Load Balancing**: Tasks distributed across available capacity

## 🔒 Security Features

### Network Security
- **VPC Isolation**: All resources in private subnets
- **NAT Gateway**: Controlled internet access for containers
- **Security Groups**: Minimal required ports and protocols

### Access Control
- **IAM Roles**: Service-specific roles with minimal permissions
- **Resource Policies**: Fine-grained access to S3 and DynamoDB
- **API Authentication**: Ready for integration with authentication providers

### Data Protection
- **Encryption**: Data encrypted in transit and at rest
- **Audit Trail**: All API calls and task executions logged
- **User Isolation**: Tasks tagged with user context

## 🛠️ Development

### Local Development

```bash
# Start local development
pnpm sst dev

# Run specific component
cd infra/fargate && pnpm dev
cd infra/lambda && pnpm build
```

### Testing

```bash
# Test task submission
curl -X POST https://your-api-url/tasks \
  -H "Content-Type: application/json" \
  -d '{"command": "cpu-intensive", "priority": 5}'

# Check task status
curl https://your-api-url/tasks/{taskId}

# Health check
curl https://your-api-url/health
```

### Custom Task Types

To add new task types, modify `infra/fargate/entrypoint.ts`:

```typescript
case "your-new-task":
  return await yourCustomFunction();
```

## 📈 Performance Characteristics

### Latency
- **Queue to Start**: 30-120 seconds (priority dependent)
- **API Response**: < 100ms for task submission
- **Status Check**: < 50ms for status queries

### Throughput
- **Concurrent Tasks**: Up to 100 containers
- **Queue Capacity**: Unlimited (SQS)
- **API Rate Limit**: 10,000 requests/second (API Gateway)

### Resource Limits
- **Container CPU**: 256 CPU units (0.25 vCPU)
- **Container Memory**: 512 MB
- **Task Timeout**: Configurable (default 5 minutes)
- **Queue Visibility**: 15 minutes

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:

1. Check the CloudWatch logs for task execution details
2. Use the health endpoint to verify system status
3. Review the API documentation for proper request format
4. Check AWS console for infrastructure status

## 🔮 Roadmap

- [ ] WebSocket support for real-time task updates
- [ ] Multi-region deployment support
- [ ] Custom container image support
- [ ] Advanced scheduling algorithms
- [ ] Cost optimization features
- [ ] Integration with CI/CD pipelines