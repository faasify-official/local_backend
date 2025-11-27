// Lambda handler using serverless-express
const serverlessExpress = require('@vendia/serverless-express')
const app = require('./app')

// Create the serverless-express handler
// @vendia/serverless-express automatically detects API Gateway events
// But we can explicitly configure it if needed
const handler = serverlessExpress({ app })

exports.handler = handler

