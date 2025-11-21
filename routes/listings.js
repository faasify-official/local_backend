const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, QueryCommand, ScanCommand, GetCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb')
const { v4: uuidv4 } = require('uuid')
const { verifyToken } = require('../utils/jwt')

const router = express.Router()
const ITEMS_TABLE = process.env.ITEMS_TABLE || 'ItemsTable'

// Add item to storefront
router.post('/', async (req, res) => {
  try {
    const user = verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { name, description, price, category, image, storeId, quantity } = req.body

    // Validation
    if (!name || !description || price === undefined || !category || !storeId) {
      return res.status(400).json({
        error: 'Missing required fields: name, description, price, category, storeId',
      })
    }

    // Validate price is a number
    const priceNum = parseFloat(price)
    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({
        error: 'Price must be a valid positive number',
      })
    }

    // Validate quantity if provided
    const quantityNum = quantity !== undefined ? parseInt(quantity, 10) : 0
    if (quantity !== undefined && (isNaN(quantityNum) || quantityNum < 0)) {
      return res.status(400).json({
        error: 'Quantity must be a valid non-negative integer',
      })
    }

    // Create item
    const itemId = uuidv4()
    const item = {
      id: itemId,
      storeId,
      name,
      description,
      price: priceNum,
      category,
      image: image || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=80',
      quantity: quantityNum,
      averageRating: 0,
      reviews: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: ITEMS_TABLE,
        Item: item,
      })
    )

    res.status(201).json({
      message: 'Item added successfully',
      item,
    })
  } catch (error) {
    console.error('Error adding item:', error)
    res.status(500).json({ error: 'Failed to add item' })
  }
})

// Get all items for a storefront
router.get('/', async (req, res) => {
  try {
    const { storeId } = req.query

    console.log('Getting items for storeId:', storeId)

    if (!storeId) {
      return res.status(400).json({ error: 'Missing required query parameter: storeId' })
    }

    // Try to query using StoreIdIndex GSI first
    let result
    try {
      console.log('Attempting to query using StoreIdIndex GSI...')
      result = await docClient.send(
        new QueryCommand({
          TableName: ITEMS_TABLE,
          IndexName: 'StoreIdIndex',
          KeyConditionExpression: 'storeId = :storeId',
          ExpressionAttributeValues: {
            ':storeId': storeId,
          },
        })
      )
      console.log('GSI query successful, found', result.Items?.length || 0, 'items')
    } catch (gsiError) {
      // If GSI doesn't exist, fall back to scanning and filtering
      console.warn('StoreIdIndex GSI not found, falling back to scan:', gsiError.message)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: ITEMS_TABLE,
          FilterExpression: 'storeId = :storeId',
          ExpressionAttributeValues: {
            ':storeId': storeId,
          },
        })
      )
      result = scanResult
      console.log('Scan successful, found', result.Items?.length || 0, 'items')
    }

    const items = result.Items || []
    console.log('Returning', items.length, 'items for storeId:', storeId)
    res.status(200).json({
      items,
    })
  } catch (error) {
    console.error('Error getting items:', error)
    res.status(500).json({ error: `Failed to get items: ${error.message}` })
  }
})

// Get single item by ID (must come after / route)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    console.log('Getting item by ID:', id)

    if (!id) {
      return res.status(400).json({ error: 'Missing item ID' })
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: ITEMS_TABLE,
        Key: {
          id,
        },
      })
    )

    if (!result.Item) {
      console.log('Item not found in database:', id)
      return res.status(404).json({ error: 'Item not found' })
    }

    console.log('Item found:', result.Item.id)
    res.status(200).json({
      item: result.Item,
    })
  } catch (error) {
    console.error('Error getting item:', error)
    res.status(500).json({ error: `Failed to get item: ${error.message}` })
  }
})

// Update item (must come after /:id route)
router.put('/:id', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { id } = req.params
    const { name, description, price, category, image, quantity } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Missing item ID' })
    }

    // Get the existing item to verify ownership
    const getResult = await docClient.send(
      new GetCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
      })
    )

    if (!getResult.Item) {
      return res.status(404).json({ error: 'Item not found' })
    }

    // Verify the user owns the storefront that this item belongs to
    const storefrontResult = await docClient.send(
      new GetCommand({
        TableName: process.env.STOREFRONTS_TABLE || 'StorefrontsTable',
        Key: { storeId: getResult.Item.storeId },
      })
    )

    if (!storefrontResult.Item || storefrontResult.Item.owner !== user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this item' })
    }

    // Build update expression
    const updateExpressions = []
    const expressionAttributeNames = {}
    const expressionAttributeValues = {}

    if (name !== undefined) {
      updateExpressions.push('#name = :name')
      expressionAttributeNames['#name'] = 'name'
      expressionAttributeValues[':name'] = name
    }
    if (description !== undefined) {
      updateExpressions.push('#description = :description')
      expressionAttributeNames['#description'] = 'description'
      expressionAttributeValues[':description'] = description
    }
    if (price !== undefined) {
      const priceNum = parseFloat(price)
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({ error: 'Price must be a valid positive number' })
      }
      updateExpressions.push('price = :price')
      expressionAttributeValues[':price'] = priceNum
    }
    if (category !== undefined) {
      updateExpressions.push('category = :category')
      expressionAttributeValues[':category'] = category
    }
    if (image !== undefined) {
      updateExpressions.push('#image = :image')
      expressionAttributeNames['#image'] = 'image'
      expressionAttributeValues[':image'] = image
    }
    if (quantity !== undefined) {
      const quantityNum = parseInt(quantity, 10)
      if (isNaN(quantityNum) || quantityNum < 0) {
        return res.status(400).json({ error: 'Quantity must be a valid non-negative integer' })
      }
      updateExpressions.push('quantity = :quantity')
      expressionAttributeValues[':quantity'] = quantityNum
    }

    if (updateExpressions.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    updateExpressions.push('updatedAt = :updatedAt')
    expressionAttributeValues[':updatedAt'] = new Date().toISOString()

    const result = await docClient.send(
      new UpdateCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    )

    res.status(200).json({
      message: 'Item updated successfully',
      item: result.Attributes,
    })
  } catch (error) {
    console.error('Error updating item:', error)
    res.status(500).json({ error: `Failed to update item: ${error.message}` })
  }
})

// Delete item
router.delete('/:id', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { id } = req.params

    if (!id) {
      return res.status(400).json({ error: 'Missing item ID' })
    }

    // Get the existing item to verify ownership
    const getResult = await docClient.send(
      new GetCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
      })
    )

    if (!getResult.Item) {
      return res.status(404).json({ error: 'Item not found' })
    }

    // Verify the user owns the storefront that this item belongs to
    const storefrontResult = await docClient.send(
      new GetCommand({
        TableName: process.env.STOREFRONTS_TABLE || 'StorefrontsTable',
        Key: { storeId: getResult.Item.storeId },
      })
    )

    if (!storefrontResult.Item || storefrontResult.Item.owner !== user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this item' })
    }

    await docClient.send(
      new DeleteCommand({
        TableName: ITEMS_TABLE,
        Key: { id },
      })
    )

    res.status(200).json({
      message: 'Item deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting item:', error)
    res.status(500).json({ error: `Failed to delete item: ${error.message}` })
  }
})

module.exports = router

