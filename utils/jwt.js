const jwt = require('jsonwebtoken')
const https = require('https')

// Cache for Cognito public keys
let cognitoPublicKeys = {}
let keysExpiry = 0

/**
 * Fetch Cognito public keys for token verification
 */
async function getCognitoPublicKeys() {
  const now = Date.now()
  if (cognitoPublicKeys && keysExpiry > now) {
    return cognitoPublicKeys // Return cached keys
  }

  return new Promise((resolve, reject) => {
    const region = process.env.AWS_REGION || 'us-west-2'
    const userPoolId = process.env.COGNITO_USER_POOL_ID

    if (!userPoolId) {
      reject(new Error('COGNITO_USER_POOL_ID not set'))
      return
    }

    const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`

    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          const keys = JSON.parse(data).keys
          cognitoPublicKeys = {}
          keys.forEach((key) => {
            cognitoPublicKeys[key.kid] = key
          })
          keysExpiry = now + 3600000 // Cache for 1 hour
          resolve(cognitoPublicKeys)
        } catch (err) {
          reject(err)
        }
      })
    }).on('error', reject)
  })
}

/**
 * Verify Cognito JWT token and extract user info
 * Token should be in Authorization header as "Bearer <token>"
 */
const verifyToken = async (req) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  try {
    const token = authHeader.substring(7)

    // Decode without verification first to get the kid (key ID)
    const decoded = jwt.decode(token, { complete: true })
    if (!decoded) {
      return null
    }

    const kid = decoded.header.kid
    const publicKeys = await getCognitoPublicKeys()
    const publicKey = publicKeys[kid]

    if (!publicKey) {
      console.warn('Public key not found for kid:', kid)
      return null
    }

    // Convert JWK to PEM format
    const pem = jwkToPem(publicKey)

    // Verify token signature
    const verified = jwt.verify(token, pem, { algorithms: ['RS256'] })

    // Ensure token hasn't expired
    if (verified.exp && verified.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Extract user info from token
    return {
      userId: verified.sub || verified['cognito:username'],
      email: verified.email,
      name: verified.name,
      role: verified['cognito:groups'] ? verified['cognito:groups'][0] : 'buyer', // First group is role
    }
  } catch (error) {
    console.error('Token verification error:', error.message)
    return null
  }
}

/**
 * Convert JWK to PEM format (for RSA keys)
 */
function jwkToPem(jwk) {
  // This is a simplified conversion. For production, use a library like 'jwk-to-pem'
  // For now, we'll use the RSA key directly via jsonwebtoken's built-in support
  const crypto = require('crypto')

  if (jwk.kty !== 'RSA') {
    throw new Error('Only RSA keys are supported')
  }

  const modulusBuffer = Buffer.from(jwk.n, 'base64')
  const exponentBuffer = Buffer.from(jwk.e, 'base64')

  const modulusHex = modulusBuffer.toString('hex')
  const exponentHex = exponentBuffer.toString('hex')

  const modulus = Buffer.from(modulusHex, 'hex')
  const exponent = Buffer.from(exponentHex, 'hex')

  const publicKey = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: modulus,
      e: exponent,
    },
    format: 'jwk',
  })

  return crypto.createPublicKey(publicKey).export({ format: 'pem', type: 'spki' })
}

module.exports = { verifyToken }

