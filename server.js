
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import busboy from 'busboy';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { http } from '@google-cloud/functions-framework';
import { Storage } from '@google-cloud/storage';
import textToSpeech from '@google-cloud/text-to-speech';
import Menu from './models/Menu.js';

dotenv.config();

const app = express();
app.use(cors());

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const parseImageUpload = (req, res, next) => {
  let parser;

  try {
    parser = busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_IMAGE_SIZE_BYTES,
        files: 1,
        fields: 10,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }

  const fields = {};
  let uploadedFile;
  let uploadError;

  const setUploadError = (status, message) => {
    if (!uploadError) {
      uploadError = { status, message };
    }
  };

  parser.on('field', (name, value) => {
    fields[name] = value;
  });

  parser.on('file', (fieldName, fileStream, fileInfo) => {
    if (fieldName !== 'menuItemImage') {
      setUploadError(400, 'The image must use the "menuItemImage" form field');
      fileStream.resume();
      return;
    }

    const chunks = [];
    let size = 0;

    fileStream.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
    });

    fileStream.on('limit', () => {
      setUploadError(413, 'Image must be 5 MB or smaller');
    });

    fileStream.on('end', () => {
      if (!uploadError) {
        uploadedFile = {
          fieldname: fieldName,
          originalname: fileInfo.filename,
          encoding: fileInfo.encoding,
          mimetype: fileInfo.mimeType,
          size,
          buffer: Buffer.concat(chunks),
        };
      }
    });
  });

  parser.on('filesLimit', () => {
    setUploadError(400, 'Only one image can be uploaded');
  });

  parser.on('fieldsLimit', () => {
    setUploadError(400, 'Too many form fields');
  });

  parser.on('error', (error) => {
    setUploadError(400, error.message);
  });

  parser.on('close', () => {
    if (uploadError) {
      return res.status(uploadError.status).json({
        success: false,
        error: uploadError.message,
      });
    }

    req.body = fields;
    req.file = uploadedFile;
    return next();
  });

  if (Buffer.isBuffer(req.rawBody)) {
    parser.end(req.rawBody);
  } else {
    req.pipe(parser);
  }
};

// Initialize Google Cloud Storage using local CLI credentials
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
});
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

// NEW: Initialize Google Cloud Text-to-Speech client using ADC
const ttsClient = new textToSpeech.TextToSpeechClient({
  projectId: process.env.GCP_PROJECT_ID,
});

let mongoConnectionPromise;

const connectToMongo = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured');
  }

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    }).catch((error) => {
      mongoConnectionPromise = undefined;
      throw error;
    });
  }

  await mongoConnectionPromise;
};

// Image Upload & WebP Conversion Endpoint
app.post('/api/upload-image', parseImageUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'An image file is required in the "menuItemImage" form field',
    });
  }

  const menuName = req.body.menuName?.trim();

  if (!menuName) {
    return res.status(400).json({
      success: false,
      error: 'menuName is required',
    });
  }

  try {
    await connectToMongo();
  } catch (error) {
    console.error('MongoDB connection error:', error);
    return res.status(503).json({
      success: false,
      error: 'Unable to connect to MongoDB',
    });
  }

  let sourceMetadata;
  let webpBuffer;
  let convertedMetadata;

  try {
    const image = sharp(req.file.buffer, { failOn: 'error' });
    sourceMetadata = await image.metadata();
    const conversionResult = await image
      .rotate()
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    webpBuffer = conversionResult.data;
    convertedMetadata = conversionResult.info;
  } catch (error) {
    return res.status(415).json({
      success: false,
      error: 'The uploaded file is not a supported image',
    });
  }

  let uploadedFile;

  try {
    const fileName = `uploaded-images/${randomUUID()}.webp`;
    const file = bucket.file(fileName);

    await file.save(webpBuffer, {
      resumable: false,
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    uploadedFile = file;

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    const imageDetails = {
      source: 'uploaded',
      bucket: bucket.name,
      objectName: fileName,
      original: {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        detectedFormat: sourceMetadata.format,
        sizeBytes: req.file.size,
        width: sourceMetadata.width,
        height: sourceMetadata.height,
      },
      converted: {
        format: 'webp',
        mimeType: 'image/webp',
        sizeBytes: webpBuffer.length,
        width: convertedMetadata.width,
        height: convertedMetadata.height,
      },
      uploadedAt: new Date(),
    };

    const newMenuEntry = new Menu({
      menuName,
      imageUrl: publicUrl,
      imageDetails,
    });
    await newMenuEntry.save();

    return res.status(201).json({
      success: true,
      message: 'Image uploaded and Menu created successfully',
      data: {
        menuId: newMenuEntry._id,
        menuName: newMenuEntry.menuName,
        publicUrl,
        imageDetails: newMenuEntry.imageDetails,
      },
    });
  } catch (error) {
    if (uploadedFile) {
      try {
        await uploadedFile.delete({ ignoreNotFound: true });
      } catch (cleanupError) {
        console.error('Failed to clean up uploaded image:', cleanupError);
      }
    }

    console.error('Error uploading image or creating menu:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload the image or create the Menu document',
    });
  }
});

// Image Generation & Upload Endpoint
app.post('/api/generate-image', async (req, res) => {
  try {
    const menuName = req.body.menuName?.trim();

    if (!menuName) {
      return res.status(400).json({ error: 'menuName is required in the payload' });
    }

    await connectToMongo();

    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    // 1. Ask Gemini to generate the image
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const prompt = `A professional, appetizing food photography shot of ${menuName}. High quality, well-lit, visually stunning, copyright-free style.`;

    const response = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to generate image from Gemini API');
    }

    // 2. Extract Base64 from the Gemini response securely
    const candidate = data.candidates?.[0];
    if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
      throw new Error('Image generation failed or was stopped.');
    }

    const parts = candidate.content?.parts || [];
    const imagePart = parts.find(part => part.inlineData && part.inlineData.data);

    if (!imagePart) {
      throw new Error('No image found in the response.');
    }

    // 3. Compress directly to WebP using Sharp
    const base64Image = imagePart.inlineData.data;
    const imageBuffer = Buffer.from(base64Image, 'base64');
    
    const webpBuffer = await sharp(imageBuffer)
      .webp({ quality: 80 }) 
      .toBuffer();

    // 4. Upload the WebP buffer to Google Cloud Storage
    const fileName = `menu-images/menu_${Date.now()}.webp`;
    const file = bucket.file(fileName);

    await file.save(webpBuffer, {
      metadata: {
        contentType: 'image/webp',
      },
      
    });

    // 5. Save the public Cloud Storage URL to MongoDB
    const fullImageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    
    const newMenuEntry = new Menu({
      menuName,
      imageUrl: fullImageUrl
    });

    await newMenuEntry.save();

    // 6. Return Success
    res.status(201).json({
      success: true,
      message: 'Image generated, compressed, and uploaded to Cloud Storage successfully',
      data: {
        id: newMenuEntry._id,
        menuName: newMenuEntry.menuName,
        imageUrl: fullImageUrl 
      }
    });

  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'menuApi',
  });
});

http('menuApi', app);

export { app };
