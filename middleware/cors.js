const cors = require('cors')

/**
 * CORS middleware configuration
 *
 * Reads allowed origins from the environment variable `CORS_ORIGINS`.
 * - If `CORS_ORIGINS` is exactly '*' (after trimming) the middleware will
 *   reflect the request Origin (effectively allowing any origin while
 *   still supporting credentials).
 * - Otherwise `CORS_ORIGINS` may be a comma-separated list of origins.
 * - If the env var is not set, a sensible default list is used for local dev.
 *
 * Examples:
 *   CORS_ORIGINS="*"                        // allow any origin (reflected)
 *   CORS_ORIGINS="http://a.com,http://b.io" // allow two specific origins
 */

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:5174']

const rawOrigins = process.env.CORS_ORIGINS

let originOption

if (!rawOrigins || rawOrigins.trim() === '') {
  // No env var set — use defaults
  originOption = DEFAULT_ORIGINS
} else if (rawOrigins.trim() === '*') {
  // Wildcard — reflect the incoming Origin header (allows credentials)
  originOption = true
} else {
  // Parse comma-separated list
  originOption = rawOrigins
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  // If parsing produced an empty list fall back to defaults
  if (originOption.length === 0) {
    originOption = DEFAULT_ORIGINS
  }
}

/**
 * Use a function for `origin` so we can:
 * - reflect origin when `originOption === true`
 * - allow requests with no origin (like server-to-server or curl)
 * - explicitly allow only origins that are in the configured list
 */
const corsOptions = {
  origin: (incomingOrigin, callback) => {
    // Allow requests with no Origin header (non-browser, e.g. curl, server-to-server)
    if (!incomingOrigin) {
      return callback(null, true)
    }

    if (originOption === true) {
      // Reflect the request origin (this sets Access-Control-Allow-Origin to the request origin)
      return callback(null, true)
    }

    if (Array.isArray(originOption)) {
      if (originOption.indexOf(incomingOrigin) !== -1) {
        return callback(null, true)
      }

      // Not allowed
      return callback(new Error('CORS policy: This origin is not allowed: ' + incomingOrigin))
    }

    // Fallback — allow
    return callback(null, true)
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}

module.exports = cors(corsOptions)
