// Lambda handler using aws-serverless-express (more reliable than @vendia)
const awsServerlessExpress = require('aws-serverless-express')
const app = require('./app')

// Create server (cached for warm starts)
const server = awsServerlessExpress.createServer(app, null, ['application/json'])

// Lambda handler
exports.handler = (event, context) => {
  return awsServerlessExpress.proxy(server, event, context)
}

