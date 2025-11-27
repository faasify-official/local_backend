// Export the Express app for use in Lambda (via serverless-express)
// and for local development (via server.js)
const express = require('express')
const cors = require('./middleware/cors')

const app = express()

// Middleware
app.use(cors)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Routes
app.use('/auth', require('./routes/auth'))
app.use('/storefronts', require('./routes/storefronts'))
app.use('/listings', require('./routes/listings'))
app.use('/cart', require('./routes/cart'))
app.use('/orders', require('./routes/orders'))
app.use('/reviews', require('./routes/reviews'))
app.use('/subscriptions', require('./routes/subscriptions'))
app.use('/payments', require('./routes/payments'))
app.use('/chats', require('./routes/chats'))

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend server is running' })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err)
  res.status(500).json({ error: 'Internal server error', message: err.message })
})

module.exports = app

