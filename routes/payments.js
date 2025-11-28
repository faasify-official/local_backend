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
    const key = await getSecret('STRIPE_SECRET_KEY')
    stripeClient = new Stripe(key, {
      apiVersion: '2024-06-20',
    })
  }
  return stripeClient
}

router.post('/create-payment-intent', async (req, res) => {
  const user = await verifyToken(req)
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const stripe = await getStripeClient();

  const { amount, currency, orderId } = req.body

  if (!amount || !currency) {
    return res.status(400).json({ error: 'amount and currency are required' })
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: user.userId,
        orderId: orderId || '',
      },
    })

    // console.log('Payment intent created:', paymentIntent)

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
    })

  } catch (error) {
    console.error('Error creating payment intent:', error)
    res.status(500).json({ error: 'Failed to create payment intent' })
  }
})

module.exports = router