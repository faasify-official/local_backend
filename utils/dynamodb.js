const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb')

// Configure DynamoDB client
const dynamoConfig = {
  region: process.env.AWS_REGION || 'us-west-2',
}

// For local DynamoDB (if DYNAMODB_ENDPOINT is set)
if (process.env.DYNAMODB_ENDPOINT) {
  dynamoConfig.endpoint = process.env.DYNAMODB_ENDPOINT
}

const client = new DynamoDBClient(dynamoConfig)
const docClient = DynamoDBDocumentClient.from(client)

module.exports = { client, docClient }

