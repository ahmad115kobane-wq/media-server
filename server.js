const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

// API Key for upload authentication
const API_KEY = process.env.API_KEY || 'media-server-secret-key';

// Storage directory - Railway persistent volume mounts at /data
const STORAGE_DIR = process.env.STORAGE_DIR || '/data/uploads';

// Ensure storage directories exist
const dirs = ['avatars', 'news', 'store', 'sliders', 'general'];
dirs.forEach(dir => {
  const fullPath = path.join(STORAGE_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors());
app.use(express.json());

// Serve uploaded files as static
app.use('/uploads', express.static(STORAGE_DIR, {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
    res.setHeader('Cache-Control', 'public, max-age=2592000');
  },
}));

// Auth middleware for uploads
const authMiddleware = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

// Multer config - memory storage for processing with sharp
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// Upload endpoint
app.post('/upload', authMiddleware, async (req, res) => {
  try {
    // Use multer as promise
    await new Promise((resolve, reject) => {
      upload.single('image')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const folder = req.body.folder || 'general';
    if (!dirs.includes(folder)) {
      return res.status(400).json({ success: false, message: `Invalid folder. Use: ${dirs.join(', ')}` });
    }

    const filename = `${generateId()}.webp`;
    const filePath = path.join(STORAGE_DIR, folder, filename);

    // Process image with sharp - convert to webp
    let pipeline = sharp(req.file.buffer);
    const metadata = await pipeline.metadata();

    if (metadata.width > 1920) {
      pipeline = pipeline.resize(1920, null, { withoutEnlargement: true });
    }

    await pipeline.webp({ quality: 85 }).toFile(filePath);

    const stats = fs.statSync(filePath);
    const imageUrl = `/uploads/${folder}/${filename}`;

    console.log(`✅ Uploaded: ${imageUrl} (${formatBytes(stats.size)})`);

    res.json({
      success: true,
      data: {
        imageUrl,
        filename,
        folder,
        size: stats.size,
        originalName: req.file.originalname,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload image' });
  }
});

// Delete image
app.delete('/delete', authMiddleware, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'imageUrl is required' });
    }

    const relativePath = imageUrl.replace('/uploads/', '');
    const filePath = path.join(STORAGE_DIR, relativePath);

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(STORAGE_DIR))) {
      return res.status(400).json({ success: false, message: 'Invalid path' });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true, message: 'Image deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete image' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Media server is running' });
});

app.get('/health', (req, res) => {
  const storageExists = fs.existsSync(STORAGE_DIR);
  res.json({
    status: 'ok',
    storage: storageExists ? 'mounted' : 'not mounted',
    uptime: process.uptime(),
  });
});

// Storage stats
app.get('/stats', authMiddleware, (req, res) => {
  try {
    const stats = {};
    let totalSize = 0;
    let totalFiles = 0;

    dirs.forEach(dir => {
      const dirPath = path.join(STORAGE_DIR, dir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        let dirSize = 0;
        files.forEach(file => {
          const fileStat = fs.statSync(path.join(dirPath, file));
          dirSize += fileStat.size;
        });
        stats[dir] = { files: files.length, size: dirSize };
        totalSize += dirSize;
        totalFiles += files.length;
      } else {
        stats[dir] = { files: 0, size: 0 };
      }
    });

    res.json({
      success: true,
      data: {
        folders: stats,
        total: { files: totalFiles, size: totalSize, sizeFormatted: formatBytes(totalSize) },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get stats' });
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📸 Media server running on port ${PORT}`);
  console.log(`📁 Storage directory: ${STORAGE_DIR}`);
});
