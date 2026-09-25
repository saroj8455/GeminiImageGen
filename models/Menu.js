import mongoose from 'mongoose';

const imageDetailsSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ['uploaded', 'generated'],
    required: true,
  },
  bucket: {
    type: String,
    required: true,
  },
  objectName: {
    type: String,
    required: true,
  },
  original: {
    fileName: String,
    mimeType: String,
    detectedFormat: String,
    sizeBytes: Number,
    width: Number,
    height: Number,
  },
  converted: {
    format: String,
    mimeType: String,
    sizeBytes: Number,
    width: Number,
    height: Number,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const menuSchema = new mongoose.Schema({
  menuName: {
    type: String,
    required: true,
    trim: true
  },
  imageUrl: {
    type: String,
    required: true
  },
  imageDetails: {
    type: imageDetailsSchema,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Menu', menuSchema);
