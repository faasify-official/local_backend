const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, DeleteCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb')
const { verifyToken } = require('../utils/jwt')

const router = express.Router()
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE || 'SubscriptionsTable'

// Subscribe to a storefront
router.post('/subscribe', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' })
    }

    // Only buyers can subscribe
    if (user.role !== 'buyer') {
      return res.status(403).json({ error: 'Forbidden: Only buyers can subscribe to storefronts' })
    }

    const { storeId } = req.body

    // Validation
    if (!storeId) {
      return res.status(400).json({
        error: 'Missing required field: storeId',
      })
    }

    // Get user email from token (assuming email is in the token payload)
    // If not, you may need to query the UsersTable to get the email
    const buyerEmail = user.email || user.userId

    // Check if already subscribed
    try {
      const existing = await docClient.send(
        new GetCommand({
          TableName: SUBSCRIPTIONS_TABLE,
          Key: {
            storeId,
            buyerEmail,
          },
        })
      )

      if (existing.Item) {
        return res.status(409).json({
          error: 'Already subscribed to this storefront',
        })
      }
    } catch (error) {
      console.error('Error checking existing subscription:', error)
    }

    // Create subscription
    const subscription = {
      storeId,
      buyerEmail,
      subscribedAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: SUBSCRIPTIONS_TABLE,
        Item: subscription,
      })
    )

    res.status(201).json({
      message: 'Successfully subscribed to storefront',
      subscription,
    })
  } catch (error) {
    console.error('Error subscribing to storefront:', error)
    res.status(500).json({ error: 'Failed to subscribe to storefront' })
  }
})

// Unsubscribe from a storefront
router.post('/unsubscribe', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' })
    }

    // Only buyers can unsubscribe
    if (user.role !== 'buyer') {
      return res.status(403).json({ error: 'Forbidden: Only buyers can unsubscribe from storefronts' })
    }

    const { storeId } = req.body

    // Validation
    if (!storeId) {
      return res.status(400).json({
        error: 'Missing required field: storeId',
      })
    }

    const buyerEmail = user.email || user.userId

    // Delete subscription
    await docClient.send(
      new DeleteCommand({
        TableName: SUBSCRIPTIONS_TABLE,
        Key: {
          storeId,
          buyerEmail,
        },
      })
    )

    res.status(200).json({
      message: 'Successfully unsubscribed from storefront',
    })
  } catch (error) {
    console.error('Error unsubscribing from storefront:', error)
    res.status(500).json({ error: 'Failed to unsubscribe from storefront' })
  }
})

// Get all subscriptions for a storefront (for sellers/admins)
router.get('/:storeId', async (req, res) => {
  try {
    const user = verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' })
    }

    const { storeId } = req.params

    if (!storeId) {
      return res.status(400).json({ error: 'Missing storeId in path' })
    }

    // Query all subscriptions for this storefront
    const result = await docClient.send(
      new QueryCommand({
        TableName: SUBSCRIPTIONS_TABLE,
        KeyConditionExpression: 'storeId = :storeId',
        ExpressionAttributeValues: {
          ':storeId': storeId,
        },
      })
    )

    res.status(200).json({
      storeId,
      subscriptions: result.Items || [],
      count: result.Items ? result.Items.length : 0,
    })
  } catch (error) {
    console.error('Error getting subscriptions:', error)
    res.status(500).json({ error: 'Failed to get subscriptions' })
  }
})

module.exports = router

