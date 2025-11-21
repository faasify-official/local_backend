const express = require('express')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb')
const { verifyToken } = require('../utils/jwt')
const { v4: uuidv4 } = require('uuid')

const router = express.Router()
const REVIEWS_TABLE = process.env.REVIEWS_TABLE || 'ReviewsTable'

// Create review
router.post('/', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { productId, rating, comment, title, storeId } = req.body

    // if (!productId || !rating || !storeId) {
    //   return res.status(400).json({ error: 'Missing required fields: productId, rating, storeId' })
    // }

    if (!productId || typeof rating !== 'number') {
      return res
        .status(400)
        .json({ error: 'Missing required fields: productId, rating' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' })
    }

    const resolvedStoreId = storeId || 'default-store';

    const reviewId = uuidv4()
    const review = {
      reviewId,
      productId,
      storeId: resolvedStoreId,
      userId: user.userId,
      reviewer: user.email || user.name,
      rating,
      title: title || '',
      comment: comment || '',
      createdAt: new Date().toISOString(),
    }

    await docClient.send(
      new PutCommand({
        TableName: REVIEWS_TABLE,
        Item: review,
      })
    )

    res.status(201).json({
      message: 'Review created successfully',
      review,
    })
  } catch (error) {
    console.error('Error creating review:', error)
    res.status(500).json({ error: 'Failed to create review' })
  }
})

// Get reviews for a product
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params

    const result = await docClient.send(
      new ScanCommand({
        TableName: REVIEWS_TABLE,
        FilterExpression: 'productId = :productId',
        ExpressionAttributeValues: {
          ':productId': productId,
        },
      })
    )

    res.status(200).json({
      reviews: result.Items || [],
    })
  } catch (error) {
    console.error('Error getting reviews:', error)
    res.status(500).json({ error: 'Failed to get reviews' })
  }
})

// Get single review
router.get('/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params

    const result = await docClient.send(
      new GetCommand({
        TableName: REVIEWS_TABLE,
        Key: {
          reviewId,
        },
      })
    )

    if (!result.Item) {
      return res.status(404).json({ error: 'Review not found' })
    }

    res.status(200).json({
      review: result.Item,
    })
  } catch (error) {
    console.error('Error getting review:', error)
    res.status(500).json({ error: 'Failed to get review' })
  }
})

module.exports = router

