const Redis = require('ioredis')

let redisClient

// Create or return a shared Redis client for caching cart payloads
const getRedisClient = () => {
  if (redisClient) return redisClient

  const host = process.env.REDIS_HOST
  const port = Number(process.env.REDIS_PORT || 6379)
  const password = process.env.REDIS_PASSWORD

  if (!host) {
    console.warn('REDIS_HOST not set; Redis caching disabled')
    return null
  }

  redisClient = new Redis({
    host,
    port,
    password,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  })

  redisClient.on('error', (err) => {
    console.error('Redis connection error:', err.message)
  })

  return redisClient
}

module.exports = { getRedisClient }
