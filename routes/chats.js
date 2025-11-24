const express = require('express')
const crypto = require('crypto')
const { docClient } = require('../utils/dynamodb')
const { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb')
const { verifyToken } = require('../utils/jwt')

const router = express.Router()
const CHATS_TABLE = process.env.CHATS_TABLE || 'ChatsTable'
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || 'MessagesTable'

// Helper function to generate unique IDs
const generateId = () => crypto.randomBytes(16).toString('hex')

// Middleware to verify authentication
const authenticate = async (req, res, next) => {
  try {
    const user = await verifyToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: No valid token provided' })
    }
    req.user = user
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' })
  }
}

// Apply authentication to all routes
router.use(authenticate)

/**
 * GET /chats
 * Get all chats for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId

    // Query chats where user is a participant
    // Note: This requires a GSI on participants with chatId as sort key
    const result = await docClient.send(
      new QueryCommand({
        TableName: CHATS_TABLE,
        IndexName: 'ParticipantIndex', // GSI: partition key = participant, sort key = updatedAt
        KeyConditionExpression: 'participant = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false, // Sort by updatedAt descending (most recent first)
      })
    )

    // Get unique chats and fetch the main chat record with lastMessage
    const chatMap = new Map()
    for (const item of result.Items) {
      if (!chatMap.has(item.chatId)) {
        // Fetch the main chat record to get lastMessage
        const chatResult = await docClient.send(
          new GetCommand({
            TableName: CHATS_TABLE,
            Key: { id: item.chatId },
          })
        )

        if (chatResult.Item) {
          chatMap.set(item.chatId, chatResult.Item)
        }
      }
    }

    // Calculate unread count for each chat
    const chats = await Promise.all(
      Array.from(chatMap.values()).map(async (chat) => {
        // Get unread message count for this user
        const messagesResult = await docClient.send(
          new QueryCommand({
            TableName: MESSAGES_TABLE,
            KeyConditionExpression: 'chatId = :chatId',
            FilterExpression: 'attribute_not_exists(readAt) AND senderId <> :userId',
            ExpressionAttributeValues: {
              ':chatId': chat.id,
              ':userId': userId,
            },
          })
        )

        return {
          ...chat,
          unreadCount: messagesResult.Items.length,
        }
      })
    )

    res.status(200).json({ chats })
  } catch (error) {
    console.error('Error fetching chats:', error)
    res.status(500).json({ error: 'Failed to fetch chats' })
  }
})

/**
 * POST /chats
 * Create a new chat or get existing chat with specified participants
 * Request body: { storeId, sellerId, storeName, initialMessage }
 */
router.post('/', async (req, res) => {
  try {
    const { storeId, sellerId, storeName, initialMessage } = req.body
    const userId = req.user.userId
    const USERS_TABLE = process.env.USERS_TABLE || 'UsersTable'

    // Validation
    if (!sellerId) {
      return res.status(400).json({ error: 'sellerId is required' })
    }

    if (sellerId === userId) {
      return res.status(400).json({ error: 'Cannot create chat with yourself' })
    }

    // Fetch buyer (current user) info from database
    const buyerResult = await docClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: userId },
      })
    )

    if (!buyerResult.Item) {
      return res.status(404).json({ error: 'Buyer user not found' })
    }

    // Fetch seller info from database
    const sellerResult = await docClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { userId: sellerId },
      })
    )

    if (!sellerResult.Item) {
      return res.status(404).json({ error: 'Seller user not found' })
    }

    const buyer = buyerResult.Item
    const seller = sellerResult.Item

    // Check if chat already exists between these two users for this store
    // Query by participant to find all chats for the buyer
    const existingChatsResult = await docClient.send(
      new QueryCommand({
        TableName: CHATS_TABLE,
        IndexName: 'ParticipantIndex',
        KeyConditionExpression: 'participant = :userId',
        FilterExpression: 'storeId = :storeId',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':storeId': storeId,
        },
      })
    )

    // Check if any existing chat includes both participants
    const existingChat = existingChatsResult.Items.find(
      (chat) =>
        chat.participants &&
        chat.participants.includes(userId) &&
        chat.participants.includes(sellerId)
    )

    if (existingChat) {
      // Return existing chat
      return res.status(200).json({
        chat: existingChat,
        message: 'Chat already exists',
      })
    }

    // Create new chat
    const chatId = generateId()
    const now = new Date().toISOString()

    const participantIds = [userId, sellerId]
    const participantNames = [buyer.name || buyer.email, seller.name || seller.email]

    const chat = {
      id: chatId,
      participants: participantIds,
      participantNames,
      storeId: storeId || undefined,
      storeName: storeName || undefined,
      createdAt: now,
      updatedAt: now,
    }

    // Create main chat record
    await docClient.send(
      new PutCommand({
        TableName: CHATS_TABLE,
        Item: chat,
      })
    )

    // Create separate participant records for GSI queries
    // These need unique primary keys (not 'id')
    for (let i = 0; i < participantIds.length; i++) {
      await docClient.send(
        new PutCommand({
          TableName: CHATS_TABLE,
          Item: {
            id: `${chatId}#participant#${participantIds[i]}`, // Unique primary key
            participant: participantIds[i], // For GSI
            chatId: chatId,
            participantName: participantNames[i],
            participants: participantIds,
            participantNames,
            storeId: storeId || undefined,
            storeName: storeName || undefined,
            createdAt: now,
            updatedAt: now,
          },
        })
      )
    }

    // Send initial message if provided
    if (initialMessage) {
      const messageId = generateId()
      const message = {
        id: messageId,
        chatId: chatId,
        senderId: userId,
        senderName: buyer.name || buyer.email,
        content: initialMessage,
        createdAt: now,
      }

      await docClient.send(
        new PutCommand({
          TableName: MESSAGES_TABLE,
          Item: message,
        })
      )

      const messageUpdateTime = new Date().toISOString()

      // Update main chat record with last message
      await docClient.send(
        new UpdateCommand({
          TableName: CHATS_TABLE,
          Key: { id: chatId },
          UpdateExpression: 'SET lastMessage = :msg, updatedAt = :time',
          ExpressionAttributeValues: {
            ':msg': message,
            ':time': messageUpdateTime,
          },
        })
      )

      // Update participant records with last message
      for (const participantId of participantIds) {
        await docClient.send(
          new UpdateCommand({
            TableName: CHATS_TABLE,
            Key: { id: `${chatId}#participant#${participantId}` },
            UpdateExpression: 'SET lastMessage = :msg, updatedAt = :time',
            ExpressionAttributeValues: {
              ':msg': message,
              ':time': messageUpdateTime,
            },
          })
        )
      }

      chat.lastMessage = message
    }

    res.status(201).json({ chat })
  } catch (error) {
    console.error('Error creating chat:', error)
    res.status(500).json({ error: 'Failed to create chat' })
  }
})

