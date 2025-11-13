require('dotenv').config()
const express = require('express')
const cors = require('./middleware/cors')

const app = express()
const PORT = process.env.PORT || 3000

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

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Local backend server is running' })
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

app.listen(PORT, () => {
  console.log(`🚀 Local backend server running on http://localhost:${PORT}`)
  console.log(`📋 Available routes:`)
  console.log(`   - POST   /auth/register`)
  console.log(`   - POST   /auth/login`)
  console.log(`   - GET    /auth/profile`)
  console.log(`   - POST   /storefronts`)
  console.log(`   - GET    /storefronts`)
  console.log(`   - GET    /storefronts/:storeId`)
  console.log(`   - GET    /storefronts/my`)
  console.log(`   - POST   /listings`)
  console.log(`   - GET    /listings?storeId=...`)
  console.log(`   - GET    /cart`)
  console.log(`   - POST   /cart`)
  console.log(`   - PUT    /cart/:storeId/:productId`)
  console.log(`   - DELETE /cart/:storeId/:productId`)
  console.log(`   - POST   /orders`)
  console.log(`   - GET    /orders`)
  console.log(`   - GET    /orders/:orderId`)
  console.log(`   - POST   /reviews`)
  console.log(`   - GET    /reviews/product/:productId`)
  console.log(`   - GET    /reviews/:reviewId`)
})

