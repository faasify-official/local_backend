const express = require('express')
const crypto = require('crypto')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb')
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminGetUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider')
const { verifyToken } = require('../utils/jwt')

const router = express.Router()
const USERS_TABLE = process.env.USERS_TABLE || 'UsersTable'

// Cognito client
const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-west-2',
})

const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID
const COGNITO_CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET

if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
  console.warn('WARNING: COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID not set in .env')
}

// Compute SECRET_HASH for Cognito (required when client has a secret)
const computeSecretHash = (username, clientId, clientSecret) => {
  if (!clientSecret) {
    return undefined
  }
  return crypto
    .createHmac('SHA256', clientSecret)
    .update(username + clientId)
    .digest('base64')
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body

    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields: name, email, password, role' })
    }

    if (!['buyer', 'seller'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either "buyer" or "seller"' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }

    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      return res.status(500).json({ error: 'Cognito not configured' })
    }

    // Create user in Cognito
    let cognitoSub
    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: email.toLowerCase(),
          UserAttributes: [
            { Name: 'email', Value: email.toLowerCase() },
            { Name: 'name', Value: name },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'custom:role', Value: role }, // Store role as custom attribute
          ],
          TemporaryPassword: password,
          MessageAction: 'SUPPRESS', // Don't send welcome email
        })
      )

      // Set permanent password
      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: email.toLowerCase(),
          Password: password,
          Permanent: true,
        })
      )

      // Get the user to retrieve the Cognito sub
      const getUserResponse = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: email.toLowerCase(),
        })
      )

      // Extract sub from user attributes
      const subAttr = getUserResponse.UserAttributes.find((attr) => attr.Name === 'sub')
      cognitoSub = subAttr?.Value

      if (!cognitoSub) {
        throw new Error('Failed to retrieve Cognito sub')
      }
    } catch (cognitoError) {
      console.error('Cognito registration error:', cognitoError.message)
      if (cognitoError.name === 'UsernameExistsException') {
        return res.status(409).json({ error: 'User with this email already exists' })
      }
      return res.status(500).json({ error: `Cognito error: ${cognitoError.message}` })
    }

    // Create user record in DynamoDB using Cognito sub as userId (partition key)
    const user = {
      userId: cognitoSub, // Use Cognito sub as partition key
      email: email.toLowerCase(),
      name,
      role,
      hasStorefront: false,
      createdAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
      })
    )

    // Return user data (token should come from frontend after user logs in)
    res.status(201).json({
      message: 'User created successfully',
      user,
      note: 'Please log in to receive tokens',
    })
  } catch (error) {
    console.error('Error creating user:', error)
    res.status(500).json({ error: 'Failed to create user' })
  }
})

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      return res.status(500).json({ error: 'Cognito not configured' })
    }

    try {
      // Authenticate with Cognito using AdminInitiateAuth
      // This is an admin operation and doesn't depend on client auth flows
      const authParams = {
        USERNAME: email.toLowerCase(),
        PASSWORD: password,
      }

      // Add SECRET_HASH if client secret is configured
      const secretHash = computeSecretHash(email.toLowerCase(), COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET)
      if (secretHash) {
        authParams.SECRET_HASH = secretHash
      }

      const authResponse = await cognito.send(
        new AdminInitiateAuthCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          ClientId: COGNITO_CLIENT_ID,
          AuthFlow: 'ADMIN_NO_SRP_AUTH',
          AuthParameters: authParams,
        })
      )

      // Extract sub from the ID token to use as userId
      const idToken = authResponse.AuthenticationResult.IdToken
      const decoded = require('jsonwebtoken').decode(idToken)
      const cognitoSub = decoded.sub

      // Get user from DynamoDB using Cognito sub as userId
      const userResult = await docClient.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: {
            userId: cognitoSub,
          },
        })
      )

      const user = userResult.Item || { email: email.toLowerCase() }

      // Return tokens and user info
      res.status(200).json({
        message: 'Login successful',
        user: {
          userId: user.userId || email.toLowerCase(),
          email: user.email,
          name: user.name,
          role: user.role,
          hasStorefront: user.hasStorefront || false,
        },
        tokens: {
          idToken: authResponse.AuthenticationResult.IdToken,
          accessToken: authResponse.AuthenticationResult.AccessToken,
          refreshToken: authResponse.AuthenticationResult.RefreshToken,
        },
      })
    } catch (cognitoError) {
      console.error('Cognito login error:', cognitoError.message)
      if (
        cognitoError.name === 'NotAuthorizedException' ||
        cognitoError.name === 'UserNotFoundException'
      ) {
        return res.status(401).json({ error: 'Invalid email or password' })
      }
      return res.status(500).json({ error: `Login failed: ${cognitoError.message}` })
    }
  } catch (error) {
    console.error('Error during login:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Get Profile
// NOTE: There's redundant code between Cognito & Dynamo. For simplicity, we fetch all profile attributes from Dynamo since user's info is stored there anyways!!!
router.get('/profile', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' })
    }

    // Get user from database using Cognito sub as userId (partition key)
    let result
    try {
      result = await docClient.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: {
            userId: user.userId, // user.userId is now the Cognito sub
          },
        })
      )
    } catch (error) {
      console.error('Error fetching user:', error)
      result = { Item: null }
    }

    if (!result.Item) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Return full user profile with all attributes
    const profileData = {
      userId: result.Item.userId, // Cognito sub
      email: result.Item.email,
      name: result.Item.name,
      role: result.Item.role,
      hasStorefront: result.Item.hasStorefront || false,
      createdAt: result.Item.createdAt || new Date().toISOString(),
    }

    res.status(200).json({
      user: profileData,
    })
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    console.error('Error getting profile:', error)
    res.status(500).json({ error: 'Failed to get profile' })
  }
})

module.exports = router

