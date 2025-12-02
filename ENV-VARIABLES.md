# Environment Variables for AWS Lambda

## Required Variables

### AWS Configuration
```
AWS_REGION=us-west-2
```
- Your AWS region (e.g., `us-west-2`, `us-east-1`)

### Cognito Configuration
```
COGNITO_USER_POOL_ID=us-west-2_XXXXXXXXX
COGNITO_CLIENT_ID=your-app-client-id
```
- **COGNITO_USER_POOL_ID**: Your Cognito User Pool ID (format: `{region}_{random}`)
- **COGNITO_CLIENT_ID**: Your Cognito App Client ID

**Optional Cognito:**
```
COGNITO_CLIENT_SECRET=your-client-secret
```
- Only needed if your Cognito App Client has a secret configured

### DynamoDB Tables
```
USERS_TABLE=UsersTable
STOREFRONTS_TABLE=StorefrontsTable
ITEMS_TABLE=ListingsTable
CART_TABLE=CartTable
ORDERS_TABLE=OrdersTable
REVIEWS_TABLE=ReviewsTable
CHATS_TABLE=ChatsTable
MESSAGES_TABLE=MessagesTable
SUBSCRIPTIONS_TABLE=SubscriptionsTable
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=examplepassword
CART_CACHE_TTL_SECONDS=3600
```
- Match these to your actual DynamoDB table names
- Redis values power the cart cache (ElastiCache in prod, local Docker in dev)
> Cart table schema: PK `userId` (String) and SK `itemId` (String). Using a different sort key (e.g., `storeId`) will produce DynamoDB key errors.

## Optional Variables

### CORS Configuration
```
CORS_ORIGINS=*
```
- Use `*` to allow all origins
- Or comma-separated list: `https://example.com,https://app.example.com`
- If not set, defaults to `http://localhost:5173,http://localhost:5174` (for local dev)

### Stripe (if using payments)
```
STRIPE_SECRET_KEY=sk_test_...
```
- Only needed if you're using the `/payments` routes

### Local Development Only (NOT needed in Lambda)
```
PORT=3000
DYNAMODB_ENDPOINT=http://localhost:8000
```
- These are only for local development
- Lambda doesn't need them

## ❌ NOT Needed

### JWT_SECRET
**You do NOT need `JWT_SECRET` if using Cognito!**
- Your code uses Cognito's public keys for JWT verification
- Cognito handles token signing/verification automatically
- Only needed if you were using custom JWT tokens (which you're not)

## Complete Example for Lambda

Here's a complete set of environment variables to add in AWS Lambda Console:

```
AWS_REGION=us-west-2
COGNITO_USER_POOL_ID=us-west-2_AbCdEfGhI
COGNITO_CLIENT_ID=1234567890abcdefghijklmn
USERS_TABLE=UsersTable
STOREFRONTS_TABLE=StorefrontsTable
ITEMS_TABLE=ListingsTable
CART_TABLE=CartTable
ORDERS_TABLE=OrdersTable
REVIEWS_TABLE=ReviewsTable
CHATS_TABLE=ChatsTable
MESSAGES_TABLE=MessagesTable
SUBSCRIPTIONS_TABLE=SubscriptionsTable
CORS_ORIGINS=*
STRIPE_SECRET_KEY=sk_test_your_stripe_key_here
CART_CACHE_TTL_SECONDS=3600
```

## How to Set in AWS Lambda

1. Go to your Lambda function
2. Click **Configuration** → **Environment variables**
3. Click **Edit**
4. Add each variable (one per line)
5. Click **Save**

## Security Notes

- **Never commit** `.env` files to git
- Use **AWS Systems Manager Parameter Store** or **Secrets Manager** for sensitive values like:
  - `COGNITO_CLIENT_SECRET`
  - `STRIPE_SECRET_KEY`
- In Lambda, you can reference secrets:
  ```
  STRIPE_SECRET_KEY={{resolve:ssm:/myapp/stripe-secret-key:1}}
  ```

