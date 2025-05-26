#!/bin/bash

# Secure and Scalable Compute Platform Deployment Script
# This script automates the deployment of the compute platform to AWS

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEFAULT_STAGE="dev"
DEFAULT_REGION="us-east-1"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js version
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 20 or later."
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        log_error "Node.js version 20 or later is required. Current version: $(node --version)"
        exit 1
    fi
    log_success "Node.js version: $(node --version)"
    
    # Check pnpm
    if ! command -v pnpm &> /dev/null; then
        log_warning "pnpm is not installed. Installing pnpm..."
        npm install -g pnpm
    fi
    log_success "pnpm version: $(pnpm --version)"
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed. Please install and configure AWS CLI."
        exit 1
    fi
    log_success "AWS CLI version: $(aws --version)"
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials are not configured. Please run 'aws configure'."
        exit 1
    fi
    
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    AWS_REGION=$(aws configure get region || echo $DEFAULT_REGION)
    log_success "AWS Account: $AWS_ACCOUNT, Region: $AWS_REGION"
}

install_dependencies() {
    log_info "Installing dependencies..."
    
    # Install root dependencies
    pnpm install
    
    # Install lambda dependencies
    cd infra/lambda
    pnpm install
    cd ../..
    
    # Install fargate dependencies
    cd infra/fargate
    pnpm install
    cd ../..
    
    log_success "Dependencies installed successfully"
}

build_project() {
    log_info "Building project..."
    
    # Build lambda functions
    cd infra/lambda
    pnpm build
    cd ../..
    
    # Build fargate container
    cd infra/fargate
    pnpm build
    cd ../..
    
    log_success "Project built successfully"
}

deploy_infrastructure() {
    local stage=$1
    local region=$2
    
    log_info "Deploying infrastructure to stage: $stage, region: $region"
    
    # Set AWS region if provided
    if [ ! -z "$region" ]; then
        export AWS_DEFAULT_REGION=$region
    fi
    
    # Deploy with SST
    if [ "$stage" = "production" ]; then
        log_warning "Deploying to PRODUCTION stage. This will create protected resources."
        read -p "Are you sure you want to continue? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Deployment cancelled."
            exit 0
        fi
    fi
    
    pnpm sst deploy --stage $stage
    
    log_success "Infrastructure deployed successfully"
}

get_outputs() {
    local stage=$1
    
    log_info "Getting deployment outputs..."
    
    # Get SST outputs
    OUTPUTS=$(pnpm sst outputs --stage $stage --format json 2>/dev/null || echo "{}")
    
    if [ "$OUTPUTS" != "{}" ]; then
        echo -e "\n${GREEN}=== Deployment Outputs ===${NC}"
        echo "$OUTPUTS" | jq -r 'to_entries[] | "\(.key): \(.value)"' 2>/dev/null || echo "$OUTPUTS"
        
        # Extract API URL for easy access
        API_URL=$(echo "$OUTPUTS" | jq -r '.api // empty' 2>/dev/null)
        if [ ! -z "$API_URL" ]; then
            echo -e "\n${BLUE}API Endpoint:${NC} $API_URL"
            echo -e "${BLUE}Health Check:${NC} $API_URL/health"
            echo -e "${BLUE}Submit Task:${NC} POST $API_URL/tasks"
        fi
    else
        log_warning "No outputs available. The deployment might still be in progress."
    fi
}

test_deployment() {
    local api_url=$1
    
    if [ -z "$api_url" ]; then
        log_warning "No API URL provided. Skipping deployment test."
        return
    fi
    
    log_info "Testing deployment..."
    
    # Test health endpoint
    log_info "Testing health endpoint..."
    if curl -s -f "$api_url/health" > /dev/null; then
        log_success "Health check passed"
    else
        log_warning "Health check failed or endpoint not ready yet"
    fi
    
    # Test task submission
    log_info "Testing task submission..."
    TASK_RESPONSE=$(curl -s -X POST "$api_url/tasks" \
        -H "Content-Type: application/json" \
        -d '{"command": "cpu-intensive", "priority": 1}' || echo "")
    
    if [ ! -z "$TASK_RESPONSE" ]; then
        TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.taskId // empty' 2>/dev/null)
        if [ ! -z "$TASK_ID" ]; then
            log_success "Task submitted successfully. Task ID: $TASK_ID"
            echo -e "${BLUE}Check status:${NC} curl $api_url/tasks/$TASK_ID"
        else
            log_warning "Task submission response: $TASK_RESPONSE"
        fi
    else
        log_warning "Task submission failed or endpoint not ready yet"
    fi
}

cleanup_on_error() {
    log_error "Deployment failed. You may want to clean up resources."
    log_info "To remove the deployment, run: pnpm sst remove --stage $STAGE"
}

show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -s, --stage STAGE      Deployment stage (default: $DEFAULT_STAGE)"
    echo "  -r, --region REGION    AWS region (default: $DEFAULT_REGION)"
    echo "  -t, --test             Run deployment tests after deployment"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                     Deploy to dev stage"
    echo "  $0 -s production       Deploy to production stage"
    echo "  $0 -s dev -r us-west-2 Deploy to dev stage in us-west-2"
    echo "  $0 -s dev -t           Deploy and run tests"
}

# Main script
main() {
    local stage=$DEFAULT_STAGE
    local region=$DEFAULT_REGION
    local run_tests=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -s|--stage)
                stage="$2"
                shift 2
                ;;
            -r|--region)
                region="$2"
                shift 2
                ;;
            -t|--test)
                run_tests=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Set global stage for cleanup function
    STAGE=$stage
    
    # Set up error handling
    trap cleanup_on_error ERR
    
    echo -e "${GREEN}=== Secure and Scalable Compute Platform Deployment ===${NC}"
    echo -e "Stage: ${BLUE}$stage${NC}"
    echo -e "Region: ${BLUE}$region${NC}"
    echo ""
    
    # Run deployment steps
    check_prerequisites
    install_dependencies
    build_project
    deploy_infrastructure $stage $region
    
    # Get and display outputs
    get_outputs $stage
    
    # Run tests if requested
    if [ "$run_tests" = true ]; then
        OUTPUTS=$(pnpm sst outputs --stage $stage --format json 2>/dev/null || echo "{}")
        API_URL=$(echo "$OUTPUTS" | jq -r '.api // empty' 2>/dev/null)
        test_deployment "$API_URL"
    fi
    
    echo ""
    log_success "Deployment completed successfully!"
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Test the API endpoints using the URLs above"
    echo "2. Check CloudWatch logs for detailed execution information"
    echo "3. Monitor the health endpoint for system status"
    echo "4. Review the README.md for API documentation"
    
    if [ "$stage" != "production" ]; then
        echo ""
        log_info "To deploy to production: $0 -s production"
    fi
}

# Run main function with all arguments
main "$@"