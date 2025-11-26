const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { verifyToken } = require('../utils/jwt');

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL;

// Validate environment variables
if (!REGION || !BUCKET || !CLOUDFRONT_URL) {
  console.error('Missing required environment variables for S3 upload:');
  console.error('AWS_REGION:', REGION ? '✓' : '✗');
  console.error('S3_BUCKET:', BUCKET ? '✓' : '✗');
  console.error('CLOUDFRONT_URL:', CLOUDFRONT_URL ? '✓' : '✗');
}

const s3 = new S3Client({ region: REGION });

// Map file extensions to proper MIME types
const getContentType = (ext) => {
  const mimeMap = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
  };
  return mimeMap[ext.toLowerCase()] || 'image/jpeg';
};

// Server-side upload endpoint (avoids CORS issues)
router.post('/', async (req, res) => {
  try {
    // Verify authentication
    const user = verifyToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!REGION || !BUCKET || !CLOUDFRONT_URL) {
      return res.status(500).json({ error: 'S3 configuration is missing. Please check environment variables.' });
    }

    // Get file from request body (should be binary)
    const fileBuffer = req.body;
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ error: 'No file data provided' });
    }

    // Get content type from headers
    const contentType = req.headers['content-type'] || 'image/jpeg';
    
    // Determine extension from content type
    let ext = 'jpg';
    if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('gif')) ext = 'gif';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('svg')) ext = 'svg';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';

    const key = `items/${crypto.randomUUID()}.${ext}`;

    // Upload to S3 - try with public-read ACL first, fallback if ACLs are disabled
    let command;
    try {
      command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: 'public-read' // Make object publicly readable
      });
      await s3.send(command);
    } catch (aclError) {
      // If ACL fails (bucket has ACLs disabled), try without ACL
      // You'll need to use Origin Access Control (OAC) in CloudFront instead
      if (aclError.name === 'InvalidRequest' || aclError.message?.includes('ACL')) {
        command = new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: fileBuffer,
          ContentType: contentType
        });
        await s3.send(command);
      } else {
        throw aclError; // Re-throw if it's a different error
      }
    }
    
    // Return both CloudFront and S3 URLs
    const cloudFrontUrl = `${CLOUDFRONT_URL}/${key}`;
    const s3Url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
    
    // Since CloudFront is having permission issues, use S3 URL directly
    // S3 URL will work if bucket is public or has proper permissions
    // CloudFront URL is included for future use once OAC is properly configured
    res.json({ 
      imageUrl: s3Url, // Use S3 URL directly since CloudFront has 403 issues
      cloudFrontUrl: cloudFrontUrl, // Keep for reference
      s3Url: s3Url
    });
  } catch (err) {
    console.error('Error uploading image:', err);
    res.status(500).json({ error: 'failed to upload image', details: err.message });
  }
});

// Keep the old endpoint for backward compatibility (but it has CORS issues)
router.get('/upload-url', async (req, res) => {
  try {
    if (!REGION || !BUCKET || !CLOUDFRONT_URL) {
      return res.status(500).json({ error: 'S3 configuration is missing. Please check environment variables.' });
    }

    const ext = (req.query.ext || 'jpg').toLowerCase();
    
    // Normalize extension (jpeg -> jpg for consistency)
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
