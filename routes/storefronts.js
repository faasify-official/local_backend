const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb')
const { verifyToken } = require('../utils/jwt')
const { v4: uuidv4 } = require('uuid')

const router = express.Router()
const STOREFRONTS_TABLE = process.env.STOREFRONTS_TABLE || 'StorefrontsTable'
const USERS_TABLE = process.env.USERS_TABLE || 'UsersTable'
const ITEMS_TABLE = process.env.ITEMS_TABLE || 'ItemsTable'

// Create storefront
router.post('/', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' })
    }

    // Check role (Commented out: If not in token, fetch from DynamoDB using user.userId (Cognito sub))
    let userRole = user.role
    // if (!userRole) {
    //   const userResult = await docClient.send(
    //     new GetCommand({
    //       TableName: USERS_TABLE,
    //       Key: { userId: user.userId }, // Now using Cognito sub
    //     })
    //   )
    //   userRole = userResult.Item?.role
    // }

    if (userRole !== 'seller') {
      return res.status(403).json({ error: 'Forbidden: Only sellers can create storefronts' })
    }

    const { name, description, category, image } = req.body

    // Validation
    if (!name || !description || !category) {
      return res.status(400).json({
        error: 'Missing required fields: name, description, category',
      })
    }

    // Create storefront
    const storeId = uuidv4()
    const storefront = {
      storeId,
      name,
      description,
      category,
      image: image || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1400&q=80',
      owner: user.userId, // Store Cognito sub as owner
      ownerName: user.name,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: STOREFRONTS_TABLE,
        Item: storefront,
      })
    )

    // Update user to mark that they have a storefront using Cognito sub
    await docClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: {
          userId: user.userId, // Cognito sub
        },
        UpdateExpression: 'SET hasStorefront = :hasStorefront',
        ExpressionAttributeValues: {
          ':hasStorefront': true,
        },
      })
    )

    res.status(201).json({
      message: 'Storefront created successfully',
      storefront,
    })
  } catch (error) {
    console.error('Error creating storefront:', error)
    res.status(500).json({ error: 'Failed to create storefront' })
  }
})

// List all storefronts (must come before /:storeId)
router.get('/', async (req, res) => {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: STOREFRONTS_TABLE,
      })
    )

    const storefronts = result.Items || []

    // Enrich storefronts with items counts
    const enrichedStorefronts = await Promise.all(
      storefronts.map(async (storefront) => {
        // Get items count from ItemsTable
        let itemsCount = 0
        try {
          // Try to query using StoreIdIndex GSI first
          let itemsResult
          try {
            itemsResult = await docClient.send(
              new QueryCommand({
                TableName: ITEMS_TABLE,
                IndexName: 'StoreIdIndex',
                KeyConditionExpression: 'storeId = :storeId',
                ExpressionAttributeValues: {
                  ':storeId': storefront.storeId,
                },
              })
            )
          } catch (gsiError) {
            // If GSI doesn't exist, fall back to scanning and filtering
            itemsResult = await docClient.send(
              new ScanCommand({
                TableName: ITEMS_TABLE,
                FilterExpression: 'storeId = :storeId',
                ExpressionAttributeValues: {
                  ':storeId': storefront.storeId,
                },
              })
            )
          }
          itemsCount = itemsResult.Items ? itemsResult.Items.length : 0
        } catch (itemsError) {
          console.warn(`Failed to fetch items for storefront ${storefront.storeId}:`, itemsError.message)
        }

        return {
          ...storefront,
          itemsCount,
        }
      })
    )

    res.status(200).json({
      storefronts: enrichedStorefronts,
    })
  } catch (error) {
    console.error('Error listing storefronts:', error)
    res.status(500).json({ error: 'Failed to list storefronts' })
  }
})

// Get my storefronts (seller's own storefronts) - MUST come before /:storeId
router.get('/my', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' })
    }

    if (user.role !== 'seller') {
      return res.status(403).json({ error: 'Forbidden: Only sellers can view their storefronts' })
    }

    // Try to query using OwnerIndex GSI first
    let result
    try {
      result = await docClient.send(
        new QueryCommand({
          TableName: STOREFRONTS_TABLE,
          IndexName: 'OwnerIndex',
          KeyConditionExpression: '#owner = :owner',
          ExpressionAttributeNames: {
            '#owner': 'owner',
          },
          ExpressionAttributeValues: {
            ':owner': user.userId,
          },
        })
      )
    } catch (gsiError) {
      // If GSI doesn't exist, fall back to scanning and filtering
      console.warn('OwnerIndex GSI not found, falling back to scan:', gsiError.message)
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: STOREFRONTS_TABLE,
          FilterExpression: '#owner = :owner',
          ExpressionAttributeNames: {
            '#owner': 'owner',
          },
          ExpressionAttributeValues: {
            ':owner': user.userId,
          },
        })
      )
      result = scanResult
    }

    res.status(200).json({
      storefronts: result.Items || [],
    })
  } catch (error) {
    console.error('Error getting my storefronts:', error)
    res.status(500).json({ error: `Failed to get storefronts: ${error.message}` })
  }
})

// Get single storefront (must come after /my)
router.get('/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params

    if (!storeId) {
      return res.status(400).json({ error: 'Missing storeId in path' })
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: STOREFRONTS_TABLE,
        Key: {
          storeId,
        },
      })
    )

    if (!result.Item) {
      return res.status(404).json({ error: 'Storefront not found' })
    }

    res.status(200).json({
      storefront: result.Item,
    })
  } catch (error) {
    console.error('Error getting storefront:', error)
    res.status(500).json({ error: 'Failed to get storefront' })
  }
})

module.exports = router

