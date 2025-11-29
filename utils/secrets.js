const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const REGION = process.env.AWS_REGION || 'us-west-2';

// Create client with caching
let client = null;
function getClient() {
  if (!client) {
    client = new SecretsManagerClient({ region: REGION });
  }
  return client;
}

// Cache for secrets (optional - can be removed if you want fresh secrets each time)
let cache = null;

async function getSecret(secretName, key) {
  try {
    // Check cache first (if USE_LOCAL_ENV is true, use env vars)
    if (process.env.USE_LOCAL_ENV === 'true') {
      // Fallback to environment variables
      const envKey = process.env[key] || process.env[secretName + '_' + key];
      if (envKey) {
        return envKey;
      }
    }

    // Use cache if available
    if (cache && cache[secretName] && cache[secretName][key]) {
      return cache[secretName][key];
    }

    const command = new GetSecretValueCommand({
      SecretId: secretName
    });

    const response = await getClient().send(command);
    const secretObject = JSON.parse(response.SecretString);

    // Cache the result
    if (!cache) cache = {};
    if (!cache[secretName]) cache[secretName] = {};
    cache[secretName][key] = secretObject[key];

    return secretObject[key];
  } catch (error) {
    console.error("SecretsManager error:", error);
    
    // Fallback to environment variable if Secrets Manager fails
    if (process.env[key] || process.env[secretName + '_' + key]) {
      console.warn(`Using environment variable fallback for ${key}`);
      return process.env[key] || process.env[secretName + '_' + key];
    }
    
    throw error;
  }
}

module.exports = { getSecret };