/**
 * GET /chats/:chatId
 * Get a specific chat by ID
 */
router.get('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params
    const userId = req.user.userId

    const result = await docClient.send(
      new GetCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
      })
    )

    if (!result.Item) {
      return res.status(404).json({ error: 'Chat not found' })
    }

    // Check if user is a participant
    if (!result.Item.participants.includes(userId)) {
      return res.status(403).json({ error: 'Not authorized to access this chat' })
    }

    res.status(200).json({ chat: result.Item })
  } catch (error) {
    console.error('Error fetching chat:', error)
    res.status(500).json({ error: 'Failed to fetch chat' })
  }
})

/**
 * GET /chats/:chatId/messages
 * Get all messages for a specific chat
 */
router.get('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params
    const userId = req.user.userId
    const { limit = 50, lastMessageId } = req.query

    // Verify user is a participant
    const chatResult = await docClient.send(
      new GetCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
      })
    )

    if (!chatResult.Item) {
      return res.status(404).json({ error: 'Chat not found' })
    }

    if (!chatResult.Item.participants.includes(userId)) {
      return res.status(403).json({ error: 'Not authorized to access this chat' })
    }

    // Query messages
    const queryParams = {
      TableName: MESSAGES_TABLE,
      KeyConditionExpression: 'chatId = :chatId',
      ExpressionAttributeValues: {
        ':chatId': chatId,
      },
      ScanIndexForward: false, // Most recent first
      Limit: parseInt(limit),
    }

    // Add pagination if lastMessageId provided
    if (lastMessageId) {
      queryParams.ExclusiveStartKey = {
        chatId: chatId,
        id: lastMessageId,
      }
    }

    const result = await docClient.send(new QueryCommand(queryParams))

    res.status(200).json({
      messages: result.Items,
      lastEvaluatedKey: result.LastEvaluatedKey,
    })
  } catch (error) {
    console.error('Error fetching messages:', error)
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

/**
 * POST /chats/:chatId/messages
 * Send a message in a chat
 */
router.post('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params
    const { content } = req.body
    const userId = req.user.userId

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' })
    }

    // Verify user is a participant
    const chatResult = await docClient.send(
      new GetCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
      })
    )

    if (!chatResult.Item) {
      return res.status(404).json({ error: 'Chat not found' })
    }

    if (!chatResult.Item.participants.includes(userId)) {
      return res.status(403).json({ error: 'Not authorized to send messages in this chat' })
    }

    // Create message
    const messageId = generateId()
    const now = new Date().toISOString()

    const message = {
      id: messageId,
      chatId: chatId,
      senderId: userId,
      senderName: req.user.name || 'User',
      content: content.trim(),
      createdAt: now,
    }

    await docClient.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: message,
      })
    )

    // Update main chat record with last message and updatedAt
    await docClient.send(
      new UpdateCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
        UpdateExpression: 'SET lastMessage = :msg, updatedAt = :time',
        ExpressionAttributeValues: {
          ':msg': message,
          ':time': now,
        },
      })
    )

    // Update participant records with last message
    const chat = chatResult.Item
    if (chat.participants) {
      for (const participantId of chat.participants) {
        await docClient.send(
          new UpdateCommand({
            TableName: CHATS_TABLE,
            Key: { id: `${chatId}#participant#${participantId}` },
            UpdateExpression: 'SET lastMessage = :msg, updatedAt = :time',
            ExpressionAttributeValues: {
              ':msg': message,
              ':time': now,
            },
          })
        )
      }
    }

    res.status(201).json({ message })
  } catch (error) {
    console.error('Error sending message:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

/**
 * PUT /chats/:chatId/messages/:messageId/read
 * Mark a message as read
 */
router.put('/:chatId/messages/:messageId/read', async (req, res) => {
  try {
    const { chatId, messageId } = req.params
    const userId = req.user.userId

    // Verify user is a participant
    const chatResult = await docClient.send(
      new GetCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
      })
    )

    if (!chatResult.Item || !chatResult.Item.participants.includes(userId)) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    // Get the message
    const messageResult = await docClient.send(
      new GetCommand({
        TableName: MESSAGES_TABLE,
        Key: { chatId, id: messageId },
      })
    )

    if (!messageResult.Item) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // Don't mark own messages as read
    if (messageResult.Item.senderId === userId) {
      return res.status(400).json({ error: 'Cannot mark own message as read' })
    }

    // Update message
    const now = new Date().toISOString()
    await docClient.send(
      new UpdateCommand({
        TableName: MESSAGES_TABLE,
        Key: { chatId, id: messageId },
        UpdateExpression: 'SET readAt = :time',
        ExpressionAttributeValues: {
          ':time': now,
        },
      })
    )

    res.status(200).json({ message: 'Message marked as read', readAt: now })
  } catch (error) {
    console.error('Error marking message as read:', error)
    res.status(500).json({ error: 'Failed to mark message as read' })
  }
})

