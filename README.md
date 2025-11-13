# Local Backend Development Server

A local Express.js server that replicates all API routes from the AWS Lambda backend and connects to AWS DynamoDB.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Configure your AWS credentials in `.env`:
```env
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

USERS_TABLE=UsersTable
STOREFRONTS_TABLE=StorefrontsTable
ITEMS_TABLE=ItemsTable
CART_TABLE=CartTable
ORDERS_TABLE=OrdersTable
REVIEWS_TABLE=ReviewsTable

JWT_SECRET=your-super-secret-jwt-key-change-in-production
PORT=3000
```

## Running

```bash
npm run dev
```

The server will start on `http://localhost:3000`

## API Routes

All routes match the Lambda backend:

- **Auth**: `/auth/register`, `/auth/login`, `/auth/profile`
- **Storefronts**: `/storefronts`, `/storefronts/:storeId`, `/storefronts/my`
- **Listings**: `/listings` (GET with `?storeId=...`, POST to add items)
- **Cart**: `/cart` (GET, POST, PUT, DELETE)
- **Orders**: `/orders` (GET, POST, GET `/:orderId`)
- **Reviews**: `/reviews` (POST, GET `/product/:productId`, GET `/:reviewId`)

## Notes

- This server connects directly to AWS DynamoDB (not local DynamoDB)
- Make sure your AWS credentials are configured
- The server includes CORS middleware for frontend development
- All routes match the Lambda function behavior

