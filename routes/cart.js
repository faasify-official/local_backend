/**
 * Cart routes for local Express development.
 * Mirrors the Lambda cart handler by storing carts in DynamoDB and layering Redis as a cache.
 * Uses a cache-aside pattern: read from Redis first, then DynamoDB, and refresh Redis after writes.
 */
const express = require("express");
const { docClient } = require("../utils/dynamodb");
const {
  GetCommand,
  PutCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { verifyToken } = require("../utils/jwt");
const { getRedisClient } = require("../utils/redis");

const router = express.Router();
const TABLE_NAME = process.env.CART_TABLE || "CartTable";
const rawCartTtl = parseInt(process.env.CART_TTL_SECONDS || "604800", 10);
// Default to 7 days; set to 0 to disable cache writes when troubleshooting.
const CACHE_TTL_SECONDS =
  Number.isFinite(rawCartTtl) && rawCartTtl >= 0 ? rawCartTtl : 604800;
const CART_SORT_KEY = process.env.CART_SORT_KEY; // Optional range key (e.g., storeId) for CartTable
const CART_DEFAULT_SCOPE = process.env.CART_DEFAULT_SCOPE || "default";

// Use storeId when provided so composite cart keys stay consistent with the table schema.
const getCartScope = (req) => {
  const maybeScope = req.query?.storeId ?? req.body?.storeId;
  return (maybeScope ?? CART_DEFAULT_SCOPE).toString();
};

// Keep cache keys aligned with DynamoDB key shape so multi-store carts do not collide.
const buildCartKey = (userId, scope) =>
  CART_SORT_KEY ? { userId, [CART_SORT_KEY]: scope } : { userId };

const cacheKeyForCart = (userId, scope) =>
  CART_SORT_KEY ? `cart:${userId}:${scope}` : `cart:${userId}`;

const getUserId = async (req) => {
  if (req.user?.id) return req.user.id;
  if (req.user?.userId) return req.user.userId;
  const verified = await verifyToken(req);
  return verified?.userId || null;
};

const loadCartFromDatabase = async (userId, cartScope) => {
  const cartKey = buildCartKey(userId, cartScope);
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: cartKey,
    })
  );

  if (result.Item) return result.Item;
  return { ...cartKey, items: [], updatedAt: new Date().toISOString() };
};

const saveCartToDatabase = async (userId, items, cartScope) => {
  const cartKey = buildCartKey(userId, cartScope);
  const cart = {
    ...cartKey,
    items,
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: cart,
    })
  );

  return cart;
};

const deleteCartFromDatabase = async (userId, cartScope) => {
  const cartKey = buildCartKey(userId, cartScope);
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: cartKey,
    })
  );
};

const loadCartFromCache = async (userId, cartScope) => {
  const redisClient = await getRedisClient();
  if (!redisClient) return null;

  try {
    const cached = await redisClient.get(cacheKeyForCart(userId, cartScope));
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.error("Redis read failed (continuing with DynamoDB):", err.message);
    return null;
  }
};

const saveCartToCache = async (userId, cart, cartScope) => {
  if (CACHE_TTL_SECONDS === 0) return; // Allow disabling cache writes via env during incidents.
  const redisClient = await getRedisClient();
  if (!redisClient) return;

  try {
    await redisClient.set(cacheKeyForCart(userId, cartScope), JSON.stringify(cart), {
      EX: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.error("Redis write failed (cache not refreshed):", err.message);
  }
};

const deleteCartFromCache = async (userId, cartScope) => {
  const redisClient = await getRedisClient();
  if (!redisClient) return;

  try {
    await redisClient.del(cacheKeyForCart(userId, cartScope));
  } catch (err) {
    console.error("Redis delete failed:", err.message);
  }
};

// GET /cart - fetch the current cart (cache-first)
router.get("/", async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const cartScope = getCartScope(req);
    const cached = await loadCartFromCache(userId, cartScope);
    if (cached) {
      return res.status(200).json(cached);
    }

    const cart = await loadCartFromDatabase(userId, cartScope);
    await saveCartToCache(userId, cart, cartScope);

    res.status(200).json(cart);
  } catch (error) {
    console.error("Error getting cart:", error);
    res.status(500).json({ error: "Failed to get cart" });
  }
});

