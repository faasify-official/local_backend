const express = require('express')
const { verifyToken } = require('../utils/jwt')
const {
  getCartForUser,
  addItemToCart,
  updateItemQuantity,
  removeItemFromCart,
  clearCartForUser,
} = require('../services/cartService')

const router = express.Router()

// Middleware to ensure callers are authenticated and to attach the Cognito user id
const requireAuth = async (req, res, next) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    req.userId = user.userId
    next()
  } catch (error) {
    console.error('Auth error for cart route:', error)
    res.status(401).json({ error: 'Unauthorized' })
  }
}

// Normalize cart service errors into HTTP responses
const handleError = (res, error) => {
  console.error('Cart route error:', error)
  const status = error.statusCode || 500
  res.status(status).json({ error: error.message || 'Cart request failed' })
}

router.use(requireAuth)

// Get the authenticated user's cart with fresh product metadata
router.get('/items', async (req, res) => {
  try {
    const cart = await getCartForUser(req.userId)
    res.status(200).json(cart)
  } catch (error) {
    handleError(res, error)
  }
})

// Add or update an item in the cart while enforcing single-storefront carts
router.post('/items', async (req, res) => {
  try {
    const { itemId, quantity = 1 } = req.body || {}
    const cart = await addItemToCart(req.userId, itemId, quantity)
    res.status(200).json(cart)
  } catch (error) {
    handleError(res, error)
  }
})

// Update quantity for an item (quantity of 0 deletes the row)
router.patch('/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params
    const { quantity = 1 } = req.body || {}
    const cart = await updateItemQuantity(req.userId, itemId, quantity)
    res.status(200).json(cart)
  } catch (error) {
    handleError(res, error)
  }
})

// Remove a specific item from the cart
router.delete('/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params
    const cart = await removeItemFromCart(req.userId, itemId)
    res.status(200).json(cart)
  } catch (error) {
    handleError(res, error)
  }
})

// Clear the entire cart for the current user
router.delete('/items', async (req, res) => {
  try {
    const cart = await clearCartForUser(req.userId)
    res.status(200).json(cart)
  } catch (error) {
    handleError(res, error)
  }
})

module.exports = router