/**
 * PUT /chats/:chatId/read-all
 * Mark all messages in a chat as read
 */
router.put('/:chatId/read-all', async (req, res) => {
  try {
    const { chatId } = req.params
    const userId = req.user.userId

    // Verify user is a participant
    const chatResult = await docClient.send(
      new GetCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
      })
    )

    if (!chatResult.Item || !chatResult.Item.participants.includes(userId)) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    // Get all unread messages from others
    const messagesResult = await docClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'chatId = :chatId',
        FilterExpression: 'attribute_not_exists(readAt) AND senderId <> :userId',
        ExpressionAttributeValues: {
          ':chatId': chatId,
          ':userId': userId,
        },
      })
    )

    // Mark each as read
    const now = new Date().toISOString()
    await Promise.all(
      messagesResult.Items.map((message) =>
        docClient.send(
          new UpdateCommand({
            TableName: MESSAGES_TABLE,
            Key: { chatId, id: message.id },
            UpdateExpression: 'SET readAt = :time',
            ExpressionAttributeValues: {
              ':time': now,
            },
          })
        )
      )
    )

    res.status(200).json({
      message: 'All messages marked as read',
      count: messagesResult.Items.length,
    })
  } catch (error) {
    console.error('Error marking all messages as read:', error)
    res.status(500).json({ error: 'Failed to mark messages as read' })
  }
})

/**
 * DELETE /chats/:chatId
 * Delete a chat (only if user is a participant)
 */
router.delete('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params
    const userId = req.user.userId

    // Verify user is a participant
    const chatResult = await docClient.send(
      new GetCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
      })
    )

    if (!chatResult.Item) {
      return res.status(404).json({ error: 'Chat not found' })
    }

    if (!chatResult.Item.participants.includes(userId)) {
      return res.status(403).json({ error: 'Not authorized to delete this chat' })
    }

    // Delete all messages in the chat
    const messagesResult = await docClient.send(
      new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'chatId = :chatId',
        ExpressionAttributeValues: {
          ':chatId': chatId,
        },
      })
    )

    await Promise.all(
      messagesResult.Items.map((message) =>
        docClient.send(
          new DeleteCommand({
            TableName: MESSAGES_TABLE,
            Key: { chatId, id: message.id },
          })
        )
      )
    )

    // Delete chat
    await docClient.send(
      new DeleteCommand({
        TableName: CHATS_TABLE,
        Key: { id: chatId },
      })
    )

    res.status(200).json({ message: 'Chat deleted successfully' })
  } catch (error) {
    console.error('Error deleting chat:', error)
    res.status(500).json({ error: 'Failed to delete chat' })
  }
})

/**
 * GET /chats/store/:storeId
 * Get all chats related to a specific store
 */
router.get('/store/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params
    const userId = req.user.userId

    // Query chats by storeId (requires GSI)
    const result = await docClient.send(
      new QueryCommand({
        TableName: CHATS_TABLE,
        IndexName: 'StoreIndex', // GSI: partition key = storeId, sort key = updatedAt
        KeyConditionExpression: 'storeId = :storeId',
        FilterExpression: 'contains(participants, :userId)',
        ExpressionAttributeValues: {
          ':storeId': storeId,
          ':userId': userId,
        },
        ScanIndexForward: false,
      })
    )

    res.status(200).json({ chats: result.Items })
  } catch (error) {
    console.error('Error fetching store chats:', error)
    res.status(500).json({ error: 'Failed to fetch store chats' })
  }
})

module.exports = router
