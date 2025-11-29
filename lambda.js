// Lambda handler using aws-serverless-express (more reliable than @vendia)
const serverlessExpress = require('@vendia/serverless-express')
const app = require('./app')

// Create server (cached for warm starts)
const handler = serverlessExpress({app})

// Lambda handler
exports.handler = handler
