const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb')
const { v4: uuidv4 } = require('uuid')

const router = express.Router()
const ITEMS_TABLE = process.env.ITEMS_TABLE || 'ItemsTable'

// Add item to storefront
router.post('/', async (req, res) => {
  try {
    const { name, description, price, category, image, storeId } = req.body

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

module.exports = router

