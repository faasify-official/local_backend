const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb')
const { verifyToken } = require('../utils/jwt')
const { v4: uuidv4 } = require('uuid')

const router = express.Router()
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'OrdersTable'
const CART_TABLE = process.env.CART_TABLE || 'CartTable'

// Create order
router.post('/', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { items, shippingInfo, paymentIntentId, amount, currency, storeId } = req.body
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items are required' })
    }

    const orderId = uuidv4()
    const order = {
      id: orderId,
      userId: user.userId,
      items,
      total: amount,
      currency,
      stripePaymentIntentId: paymentIntentId,
      shippingInfo,
      storeId: storeId || 'default-store',
      status: 'PAID',
      createdAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: ORDERS_TABLE,
        Item: order,
      })
    )

    // Clear cart after order creation
    // Note: In a real app, you'd want to delete cart items individually

    res.status(201).json({
      message: 'Order created successfully',
      order,
    })
  } catch (error) {
    console.error('Error creating order:', error)
    res.status(500).json({ error: 'Failed to create order' })
  }
})

// Get user's orders
router.get('/', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const result = await docClient.send(
      new ScanCommand({
        TableName: ORDERS_TABLE,
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': user.userId,
        },
      })
    )

    res.status(200).json({
      orders: result.Items || [],
    })
  } catch (error) {
    console.error('Error getting orders:', error)
    res.status(500).json({ error: 'Failed to get orders' })
  }
})

// Get single order
router.get('/:orderId', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { orderId } = req.params

    const result = await docClient.send(
      new GetCommand({
        TableName: ORDERS_TABLE,
        Key: {
          id: orderId,
        },
      })
    )

    if (!result.Item) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (result.Item.userId !== user.userId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    res.status(200).json({
      order: result.Item,
    })
  } catch (error) {
    console.error('Error getting order:', error)
    res.status(500).json({ error: 'Failed to get order' })
  }
})

module.exports = router