// POST /cart/item - add or replace an item
router.post("/item", async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const cartScope = getCartScope(req);

    const { itemId, quantity = 1, ...details } = req.body;
    if (!itemId) {
      return res.status(400).json({ error: "itemId is required" });
    }

    const parsedQuantity = Number(quantity);
    const safeQuantity =
      Number.isFinite(parsedQuantity) && parsedQuantity > 0
        ? parsedQuantity
        : 1;

    const currentCart = await loadCartFromDatabase(userId, cartScope);
    const items = Array.isArray(currentCart.items)
      ? [...currentCart.items]
      : [];
    const existingIndex = items.findIndex((item) => item.itemId === itemId);

    if (existingIndex >= 0) {
      items[existingIndex] = {
        ...items[existingIndex],
        ...details,
        itemId,
        quantity: safeQuantity,
      };
    } else {
      items.push({ itemId, quantity: safeQuantity, ...details });
    }

    const updatedCart = await saveCartToDatabase(userId, items, cartScope);
    await saveCartToCache(userId, updatedCart, cartScope);

    res.status(200).json(updatedCart);
  } catch (error) {
    console.error("Error adding to cart:", error);
    res.status(500).json({ error: "Failed to add to cart" });
  }
});

// PATCH /cart/item - update quantity or metadata for an existing item
router.patch("/item", async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const cartScope = getCartScope(req);

    const { itemId, quantity, ...details } = req.body;
    if (!itemId) {
      return res.status(400).json({ error: "itemId is required" });
    }

    const currentCart = await loadCartFromDatabase(userId, cartScope);
    const items = Array.isArray(currentCart.items)
      ? [...currentCart.items]
      : [];
    const existingIndex = items.findIndex((item) => item.itemId === itemId);

    if (existingIndex === -1) {
      return res.status(404).json({ error: "Item not found in cart" });
    }

    const updatedItem = { ...items[existingIndex], ...details };
    if (quantity !== undefined) {
      const parsedQuantity = Number(quantity);
      if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
        return res
          .status(400)
          .json({ error: "Quantity must be a positive number" });
      }
      updatedItem.quantity = parsedQuantity;
    }

    items[existingIndex] = updatedItem;

    const updatedCart = await saveCartToDatabase(userId, items, cartScope);
    await saveCartToCache(userId, updatedCart, cartScope);

    res.status(200).json(updatedCart);
  } catch (error) {
    console.error("Error updating cart:", error);
    res.status(500).json({ error: "Failed to update cart" });
  }
});

// DELETE /cart/item - remove a single item
router.delete("/item", async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const cartScope = getCartScope(req);

    const { itemId } = req.body;
    if (!itemId) {
      return res.status(400).json({ error: "itemId is required" });
    }

    const currentCart = await loadCartFromDatabase(userId, cartScope);
    const filteredItems = (currentCart.items || []).filter(
      (item) => item.itemId !== itemId
    );

    const updatedCart = await saveCartToDatabase(userId, filteredItems, cartScope);
    await saveCartToCache(userId, updatedCart, cartScope);

    res.status(200).json(updatedCart);
  } catch (error) {
    console.error("Error removing from cart:", error);
    res.status(500).json({ error: "Failed to remove from cart" });
  }
});

// DELETE /cart - clear the whole cart
router.delete("/", async (req, res) => {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const cartScope = getCartScope(req);
    await deleteCartFromDatabase(userId, cartScope);
    await deleteCartFromCache(userId, cartScope);

    res.status(200).json({
      ...buildCartKey(userId, cartScope),
      items: [],
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error clearing cart:", error);
    res.status(500).json({ error: "Failed to clear cart" });
  }
});

module.exports = router;

/*
Architecture note: Express + DynamoDB CartTable + Redis cache.
DynamoDB stores the durable cart, while Redis accelerates reads with a cache-aside pattern. Writes go
to DynamoDB first and then refresh Redis so the local server mirrors the Lambda behavior and carts
persist across sessions.
*/
