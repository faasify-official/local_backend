# Testing Lambda Function Directly

You can test your Lambda function without API Gateway using test events.

## Quick Test Event (Health Check)

Copy this JSON into Lambda Console → Test:

```json
{
  "resource": "/{proxy+}",
  "path": "/health",
  "httpMethod": "GET",
  "headers": {
    "Accept": "application/json",
    "Host": "abc123.execute-api.us-west-2.amazonaws.com"
  },
  "queryStringParameters": null,
  "pathParameters": {
    "proxy": "health"
  },
  "requestContext": {
    "resourcePath": "/{proxy+}",
    "httpMethod": "GET",
    "requestId": "test-request-id",
    "stage": "prod",
    "requestTimeEpoch": 1428582896000,
    "identity": {
      "sourceIp": "127.0.0.1"
    },
    "domainName": "abc123.execute-api.us-west-2.amazonaws.com",
    "apiId": "abc123"
  },
  "body": null,
  "isBase64Encoded": false
}
```

## How to Test in Lambda Console

1. Go to **Lambda Console** → Your Function
2. Click **Test** tab
3. Click **Create new test event**
4. Choose **API Gateway AWS Proxy** template (or use custom)
5. Paste the JSON above
6. Name it: `health-check`
7. Click **Save**
8. Click **Test**

## Expected Response

You should get:
```json
{
  "statusCode": 200,
  "body": "{\"status\":\"ok\",\"message\":\"Backend server is running\"}",
  "headers": {
    "Content-Type": "application/json"
  }
}
```

## Other Test Events

See `test-events.json` for more examples:
- Health check (GET /health)
- Auth login (POST /auth/login)
- Get listings (GET /listings?storeId=...)
- With authentication header

## Troubleshooting

### If you get "Unable to determine event source":
- Make sure you're using the REST API event format (not HTTP API)
- The event structure above matches REST API format

### If you get module errors:
- Make sure `node_modules` is in your ZIP
- Run `npm install` before creating ZIP

### If routes don't work:
- Check the `path` field matches your route
- `/health` should work without any setup
- Other routes may need environment variables (DynamoDB tables, Cognito, etc.)

