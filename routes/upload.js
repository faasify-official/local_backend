const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const multer = require('multer');
const { verifyToken } = require('../utils/jwt');

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;          // e.g. faasify-item-images
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL;

// --- sanity check ---
if (!REGION || !BUCKET || !CLOUDFRONT_URL) {
  console.error('Missing required environment variables for S3 upload:');
  console.error('AWS_REGION:', REGION ? '✓' : '✗');
  console.error('S3_BUCKET:', BUCKET ? '✓' : '✗');
  console.error('CLOUDFRONT_URL:', CLOUDFRONT_URL ? '✓' : '✗');
}

const s3 = new S3Client({ region: REGION });

// Multer: keep uploaded file in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
});

// Map file extensions to proper MIME types (used by /upload-url endpoint)
const getContentType = (ext) => {
  const mimeMap = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return mimeMap[ext.toLowerCase()] || 'image/jpeg';
};

/**
 * POST /upload
 * Body: multipart/form-data with field "image"
 * Returns: { imageUrl, cloudFrontUrl, s3Url }
 */
router.post('/', upload.single('image'), async (req, res) => {
  try {
    // auth
    const user = await verifyToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!REGION || !BUCKET || !CLOUDFRONT_URL) {
      return res.status(500).json({
        error: 'S3 configuration is missing. Please check environment variables.',
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileBuffer = file.buffer;      // 🔥 actual binary
    const contentType = file.mimetype;   // e.g. image/jpeg

    // derive extension from mimetype
    let ext = 'jpg';
    if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('gif')) ext = 'gif';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('svg')) ext = 'svg';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';

    const key = `items/${crypto.randomUUID()}.${ext}`;

    // upload to S3
    let command;
    try {
      command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        // ACL: 'public-read', // optional; not needed with bucket owner enforced + public policy
      });
      await s3.send(command);
    } catch (aclError) {
      // if ACL not allowed (because ACLs disabled), retry without ACL
      if (aclError.name === 'InvalidRequest' || aclError.message?.includes('ACL')) {
        command = new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: fileBuffer,
          ContentType: contentType,
        });
        await s3.send(command);
      } else {
        throw aclError;
      }
    }

    const cloudFrontUrl = `${CLOUDFRONT_URL}/${key}`;
    const s3Url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

    // for now you’ll use imageUrl/s3Url in the app
    res.json({
      imageUrl: s3Url,
      cloudFrontUrl,
      s3Url,
    });
  } catch (err) {
    console.error('Error uploading image:', err);
    res.status(500).json({ error: 'failed to upload image', details: err.message });
  }
});

/**
 * GET /upload/upload-url
 * (old presigned URL endpoint – optional, keep if you still use it)
 */
router.get('/upload-url', async (req, res) => {
  try {
    if (!REGION || !BUCKET || !CLOUDFRONT_URL) {
      return res.status(500).json({
        error: 'S3 configuration is missing. Please check environment variables.',
      });
    }

    const ext = (req.query.ext || 'jpg').toLowerCase();
    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;

    const key = `items/${crypto.randomUUID()}.${normalizedExt}`;
    const contentType = getContentType(normalizedExt);

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    const imageUrl = `${CLOUDFRONT_URL}/${key}`;

    res.json({ uploadUrl, imageUrl });
  } catch (err) {
    console.error('Error generating upload URL:', err);
    res.status(500).json({ error: 'failed to generate upload url', details: err.message });
  }
});

module.exports = router;
