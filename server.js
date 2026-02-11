const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

// API Key for upload authentication
const API_KEY = process.env.API_KEY || 'media-server-secret-key';

// Storage directory - Railway persistent volume mounts at /data
const STORAGE_DIR = process.env.STORAGE_DIR || '/data/uploads';

// Allowed folders
const FOLDERS = ['avatars', 'news', 'store', 'sliders', 'videos', 'general'];

// Allowed file types
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const ALLOWED_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES];

// Ensure storage directories exist
FOLDERS.forEach(dir => {
  const fullPath = path.join(STORAGE_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve uploaded files as static
app.use('/uploads', express.static(STORAGE_DIR, {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif',
      '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4', '.webm': 'video/webm',
      '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    };
    if (mimeTypes[ext]) res.setHeader('Content-Type', mimeTypes[ext]);
    res.setHeader('Cache-Control', 'public, max-age=2592000');
  },
}));

// Auth middleware
const authMiddleware = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

// Multer config - 50MB for videos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Upload single file (image or video)
app.post('/upload', authMiddleware, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    try {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file provided' });
      }

      const folder = req.body.folder || 'general';
      if (!FOLDERS.includes(folder)) {
        return res.status(400).json({ success: false, message: `Invalid folder. Use: ${FOLDERS.join(', ')}` });
      }

      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const filename = `${generateId()}${ext}`;
      const filePath = path.join(STORAGE_DIR, folder, filename);

      // Save file
      fs.writeFileSync(filePath, req.file.buffer);

      const stats = fs.statSync(filePath);
      const isVideo = VIDEO_TYPES.includes(req.file.mimetype);
      const mediaUrl = `/uploads/${folder}/${filename}`;

      console.log(`✅ ${isVideo ? 'Video' : 'Image'} uploaded: ${mediaUrl} (${formatBytes(stats.size)})`);

      res.json({
        success: true,
        data: {
          imageUrl: mediaUrl,
          url: mediaUrl,
          filename,
          folder,
          size: stats.size,
          type: isVideo ? 'video' : 'image',
          mimetype: req.file.mimetype,
          originalName: req.file.originalname,
        },
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ success: false, message: 'Failed to upload file' });
    }
  });
});

// Upload multiple files
app.post('/upload/multiple', authMiddleware, (req, res) => {
  upload.array('files', 10)(req, res, async (err) => {
    try {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'No files provided' });
      }

      const folder = req.body.folder || 'general';
      if (!FOLDERS.includes(folder)) {
        return res.status(400).json({ success: false, message: `Invalid folder. Use: ${FOLDERS.join(', ')}` });
      }

      const results = [];
      for (const file of req.files) {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const filename = `${generateId()}${ext}`;
        const filePath = path.join(STORAGE_DIR, folder, filename);

        fs.writeFileSync(filePath, file.buffer);
        const stats = fs.statSync(filePath);
        const isVideo = VIDEO_TYPES.includes(file.mimetype);

        results.push({
          imageUrl: `/uploads/${folder}/${filename}`,
          url: `/uploads/${folder}/${filename}`,
          filename,
          size: stats.size,
          type: isVideo ? 'video' : 'image',
          originalName: file.originalname,
        });
      }

      console.log(`✅ ${results.length} files uploaded to ${folder}`);
      res.json({ success: true, data: results });
    } catch (error) {
      console.error('Multiple upload error:', error);
      res.status(500).json({ success: false, message: 'Failed to upload files' });
    }
  });
});

// Delete file
app.delete('/delete', authMiddleware, (req, res) => {
  try {
    const { imageUrl, url } = req.body;
    const fileUrl = imageUrl || url;
    if (!fileUrl) {
      return res.status(400).json({ success: false, message: 'url is required' });
    }

    const relativePath = fileUrl.replace('/uploads/', '');
    const filePath = path.join(STORAGE_DIR, relativePath);

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(STORAGE_DIR))) {
      return res.status(400).json({ success: false, message: 'Invalid path' });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted: ${fileUrl}`);
    }

    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete file' });
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
    const folderStats = {};
    let totalSize = 0;
    let totalFiles = 0;

    FOLDERS.forEach(dir => {
      const dirPath = path.join(STORAGE_DIR, dir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        let dirSize = 0;
        files.forEach(f => { dirSize += fs.statSync(path.join(dirPath, f)).size; });
        folderStats[dir] = { files: files.length, size: dirSize, sizeFormatted: formatBytes(dirSize) };
        totalSize += dirSize;
        totalFiles += files.length;
      } else {
        folderStats[dir] = { files: 0, size: 0, sizeFormatted: '0 Bytes' };
      }
    });

    res.json({
      success: true,
      data: {
        folders: folderStats,
        total: { files: totalFiles, size: totalSize, sizeFormatted: formatBytes(totalSize) },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get stats' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📸 Media server running on port ${PORT}`);
  console.log(`📁 Storage: ${STORAGE_DIR}`);
  console.log(`📂 Folders: ${FOLDERS.join(', ')}`);
  console.log(`🎬 Supported: images + videos (max 50MB)`);
});
