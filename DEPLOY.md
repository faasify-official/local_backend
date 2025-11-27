# Deploying to AWS Lambda as ZIP

This guide shows you how to deploy your Express app directly to AWS Lambda by uploading a ZIP file.

## Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Make sure `@vendia/serverless-express` is installed (it should be in package.json)

## Step 1: Create Deployment ZIP

### Option A: Using npm script (Recommended)

```bash
npm run package
```

This will create `deployment.zip` in the `localBackend` directory.

### Option B: Manual ZIP creation

**On Windows (PowerShell):**
```powershell
# Exclude node_modules/.cache and .git files
Compress-Archive -Path * -DestinationPath deployment.zip -Exclude node_modules\.cache\*,*.git*
```

**On Mac/Linux:**
```bash
zip -r deployment.zip . -x "*.git*" "node_modules/.cache/*" "*.zip" ".env"
```

**Important:** Make sure to include `node_modules` folder in the ZIP (Lambda needs all dependencies).

## Step 2: Upload to AWS Lambda

1. Go to **AWS Lambda Console** → **Functions** → **Create function**

2. Choose:
   - **Author from scratch**
   - Function name: `express-api` (or your choice)
   - Runtime: **Node.js 20.x** (or 18.x)
   - Architecture: **x86_64**

3. Click **Create function**

4. In the function page:
   - Scroll to **Code source**
   - Click **Upload from** → **.zip file**
   - Select your `deployment.zip` file
   - Click **Save**

5. Set the **Handler**:
   - In **Runtime settings**, click **Edit**
   - Handler: `lambda.handler`
   - Click **Save**

## Step 3: Configure Environment Variables

In Lambda function → **Configuration** → **Environment variables**, add:

```
AWS_REGION=us-west-2
ITEMS_TABLE=ListingsTable
STOREFRONTS_TABLE=StorefrontsTable
CART_TABLE=CartTable
ORDERS_TABLE=OrdersTable
REVIEWS_TABLE=ReviewsTable
USERS_TABLE=UsersTable
COGNITO_USER_POOL_ID=us-west-2_XXXXXXXXX
COGNITO_CLIENT_ID=your-client-id
CORS_ORIGINS=*
```

Add any other environment variables your app needs (STRIPE_SECRET_KEY if using payments, etc.)

**Note:** You do NOT need `JWT_SECRET` - your app uses Cognito for JWT verification. See `ENV-VARIABLES.md` for complete list.

## Step 4: Configure IAM Permissions

Your Lambda function needs permissions to access DynamoDB:

1. Go to **Configuration** → **Permissions**
2. Click on the **Execution role**
3. Add policies:
   - `AmazonDynamoDBFullAccess` (or create custom policy with only needed tables)
   - If using Cognito: `AmazonCognitoPowerUser` (or appropriate Cognito permissions)

## Step 5: Create API Gateway

1. Go to **API Gateway** → **Create API** → **REST API** → **Build**

2. Create API:
   - Protocol: **REST**
   - Create new API: **New API**
   - API name: `express-api`
   - Click **Create API**

3. Create Resource:
   - Click **Actions** → **Create Resource**
   - Resource Name: `{proxy+}`
   - Resource Path: `{proxy+}`
   - Enable **API Gateway CORS**
   - Click **Create Resource**

4. Create Method:
   - Select `{proxy+}` resource
   - Click **Actions** → **Create Method** → **ANY**
   - Integration type: **Lambda Function**
   - Lambda Function: Select your function
   - Click **Save** → **OK** (when asked for permission)

5. Deploy API:
   - Click **Actions** → **Deploy API**
   - Deployment stage: `prod` (or create new)
   - Click **Deploy**

6. Copy the **Invoke URL** - this is your API endpoint!

## Step 6: Test

Your API will be available at:
```
https://{api-id}.execute-api.{region}.amazonaws.com/prod/{proxy+}
```

Test with:
```bash
curl https://{api-id}.execute-api.{region}.amazonaws.com/prod/health
```

## Updating the Function

1. Make your code changes
2. Run `npm run package` again
3. Upload the new `deployment.zip` to Lambda
4. Click **Deploy** in Lambda

## Troubleshooting

- **"Cannot find module"**: Make sure `node_modules` is included in ZIP
- **"Handler not found"**: Check handler is set to `lambda.handler`
- **Timeout errors**: Increase Lambda timeout in Configuration → General configuration
- **CORS errors**: Make sure `CORS_ORIGINS` env var is set and API Gateway CORS is enabled

