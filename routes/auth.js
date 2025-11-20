const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb')
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  InitiateAuthCommand,
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

if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
  console.warn('WARNING: COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID not set in .env')
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
    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: email.toLowerCase(),
          UserAttributes: [
            { Name: 'email', Value: email.toLowerCase() },
            { Name: 'name', Value: name },
            { Name: 'email_verified', Value: 'true' },
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

      // Add user to group (buyer or seller)
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: email.toLowerCase(),
          GroupName: role, // Group name = buyer or seller
        })
      )
    } catch (cognitoError) {
      console.error('Cognito registration error:', cognitoError.message)
      if (cognitoError.name === 'UsernameExistsException') {
        return res.status(409).json({ error: 'User with this email already exists' })
      }
      return res.status(500).json({ error: `Cognito error: ${cognitoError.message}` })
    }

    // Create user record in DynamoDB (metadata: hasStorefront, createdAt, etc.)
    const userId = email.toLowerCase() // Use email as userId for consistency
    const user = {
      userId,
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
      // Authenticate with Cognito
      const authResponse = await cognito.send(
        new InitiateAuthCommand({
          ClientId: COGNITO_CLIENT_ID,
          AuthFlow: 'ADMIN_NO_SRP_AUTH',
          AuthParameters: {
            USERNAME: email.toLowerCase(),
            PASSWORD: password,
          },
        })
      )

      // Get user from DynamoDB for additional metadata
      const userResult = await docClient.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: {
            userId: email.toLowerCase(),
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
router.get('/profile', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' })
    }

    // Get user from database
    const result = await docClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: {
          userId: user.userId,
        },
      })
    )

    if (!result.Item) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = result.Item
    res.status(200).json({
      user: userWithoutPassword,
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

