// import express from 'express';
// import mongoose from 'mongoose';
// import dotenv from 'dotenv';
// import cors from 'cors';
// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import Menu from './models/Menu.js';

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// app.use(cors());
// app.use(express.json());

// const uploadDir = path.join(__dirname, 'uploads', 'menu');
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
// }

// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// mongoose.connect(process.env.MONGODB_URI)
//   .then(() => console.log('Connected to MongoDB'))
//   .catch((err) => console.error('MongoDB connection error:', err));

// app.post('/api/generate-image', async (req, res) => {
//   try {
//     const { menuName } = req.body;

//     if (!menuName) {
//       return res.status(400).json({ error: 'menuName is required in the payload' });
//     }

//     const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
//     const prompt = `A professional, appetizing food photography shot of ${menuName}. High quality, well-lit, visually stunning, copyright-free style.`;

//     const response = await fetch(geminiEndpoint, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         contents: [
//           {
//             parts: [{ text: prompt }]
//           }
//         ]
//       })
//     });

//     const data = await response.json();

//     if (!response.ok) {
//       throw new Error(data.error?.message || 'Failed to generate image from Gemini API');
//     }

//     // 1. Check for standard candidates array
//     const candidate = data.candidates?.[0];
//     if (!candidate) {
//       throw new Error('No candidates returned. Full response: ' + JSON.stringify(data));
//     }

//     // 2. Catch safety blocks or other early stop reasons
//     if (candidate.finishReason && candidate.finishReason !== 'STOP') {
//       throw new Error(`Generation stopped unexpectedly. Reason: ${candidate.finishReason}`);
//     }

//     // 3. Search through the returned parts to find the actual inlineData image securely
//     const parts = candidate.content?.parts || [];
//     const imagePart = parts.find(part => part.inlineData && part.inlineData.data);

//     if (!imagePart) {
//       console.error('Unexpected API Response:', JSON.stringify(data, null, 2));
//       throw new Error('No image found in the response. The model may have returned text instead. Check terminal console for details.');
//     }

//     const base64Image = imagePart.inlineData.data;

//     const fileName = `menu_${Date.now()}.jpg`;
//     const filePath = path.join(uploadDir, fileName);
    
//     fs.writeFileSync(filePath, base64Image, 'base64');

//     const relativeImageUrl = `/uploads/menu/${fileName}`;
//     const newMenuEntry = new Menu({
//       menuName,
//       imageUrl: relativeImageUrl
//     });

//     await newMenuEntry.save();

//     const baseUrl = `${req.protocol}://${req.get('host')}`;
//     const fullImageUrl = `${baseUrl}${relativeImageUrl}`;

//     res.status(201).json({
//       success: true,
//       message: 'Image generated and saved successfully',
//       data: {
//         id: newMenuEntry._id,
//         menuName: newMenuEntry.menuName,
//         imageUrl: fullImageUrl 
//       }
//     });

//   } catch (error) {
//     console.error('Error generating image:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // GET API to list models for debugging
// app.get('/api/models', async (req, res) => {
//   try {
//     const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
//     const data = await response.json();
//     res.json({ success: true, models: data.models });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });


import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp'; // NEW: High-performance image processing
import Menu from './models/Menu.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads', 'menu');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

app.post('/api/generate-image', async (req, res) => {
  try {
    const { menuName } = req.body;

    if (!menuName) {
      return res.status(400).json({ error: 'menuName is required in the payload' });
    }

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const prompt = `A professional, appetizing food photography shot of ${menuName}. High quality, well-lit, visually stunning, copyright-free style.`;

    const response = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to generate image from Gemini API');
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidates returned. Full response: ' + JSON.stringify(data));
    }

    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Generation stopped unexpectedly. Reason: ${candidate.finishReason}`);
    }

    const parts = candidate.content?.parts || [];
    const imagePart = parts.find(part => part.inlineData && part.inlineData.data);

    if (!imagePart) {
      console.error('Unexpected API Response:', JSON.stringify(data, null, 2));
      throw new Error('No image found in the response.');
    }

    // 1. Extract Base64 and convert it to a Node Buffer
    const base64Image = imagePart.inlineData.data;
    const imageBuffer = Buffer.from(base64Image, 'base64');

    // 2. Set the file extension to .webp
    const fileName = `menu_${Date.now()}.webp`;
    const filePath = path.join(uploadDir, fileName);
    
    // 3. Compress and convert the Buffer to WebP directly on disk
    await sharp(imageBuffer)
      .webp({ quality: 90 }) 
      .toFile(filePath);

    const relativeImageUrl = `/uploads/menu/${fileName}`;
    
    const newMenuEntry = new Menu({
      menuName,
      imageUrl: relativeImageUrl
    });

    await newMenuEntry.save();

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fullImageUrl = `${baseUrl}${relativeImageUrl}`;

    res.status(201).json({
      success: true,
      message: 'Image generated and saved as WebP successfully',
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

app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    res.json({ success: true, models: data.models });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});