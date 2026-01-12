# Cloud Infrastructure Deployment Guide

## Overview

This directory contains the complete cloud infrastructure setup for Aegispay, including:

- **Docker**: Containerization with multi-stage builds
- **Docker Compose**: Local development environment with all dependencies
- **Kubernetes**: Production-ready K8s manifests with HPA, ingress, and monitoring
- **Terraform**: Infrastructure as Code for AWS (EKS, RDS, ElastiCache, VPC)
- **Monitoring**: Prometheus, Grafana, and Jaeger for observability

## Quick Start

### Local Development with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f aegispay

# Stop all services
docker-compose down

# Clean up volumes
docker-compose down -v
```

Services will be available at:

- Aegispay API: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- Kafka: localhost:9092
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin)
- Jaeger UI: http://localhost:16686

### Build Docker Image

```bash
# Build production image
docker build -t aegispay:latest .

# Build with specific tag
docker build -t aegispay:v1.0.0 .

# Build and push to registry
docker build -t your-registry/aegispay:latest .
docker push your-registry/aegispay:latest
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (EKS, GKE, AKS, or local minikube)
- kubectl configured
- Helm 3.x installed

### Deploy to Kubernetes

```bash
# Create namespace
kubectl apply -f k8s/ingress.yaml

# Create secrets and configmaps
kubectl apply -f k8s/config.yaml

# Update secrets with real values
kubectl edit secret aegispay-secrets -n aegispay
kubectl edit secret aegispay-gateway-secrets -n aegispay

# Deploy application
kubectl apply -f k8s/deployment.yaml

# Check status
kubectl get pods -n aegispay
kubectl get svc -n aegispay
kubectl get ingress -n aegispay

# View logs
kubectl logs -f deployment/aegispay-deployment -n aegispay

# Scale deployment
kubectl scale deployment aegispay-deployment --replicas=5 -n aegispay
```

### Ingress Setup

```bash
# Install NGINX Ingress Controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install nginx-ingress ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace

# Install cert-manager for TLS
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

## Terraform Infrastructure (AWS)

### Prerequisites

- AWS CLI configured with credentials
- Terraform 1.5+ installed
- S3 bucket for Terraform state (create manually first)
- DynamoDB table for state locking

### Initialize Terraform

```bash
cd terraform

# Initialize
terraform init

# Create tfvars file
cat > terraform.tfvars <<EOF
aws_region = "us-east-1"
environment = "production"
cluster_name = "aegispay-eks-cluster"
vpc_cidr = "10.0.0.0/16"
db_password = "your-secure-password"
EOF

# Plan
terraform plan

# Apply
terraform apply
```

### Infrastructure Components Created

1. **Networking**
   - VPC with public/private subnets across 3 AZs
   - Internet Gateway and NAT Gateways
   - Route tables and security groups

2. **EKS Cluster**
   - Managed Kubernetes cluster v1.28
   - Node groups (general and compute)
   - Auto-scaling configuration
   - AWS Load Balancer Controller

3. **Database**
   - RDS PostgreSQL 16.1 (Multi-AZ)
   - Automated backups and encryption
   - Performance Insights enabled

4. **Cache**
   - ElastiCache Redis 7.0 (Multi-AZ)
   - Automatic failover
   - Encryption at rest and in transit

### Connect to EKS Cluster

```bash
# Update kubeconfig
aws eks update-kubeconfig --region us-east-1 --name aegispay-eks-cluster

# Verify connection
kubectl get nodes
```

### Terraform Outputs

```bash
# Get RDS endpoint
terraform output db_endpoint

# Get Redis endpoint
terraform output redis_endpoint

# Get EKS cluster name
terraform output cluster_name
```

## Monitoring Setup

### Prometheus

Prometheus is configured to scrape metrics from:

- Aegispay application pods
- Kubernetes API server
- Node metrics
- PostgreSQL exporter
- Redis exporter

Access: http://localhost:9090 (local) or via K8s port-forward

### Grafana

Pre-configured dashboards for:

- Payment processing metrics
- System health and performance
- Database metrics
- Redis metrics
- Kubernetes cluster overview

Default credentials: admin/admin

### Jaeger Tracing

Distributed tracing for:

- Payment flow across services
- Gateway calls
- Database queries
- External API calls

Access: http://localhost:16686 (local)

## Production Best Practices

### Security

1. **Secrets Management**
   - Use AWS Secrets Manager or Kubernetes Secrets
   - Never commit secrets to Git
   - Rotate credentials regularly

2. **Network Security**
   - Enable VPC flow logs
   - Use security groups and NACLs
   - Enable encryption in transit and at rest

3. **Access Control**
   - Use IAM roles for service accounts (IRSA)
   - Enable RBAC in Kubernetes
   - Implement least privilege principle

### High Availability

1. **Multi-AZ Deployment**
   - Spread pods across availability zones
   - Use multi-AZ RDS and ElastiCache

2. **Auto-scaling**
   - HPA for application pods (CPU/memory based)
   - Cluster Autoscaler for nodes
   - Database read replicas for read-heavy workloads

3. **Health Checks**
   - Liveness and readiness probes configured
   - Health check endpoints implemented
   - Automatic pod restarts on failure

### Monitoring & Alerting

1. **Key Metrics**
   - Payment success rate
   - Gateway latency (p50, p95, p99)
   - Error rates by type
   - Database connection pool
   - Redis cache hit rate

2. **Alerts**
   - High error rates (>5%)
   - Latency spikes (>1s)
   - Database CPU >80%
   - Pod crash loops
   - Certificate expiration

3. **Logging**
   - Structured JSON logs
   - Log aggregation (ELK/CloudWatch)
   - Retention policies configured

### Disaster Recovery

1. **Backups**
   - Automated RDS snapshots (daily)
   - Point-in-time recovery enabled
   - Backup retention: 7 days

2. **Data Replication**
   - Multi-AZ RDS with synchronous replication
   - ElastiCache with automatic failover
   - Cross-region replication (optional)

3. **Recovery Procedures**
   - Document RTO/RPO targets
   - Test restore procedures regularly
   - Maintain runbooks for common failures

## Cost Optimization

1. **Right-sizing**
   - Start with t3.medium instances
   - Monitor and adjust based on metrics
   - Use spot instances for non-critical workloads

2. **Reserved Instances**
   - Purchase RIs for production workloads
   - 1-year or 3-year commitments for savings

3. **Auto-scaling**
   - Scale down during off-peak hours
   - Use HPA to match load
   - Enable cluster autoscaler

## Troubleshooting

### Common Issues

1. **Pods not starting**

   ```bash
   kubectl describe pod <pod-name> -n aegispay
   kubectl logs <pod-name> -n aegispay
   ```

2. **Database connection errors**
   - Check security groups
   - Verify credentials in secrets
   - Test connection from pod: `kubectl exec -it <pod> -n aegispay -- bash`

3. **High latency**
   - Check Prometheus metrics
   - Review Jaeger traces
   - Verify database query performance

4. **Certificate issues**
   ```bash
   kubectl describe certificate aegispay-tls -n aegispay
   kubectl describe certificaterequest -n aegispay
   ```

## CI/CD Integration

The GitHub Actions workflow automatically:

1. Builds Docker images on push
2. Runs security scans
3. Pushes to container registry
4. Updates Kubernetes deployments
5. Runs smoke tests

See `.github/workflows/ci.yml` for details.

## Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [AWS EKS Best Practices](https://aws.github.io/aws-eks-best-practices/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)

## Support

For issues or questions:

- Open a GitHub issue
- Check existing documentation
- Review logs and metrics first
