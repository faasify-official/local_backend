# Deploy API Gateway with CloudFormation

This guide shows you how to deploy API Gateway using the CloudFormation template.

## Prerequisites

- ✅ Lambda function named `express-api` already deployed
- ✅ AWS CLI configured (or use AWS Console)
- ✅ Appropriate IAM permissions

## Option 1: Deploy via AWS Console

1. **Go to CloudFormation Console**
   - https://console.aws.amazon.com/cloudformation

2. **Create Stack**
   - Click **Create stack** → **With new resources (standard)**

3. **Specify Template**
   - Choose **Upload a template file**
   - Select `api-gateway-cloudformation.yaml`
   - Click **Next**

4. **Specify Stack Details**
   - **Stack name**: `express-api-gateway` (or your choice)
   - **Parameters**:
     - **LambdaFunctionName**: `express-api` (your Lambda function name)
     - **StageName**: `prod` (or `dev`, `staging`)
     - **CORSOrigin**: `*` (or your frontend domain like `https://yourdomain.com`)
     - **ThrottleRateLimit**: `10000` (requests per second)
     - **ThrottleBurstLimit**: `5000` (burst limit)
   - Click **Next**

5. **Configure Stack Options** (optional)
   - Add tags if needed
   - Click **Next**

6. **Review**
   - Review settings
   - Check **I acknowledge that AWS CloudFormation might create IAM resources**
   - Click **Create stack**

7. **Wait for Creation**
   - Stack creation takes 1-2 minutes
   - Status will show **CREATE_COMPLETE** when done

8. **Get Your API URL**
   - Go to **Outputs** tab
   - Copy the **ApiGatewayUrl** value
   - This is your API endpoint!

## Option 2: Deploy via AWS CLI

```bash
# Create the stack
aws cloudformation create-stack \
  --stack-name express-api-gateway \
  --template-body file://api-gateway-cloudformation.yaml \
  --parameters \
    ParameterKey=LambdaFunctionName,ParameterValue=express-api \
    ParameterKey=StageName,ParameterValue=prod \
    ParameterKey=CORSOrigin,ParameterValue='*' \
    ParameterKey=ThrottleRateLimit,ParameterValue=10000 \
    ParameterKey=ThrottleBurstLimit,ParameterValue=5000 \
  --capabilities CAPABILITY_NAMED_IAM

# Wait for stack creation
aws cloudformation wait stack-create-complete --stack-name express-api-gateway

# Get the API URL
aws cloudformation describe-stacks \
  --stack-name express-api-gateway \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
  --output text
```

## Option 3: Update Existing Stack

If you need to update the API Gateway:

```bash
aws cloudformation update-stack \
  --stack-name express-api-gateway \
  --template-body file://api-gateway-cloudformation.yaml \
  --parameters \
    ParameterKey=LambdaFunctionName,ParameterValue=express-api \
    ParameterKey=StageName,ParameterValue=prod \
    ParameterKey=CORSOrigin,ParameterValue='*'
```

## What Gets Created

- ✅ REST API (Regional endpoint)
- ✅ `{proxy+}` resource (catch-all for all routes)
- ✅ Root resource (for routes like `/health`)
- ✅ ANY methods on both resources (routes to Lambda)
- ✅ OPTIONS methods for CORS
- ✅ Lambda permission (allows API Gateway to invoke Lambda)
- ✅ API Deployment to stage
- ✅ Usage plan with throttling

## Testing Your API

After deployment, test with:

```bash
# Health check
curl https://YOUR-API-ID.execute-api.us-west-2.amazonaws.com/prod/health

# Should return:
# {"status":"ok","message":"Backend server is running"}
```

## Parameters Explained

- **LambdaFunctionName**: Your existing Lambda function name (default: `express-api`)
- **StageName**: Deployment stage (default: `prod`)
- **CORSOrigin**: Allowed CORS origin (default: `*` for all, use specific domain in production)
- **ThrottleRateLimit**: Max requests per second (default: 10000)
- **ThrottleBurstLimit**: Burst limit (default: 5000)

## Updating CORS

To change CORS settings:

1. Update the stack with new `CORSOrigin` parameter
2. Or manually edit the OPTIONS methods in API Gateway console

## Custom Domain (Optional)

To add a custom domain:

1. Go to API Gateway → **Custom Domain Names**
2. Create domain
3. Configure SSL certificate
4. Create API mapping to your API and stage

## Troubleshooting

### Stack Creation Fails

- ✅ Check Lambda function name is correct
- ✅ Verify you have IAM permissions
- ✅ Check CloudFormation events for specific errors

### Error: "API Stage not found"

If you get an error about the stage not being found:

1. **Delete the failed stack** (if it exists)
2. **Try deploying again** - the template has been fixed to create the stage properly
3. **Alternative**: If it still fails, you can manually create the stage in API Gateway console after the stack is created

The template now uses `StageName` in the Deployment resource, which automatically creates the stage.

### 403 Forbidden

- ✅ Check Lambda permission was created
- ✅ Verify Lambda function name matches
- ✅ Check API Gateway can invoke Lambda

### CORS Errors

- ✅ Verify CORSOrigin parameter is set correctly
- ✅ Check OPTIONS methods are created
- ✅ Ensure frontend uses correct API URL

## Cleanup

To delete the API Gateway:

```bash
aws cloudformation delete-stack --stack-name express-api-gateway
```

Or use AWS Console → CloudFormation → Delete stack

## Next Steps

1. ✅ Test your API endpoints
2. ✅ Update frontend to use new API URL
3. ✅ Set up custom domain (optional)
4. ✅ Configure monitoring and alerts
5. ✅ Set up CI/CD for updates

