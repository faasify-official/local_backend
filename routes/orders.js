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
      status: 'ORDER_CONFIRMED', // Buyer view: Order Confirmed
      orderStatus: 'PREPARE_ORDER', // Seller view: Prepare Order
      carrier: null,
      trackingId: null,
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

// Get orders for seller's storefront
router.get('/storefront/:storeId', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (user.role !== 'seller') {
      return res.status(403).json({ error: 'Forbidden: Only sellers can view storefront orders' })
    }

    const { storeId } = req.params

    const result = await docClient.send(
      new ScanCommand({
        TableName: ORDERS_TABLE,
        FilterExpression: 'storeId = :storeId',
        ExpressionAttributeValues: {
          ':storeId': storeId,
        },
      })
    )

    res.status(200).json({
      orders: result.Items || [],
    })
  } catch (error) {
    console.error('Error getting storefront orders:', error)
    res.status(500).json({ error: 'Failed to get storefront orders' })
  }
})

// Update order status (seller only)
router.put('/:orderId/status', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (user.role !== 'seller') {
      return res.status(403).json({ error: 'Forbidden: Only sellers can update order status' })
    }

    const { orderId } = req.params
    const { status, carrier, trackingId } = req.body

    // Valid statuses
    const validStatuses = ['PREPARE_ORDER', 'SHIPPED', 'DELIVERED', 'COMPLETED']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
    }

    // Get the order first
    const getResult = await docClient.send(
      new GetCommand({
        TableName: ORDERS_TABLE,
        Key: {
          id: orderId,
        },
      })
    )

    if (!getResult.Item) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Map seller status to buyer status
    const statusMap = {
      'PREPARE_ORDER': 'ORDER_CONFIRMED',
      'SHIPPED': 'SHIPPED',
      'DELIVERED': 'DELIVERED',
      'COMPLETED': 'COMPLETED'
    }

    const buyerStatus = statusMap[status] || 'ORDER_CONFIRMED'

    // Update order
    const updatedOrder = {
      ...getResult.Item,
      status: buyerStatus,
      orderStatus: status,
    }

    // Add carrier and trackingId if provided
    if (carrier !== undefined) {
      updatedOrder.carrier = carrier
    }
    if (trackingId !== undefined) {
      updatedOrder.trackingId = trackingId
    }

    await docClient.send(
      new PutCommand({
        TableName: ORDERS_TABLE,
        Item: updatedOrder,
      })
    )

    res.status(200).json({
      message: 'Order status updated successfully',
      order: updatedOrder,
    })
  } catch (error) {
    console.error('Error updating order status:', error)
    res.status(500).json({ error: 'Failed to update order status' })
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

    // Check if user is buyer or seller (seller can view if order is for their storefront)
    const isBuyer = result.Item.userId === user.userId
    const isSeller = user.role === 'seller' && result.Item.storeId

    if (!isBuyer && !isSeller) {
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

