const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
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
    // Set proper content type for images
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
    res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Upload endpoint
app.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const folder = req.body.folder || 'general';
    if (!dirs.includes(folder)) {
      return res.status(400).json({ success: false, message: `Invalid folder. Use: ${dirs.join(', ')}` });
    }

    const filename = `${uuidv4()}.webp`;
    const filePath = path.join(STORAGE_DIR, folder, filename);

    // Process image with sharp - convert to webp for smaller size
    let sharpInstance = sharp(req.file.buffer);

    // Get image metadata
    const metadata = await sharpInstance.metadata();

    // Resize if too large (max 1920px width)
    if (metadata.width > 1920) {
      sharpInstance = sharpInstance.resize(1920, null, { withoutEnlargement: true });
    }

    // Convert to webp with good quality
    await sharpInstance
      .webp({ quality: 85 })
      .toFile(filePath);

    // Get file stats
    const stats = fs.statSync(filePath);

    const imageUrl = `/uploads/${folder}/${filename}`;

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

// Upload multiple images
app.post('/upload/multiple', authMiddleware, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No image files provided' });
    }

    const folder = req.body.folder || 'general';
    if (!dirs.includes(folder)) {
      return res.status(400).json({ success: false, message: `Invalid folder. Use: ${dirs.join(', ')}` });
    }

    const results = [];

    for (const file of req.files) {
      const filename = `${uuidv4()}.webp`;
      const filePath = path.join(STORAGE_DIR, folder, filename);

      let sharpInstance = sharp(file.buffer);
      const metadata = await sharpInstance.metadata();

      if (metadata.width > 1920) {
        sharpInstance = sharpInstance.resize(1920, null, { withoutEnlargement: true });
      }

      await sharpInstance.webp({ quality: 85 }).toFile(filePath);

      const stats = fs.statSync(filePath);

      results.push({
        imageUrl: `/uploads/${folder}/${filename}`,
        filename,
        size: stats.size,
        originalName: file.originalname,
      });
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Multiple upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload images' });
  }
});

// Delete image
app.delete('/delete', authMiddleware, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'imageUrl is required' });
    }

    // Extract path from URL (remove /uploads/ prefix)
    const relativePath = imageUrl.replace('/uploads/', '');
    const filePath = path.join(STORAGE_DIR, relativePath);

    // Security: ensure path is within STORAGE_DIR
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
