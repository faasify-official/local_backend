const { docClient } = require('../utils/dynamodb')
const { getRedisClient } = require('../utils/redis')
const {
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchWriteCommand,
  BatchGetCommand,
} = require('@aws-sdk/lib-dynamodb')

const CART_TABLE = process.env.CART_TABLE || 'CartTable'
const ITEMS_TABLE = process.env.ITEMS_TABLE || 'ItemsTable'
const CART_CACHE_TTL_SECONDS = parseInt(process.env.CART_CACHE_TTL_SECONDS || '3600', 10)
const redis = getRedisClient()
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=80'

const cacheKey = (userId) => `cart:${userId}`

const throwWithSchemaHint = (error) => {
  const message = error?.message || ''
  if (message.includes('The provided key element does not match the schema')) {
    throw createError(
      500,
      'Cart table schema mismatch: expected partition key userId and sort key itemId (both String). Please recreate the CartTable with that key schema.'
    )
  }
  throw error
}

const createError = (statusCode, message) => {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

// Read the lightweight cart snapshot from Redis; returns null if not cached
const readCartFromCache = async (userId) => {
  if (!redis) return null
  try {
    const cached = await redis.get(cacheKey(userId))
    return cached ? JSON.parse(cached) : null
  } catch (error) {
    console.warn('Redis read failed, falling back to DynamoDB:', error.message)
    return null
  }
}

// Persist the lightweight cart snapshot back to Redis with TTL for fast reads
const writeCartToCache = async (cart) => {
  if (!redis) return
  try {
    await redis.set(cacheKey(cart.userId), JSON.stringify(cart), 'EX', CART_CACHE_TTL_SECONDS)
  } catch (error) {
    console.warn('Redis write failed, continuing without cache:', error.message)
  }
}

// Remove the user's cached cart when their DynamoDB record changes
const clearCartCache = async (userId) => {
  if (!redis) return
  try {
    await redis.del(cacheKey(userId))
  } catch (error) {
    console.warn('Redis delete failed:', error.message)
  }
}

// Query DynamoDB for the authoritative cart rows for a user
const fetchCartFromDynamo = async (userId) => {
  const result = await docClient
    .send(
      new QueryCommand({
        TableName: CART_TABLE,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
      })
    )
    .catch(throwWithSchemaHint)

  const items = (result.Items || []).map((item) => ({
    itemId: item.itemId,
    quantity: item.quantity ?? 1,
    storeId: item.storeId || item.storefrontId,
    updatedAt: item.updatedAt,
  }))

  return {
    userId,
    storeId: items[0]?.storeId || null,
    items,
    updatedAt: new Date().toISOString(),
  }
}

// Fetch the latest product metadata so cart prices and names are always fresh
const loadProductDetails = async (itemIds) => {
  if (!itemIds.length) return new Map()

  const response = await docClient.send(
    new BatchGetCommand({
      RequestItems: {
        [ITEMS_TABLE]: {
          Keys: itemIds.map((itemId) => ({ id: itemId })),
        },
      },
    })
  ).catch(throwWithSchemaHint)

  const items = response.Responses?.[ITEMS_TABLE] || []
  const productMap = new Map()
  items.forEach((item) => productMap.set(item.id, item))

  return productMap
}

// Combine DynamoDB cart rows with fresh product details for the API response
const enrichCart = async (cart) => {
  const productMap = await loadProductDetails(cart.items.map((item) => item.itemId))

  const enrichedItems = cart.items.map((item) => {
    const product = productMap.get(item.itemId) || {}
    const storeId = item.storeId || product.storeId || product.storefrontId || null

    return {
      itemId: item.itemId,
      quantity: item.quantity ?? 1,
      storeId,
      name: product.name || 'Item',
      price: Number(product.price) || 0,
      image: product.image || DEFAULT_IMAGE,
      category: product.category || 'General',
      description: product.description || '',
      averageRating: product.averageRating ?? 0,
      availableQuantity: product.quantity,
    }
  })

  return {
    ...cart,
    storeId: cart.storeId || enrichedItems[0]?.storeId || null,
    items: enrichedItems,
  }
}

// Public: get the user's cart, preferring Redis but always refreshing product metadata
const getCartForUser = async (userId) => {
  const cachedCart = await readCartFromCache(userId)
  const baseCart = cachedCart || (await fetchCartFromDynamo(userId))

  if (!cachedCart) {
    await writeCartToCache(baseCart)
  }

  return enrichCart(baseCart)
}

// Public: add or replace an item's quantity, enforcing single-storefront carts
const addItemToCart = async (userId, itemId, quantity = 1) => {
  if (!itemId) {
    throw createError(400, 'itemId is required')
  }
  if (quantity < 1) {
    throw createError(400, 'Quantity must be at least 1')
  }

  const itemResult = await docClient.send(
    new GetCommand({
      TableName: ITEMS_TABLE,
      Key: { id: itemId },
    })
  )

  if (!itemResult.Item) {
    throw createError(404, 'Item not found')
  }

  const storeId = itemResult.Item.storeId || itemResult.Item.storefrontId
  if (!storeId) {
    throw createError(400, 'Item is missing storefront information')
  }

  const existingCart = await fetchCartFromDynamo(userId)
  if (existingCart.storeId && existingCart.storeId !== storeId && existingCart.items.length > 0) {
    throw createError(400, 'Cart already contains items from another store')
  }

  const updatedItem = {
    userId,
    itemId,
    storeId,
    quantity,
    updatedAt: new Date().toISOString(),
  }

  await docClient.send(
    new PutCommand({
      TableName: CART_TABLE,
      Item: updatedItem,
    })
  ).catch(throwWithSchemaHint)

  const freshCart = await fetchCartFromDynamo(userId)
  await writeCartToCache(freshCart)

  return enrichCart(freshCart)
}

// Public: set a new quantity for an existing item or remove if quantity is zero
const updateItemQuantity = async (userId, itemId, quantity = 1) => {
  if (quantity < 1) {
    return removeItemFromCart(userId, itemId)
  }
  return addItemToCart(userId, itemId, quantity)
}

// Public: remove one item from the user's cart
const removeItemFromCart = async (userId, itemId) => {
  if (!itemId) {
    throw createError(400, 'itemId is required')
  }

  await docClient.send(
    new DeleteCommand({
      TableName: CART_TABLE,
      Key: {
        userId,
        itemId,
      },
    })
  ).catch(throwWithSchemaHint)

  const freshCart = await fetchCartFromDynamo(userId)
  await writeCartToCache(freshCart)

  return enrichCart(freshCart)
}

// Public: clear the user's cart in DynamoDB and cache
const clearCartForUser = async (userId) => {
  const existingCart = await fetchCartFromDynamo(userId)
  const items = existingCart.items || []

  if (items.length > 0) {
    const chunks = []
    for (let i = 0; i < items.length; i += 25) {
      chunks.push(items.slice(i, i + 25))
    }

    for (const chunk of chunks) {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [CART_TABLE]: chunk.map((item) => ({
              DeleteRequest: {
                Key: { userId, itemId: item.itemId },
              },
            })),
          },
        })
      ).catch(throwWithSchemaHint)
    }
  }

  const emptyCart = {
    userId,
    storeId: null,
    items: [],
    updatedAt: new Date().toISOString(),
  }

  await clearCartCache(userId)
  await writeCartToCache(emptyCart)

  return enrichCart(emptyCart)
}

module.exports = {
  getCartForUser,
  addItemToCart,
  updateItemQuantity,
  removeItemFromCart,
  clearCartForUser,
}
