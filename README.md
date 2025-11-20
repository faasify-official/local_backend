# Local Backend Development Server

A local Express.js server that replicates all API routes from the AWS Lambda backend and connects to AWS DynamoDB.

## Setup

### 1. Install dependencies:
```bash
npm install
```

### 2. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

### 3. Configure AWS Cognito (Required for Auth)

#### Create a Cognito User Pool:
1. Go to **AWS Cognito Console** → **User Pools** → **Create user pool**
2. Choose **Cognito managed sign in** (or your preference)
3. Name it (e.g., `faasify-users`)
4. Under **Multi-factor authentication**, select your preference (e.g., MFA optional)
5. Under **User account recovery**, configure recovery options
6. Click **Create** 

#### Create Cognito App Client:
1. In your User Pool, go to **App Integration** → **App Clients** → **Create app client**
2. Name it (e.g., `faasify-web-client`)
3. Under **Authentication flows**, enable **ALLOW_ADMIN_USER_PASSWORD_AUTH** (for server-side login)
4. Copy the **Client ID** and save it for `.env`

#### Create Cognito User Groups:
1. In your User Pool, go to **User groups** → **Create group**
2. Create group **`buyers`** (no IAM role needed)
3. Create group **`sellers`** (no IAM role needed)

#### Update `.env` with Cognito details:
```env
COGNITO_USER_POOL_ID=us-west-2_XXXXXXXXX
COGNITO_CLIENT_ID=your-app-client-id
COGNITO_REGION=us-west-2
```

### 4. Configure your AWS credentials in `.env`:
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
SUBSCRIPTIONS_TABLE=SubscriptionsTable

STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
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

## Authentication (AWS Cognito)

This backend now uses **AWS Cognito** for user authentication instead of local password storage:

- **User Registration**: Users are created in Cognito user pool and assigned to either `buyers` or `sellers` group
- **User Login**: Cognito handles password validation and returns ID + Access tokens (JWTs)
- **Token Verification**: All protected routes verify Cognito JWT tokens using Cognito's public keys
- **Role-Based Access**: User role is extracted from `cognito:groups` claim in the token

### User Groups:
- **`buyers`**: Can browse storefronts, add items to cart, create orders, leave reviews
- **`sellers`**: Can create storefronts and list items for sale

### Frontend Integration:
1. Call `POST /auth/register` to create a new user
2. Call `POST /auth/login` to authenticate and receive tokens
3. Store the `idToken` or `accessToken` in localStorage/sessionStorage
4. Send token in Authorization header: `Authorization: Bearer <token>`

### Token Structure:
Cognito tokens are JWTs containing:
- `sub`: User's unique identifier (UUID)
- `email`: User's email
- `name`: User's name
- `cognito:groups`: Array of groups (["buyers"] or ["sellers"])

## Notes

- This server connects directly to **AWS DynamoDB** (not local DynamoDB)
- Cognito handles password hashing and storage securely
- Make sure your AWS credentials and Cognito configuration are set in `.env`
- The server includes CORS middleware for frontend development
- All routes now use Cognito tokens for authentication

