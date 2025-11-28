// Use this code snippet in your app.
// If you need more information about configurations or implementing the sample code, visit the AWS docs:
// https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started.html

const {
    SecretsManagerClient,
    GetSecretValueCommand,
  } = require("@aws-sdk/client-secrets-manager");
  
const REGION = process.env.AWS_REGION || 'us-west-2'
// Name of the secret you created in the console
const SECRET_NAME = process.env.APP_SECRET_NAME || 'faasify/local-backend'

const client = new SecretsManagerClient({ region: REGION })

let cache = null

async function loadSecrets () {
  // simple in-memory cache so we don't call Secrets Manager every time
  if (cache) return cache

  // Local fallback: use .env directly if you want
  if (process.env.USE_LOCAL_ENV === 'true') {
    cache = {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      JWT_SECRET: process.env.JWT_SECRET,
      COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET,
    }
    return cache
  }

  const data = await client.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME })
  )

  const secretString = data.SecretString
  cache = JSON.parse(secretString)
  return cache
}

async function getSecret (key) {
  const secrets = await loadSecrets()
  return secrets[key]
}

module.exports = { getSecret }
