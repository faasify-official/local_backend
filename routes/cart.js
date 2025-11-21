const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { GetCommand, PutCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb')
const { verifyToken } = require('../utils/jwt')

const router = express.Router()
const CART_TABLE = process.env.CART_TABLE || 'CartTable'

// Get user's cart
router.get('/', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Get all cart items for user
    const result = await docClient.send(
      new ScanCommand({
        TableName: CART_TABLE,
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': user.userId,
        },
      })
    )

    res.status(200).json({
      items: result.Items || [],
    })
  } catch (error) {
    console.error('Error getting cart:', error)
    res.status(500).json({ error: 'Failed to get cart' })
  }
})

// Add item to cart
router.post('/', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { productId, quantity = 1, storeId } = req.body

    if (!productId || !storeId) {
      return res.status(400).json({ error: 'Missing required fields: productId, storeId' })
    }

    const cartItem = {
      userId: user.userId,
      storeId,
      productId,
      quantity,
      updatedAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: CART_TABLE,
        Item: cartItem,
      })
    )

    res.status(200).json({
      message: 'Item added to cart',
      item: cartItem,
    })
  } catch (error) {
    console.error('Error adding to cart:', error)
    res.status(500).json({ error: 'Failed to add to cart' })
  }
})

// Update cart item
router.put('/:storeId/:productId', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { storeId, productId } = req.params
    const { quantity } = req.body

    if (quantity < 1) {
      return res.status(400).json({ error: 'Quantity must be at least 1' })
    }

    const cartItem = {
      userId: user.userId,
      storeId,
      productId,
      quantity,
      updatedAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: CART_TABLE,
        Item: cartItem,
      })
    )

    res.status(200).json({
      message: 'Cart item updated',
      item: cartItem,
    })
  } catch (error) {
    console.error('Error updating cart:', error)
    res.status(500).json({ error: 'Failed to update cart' })
  }
})

// Remove item from cart
router.delete('/:storeId/:productId', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { storeId, productId } = req.params

    await docClient.send(
      new DeleteCommand({
        TableName: CART_TABLE,
        Key: {
          userId: user.userId,
          storeId,
        },
      })
    )

    res.status(200).json({
      message: 'Item removed from cart',
    })
  } catch (error) {
    console.error('Error removing from cart:', error)
    res.status(500).json({ error: 'Failed to remove from cart' })
  }
})

module.exports = router

