const express = require('express')
const Stripe = require('stripe')
const { verifyToken } = require('../utils/jwt')
const { getSecret } = require('../utils/secrets')
const router = express.Router()


// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
//   apiVersion: '2024-06-20',
// })

let stripeClient = null
async function getStripeClient() {
  if (!stripeClient) {
    let key
    try {
      // Try to get from Secrets Manager
      key = await getSecret('faasify-secrets', 'STRIPE_SECRET_KEY')
    } catch (secretsError) {
      // Fallback to environment variable
      console.warn('Failed to get Stripe key from Secrets Manager, trying environment variable:', secretsError.message)
      key = process.env.STRIPE_SECRET_KEY
      if (!key) {
        throw new Error('STRIPE_SECRET_KEY not found in secrets or environment variables')
      }
    }

    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is required')
    }

    stripeClient = new Stripe(key, {
      apiVersion: '2024-06-20',
    })
  }
  return stripeClient
}

router.post('/create-payment-intent', async (req, res) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Get Stripe client with error handling
    let stripe
    try {
      stripe = await getStripeClient()
    } catch (stripeError) {
      console.error('Error initializing Stripe client:', stripeError)
      return res.status(500).json({ 
        error: 'Payment service configuration error',
        message: 'Stripe secret key not configured. Please set STRIPE_SECRET_KEY in environment variables or Secrets Manager.'
      })
    }

    const { amount, currency, orderId } = req.body

    if (!amount || !currency) {
      return res.status(400).json({ error: 'amount and currency are required' })
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: user.userId,
        orderId: orderId || '',
      },
    })

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
    })

  } catch (error) {
    console.error('Error creating payment intent:', error)
    // Make sure we always return a response (for CORS)
    return res.status(500).json({ 
      error: 'Failed to create payment intent',
      message: error.message 
    })
  }
})

module.exports = router