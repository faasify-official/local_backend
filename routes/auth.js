const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb')
const bcrypt = require('bcryptjs')
const { generateToken, verifyToken } = require('../utils/jwt')
const { v4: uuidv4 } = require('uuid')

const router = express.Router()
const USERS_TABLE = process.env.USERS_TABLE || 'UsersTable'

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

    // Check if user already exists
    try {
      const queryResult = await docClient.send(
        new QueryCommand({
          TableName: USERS_TABLE,
          IndexName: 'EmailIndex',
          KeyConditionExpression: 'email = :email',
          ExpressionAttributeValues: {
            ':email': email.toLowerCase(),
          },
          Limit: 1,
        })
      )

      if (queryResult.Items && queryResult.Items.length > 0) {
        return res.status(409).json({ error: 'User with this email already exists' })
      }
    } catch (error) {
      console.error('Error checking existing user:', error.message)
    }

    // Hash password
    const bcryptRounds = process.env.NODE_ENV === 'production' ? 10 : 4
    const hashedPassword = await bcrypt.hash(password, bcryptRounds)

    // Create user
    const userId = uuidv4()
    const user = {
      userId,
      email: email.toLowerCase(),
      name,
      password: hashedPassword,
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

    // Generate JWT token
    const token = generateToken({
      userId,
      email: user.email,
      role,
    })

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = user
    res.status(201).json({
      message: 'User created successfully',
      user: userWithoutPassword,
      token,
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

    // Query user by email
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email.toLowerCase(),
        },
      })
    )

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = queryResult.Items[0]

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.userId,
      email: user.email,
      role: user.role,
    })

    // Return user data (without password)
    const { password: _, ...userWithoutPassword } = user
    res.status(200).json({
      message: 'Login successful',
      user: userWithoutPassword,
      token,
    })
  } catch (error) {
    console.error('Error during login:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

// Get Profile
router.get('/profile', async (req, res) => {
  try {
    const user = verifyToken(req)
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

