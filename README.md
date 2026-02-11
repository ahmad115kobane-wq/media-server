# Media Server - Sports Live App

سيرفر تخزين الوسائط للتطبيق. يستخدم Railway Persistent Volume للحفاظ على الملفات.

## Setup on Railway

1. Create new project on Railway
2. Deploy from GitHub repo
3. Add a **Volume** mounted at `/data`
4. Set environment variables:
   - `API_KEY` = your-secret-key
   - `PORT` = 4000
   - `STORAGE_DIR` = /data/uploads

## API Endpoints

### Upload Image
```
POST /upload
Headers: x-api-key: YOUR_API_KEY
Body (multipart/form-data):
  - image: file
  - folder: avatars|news|store|sliders|general
```

### Upload Multiple Images
```
POST /upload/multiple
Headers: x-api-key: YOUR_API_KEY
Body (multipart/form-data):
  - images: files (max 10)
  - folder: avatars|news|store|sliders|general
```

### Delete Image
```
DELETE /delete
Headers: x-api-key: YOUR_API_KEY
Body: { "imageUrl": "/uploads/folder/filename.webp" }
```

### Health Check
```
GET /health
```

### Storage Stats
```
GET /stats
Headers: x-api-key: YOUR_API_KEY
```
