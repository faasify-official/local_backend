const cors = require('cors')

const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'], 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}

module.exports = cors(corsOptions)

