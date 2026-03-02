# Backend Quick Start Guide

**Ready in 3 minutes** ⚡

---

## Prerequisites

- Node.js 20.x or higher
- PostgreSQL database
- npm or yarn

---

## 1. Install Dependencies

```bash
cd deploy/backend
npm install
```

**Result**: 449 packages installed (~20 seconds)

---

## 2. Configure Environment

```bash
cp .env.example .env
nano .env  # or use your favorite editor
```

**Minimum required variables**:

```bash
# Database (REQUIRED)
DATABASE_URL=postgresql://user:password@host:5432/keykurs

# JWT Secret (REQUIRED)
JWT_SECRET=your-random-secret-key-change-this

# Server
PORT=3000
NODE_ENV=development
```

**Optional (for full functionality)**:

```bash
# S3 Storage (for media)
S3_ENDPOINT=https://s3.timeweb.cloud
S3_REGION=ru-1
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=keykurs-media

# OAuth (VK)
VK_CLIENT_ID=your-vk-app-id
VK_CLIENT_SECRET=your-vk-secret

# OAuth (Yandex)
YANDEX_CLIENT_ID=your-yandex-id
YANDEX_CLIENT_SECRET=your-yandex-secret

# OAuth Redirect
OAUTH_REDIRECT_BASE=http://localhost:5173
```

---

## 3. Build TypeScript

```bash
npm run build
```

**Expected output**:
```
> keykurs-backend@1.0.0 build
> tsc

✅ Compilation successful (2 seconds)
```

**Generated files**: 48 files in `dist/` directory

---

## 4. Run the Server

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

**Expected output**:
```
[INFO] Server running on port 3000
[INFO] Database connected
[INFO] Winston logger initialized
```

---

## 5. Verify Installation

Test the health endpoint:

```bash
curl http://localhost:3000/
```

**Expected response**:
```json
{
  "message": "KeyKurs Backend API",
  "version": "1.0.0",
  "status": "running"
}
```

---

## API Endpoints

**Base URL**: `http://localhost:3000`

### Public Endpoints

```bash
# Health check
GET /

# Telegram login
POST /api/auth/telegram
```

### Protected Endpoints (require JWT token)

**Header**: `Authorization: Bearer <token>`

```bash
# Courses
GET    /api/courses
POST   /api/courses
GET    /api/courses/:id
PUT    /api/courses/:id
DELETE /api/courses/:id

# Posts
GET    /api/posts/course/:courseId
POST   /api/posts
PUT    /api/posts/:id
DELETE /api/posts/:id

# Media
POST   /api/media/upload
GET    /api/media/:path(*)

# Admin (admin role required)
GET    /api/admin/sellers
GET    /api/admin/users
POST   /api/admin/admin-link
```

Full API documentation: See `BUILD_REPORT.md`

---

## Troubleshooting

### Issue: `Cannot find module 'express'`

**Solution**:
```bash
npm install
```

### Issue: `Database connection failed`

**Solution**:
1. Check `DATABASE_URL` in `.env`
2. Verify PostgreSQL is running
3. Test connection:
   ```bash
   psql $DATABASE_URL
   ```

### Issue: `Port 3000 already in use`

**Solution**:
1. Change `PORT` in `.env` to `3001` (or any available port)
2. Or kill existing process:
   ```bash
   lsof -ti:3000 | xargs kill -9
   ```

### Issue: `JWT_SECRET not configured`

**Solution**:
```bash
# Generate a random secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to .env
JWT_SECRET=<generated-secret>
```

---

## Development Tips

### Watch Mode (auto-reload)

```bash
npm run dev
# Uses ts-node-dev for automatic TypeScript compilation
```

### Check Logs

```bash
tail -f logs/combined.log  # All logs
tail -f logs/error.log     # Errors only
```

### Database Queries

```bash
# Connect to database
psql $DATABASE_URL

# List tables
\dt

# Check users
SELECT * FROM users LIMIT 10;
```

### Testing Authentication

```bash
# Get JWT token (after Telegram login)
curl -X POST http://localhost:3000/api/auth/telegram \
  -H "Content-Type: application/json" \
  -d '{"telegram_id": 123456, "first_name": "Test"}'

# Use token in requests
curl http://localhost:3000/api/courses \
  -H "Authorization: Bearer <token>"
```

---

## Project Structure

```
deploy/backend/
├── src/
│   ├── index.ts              # Main entry point
│   ├── middleware/
│   │   └── auth.ts           # JWT authentication
│   ├── routes/               # 10 route files
│   │   ├── admin.ts
│   │   ├── ads.ts
│   │   ├── auth.ts
│   │   ├── courses.ts
│   │   ├── featured.ts
│   │   ├── media.ts
│   │   ├── oauth.ts
│   │   ├── posts.ts
│   │   ├── stats.ts
│   │   └── telegram.ts
│   └── utils/                # Utilities
│       ├── db.ts            # Database pool
│       ├── jwt.ts           # JWT helpers
│       ├── logger.ts        # Winston logger
│       └── telegram.ts      # Telegram API
├── dist/                     # Built JavaScript (generated)
├── logs/                     # Log files (generated)
├── .env                      # Environment variables
├── .env.example             # Example environment
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
└── Dockerfile               # Docker build
```

---

## Production Deployment

### Docker

```bash
# Build image
docker build -t keykurs-backend .

# Run container
docker run -d \
  --name keykurs-backend \
  -p 3000:3000 \
  --env-file .env \
  keykurs-backend

# Check logs
docker logs -f keykurs-backend
```

### Docker Compose

```bash
docker-compose up -d
docker-compose logs -f
```

### Manual Deployment

```bash
# On production server
git pull
npm install
npm run build
NODE_ENV=production npm start
```

### PM2 (Process Manager)

```bash
npm install -g pm2
pm2 start dist/index.js --name keykurs-backend
pm2 logs keykurs-backend
pm2 restart keykurs-backend
```

---

## Performance Tuning

### PostgreSQL Connection Pool

Edit `src/utils/db.ts`:

```typescript
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,              // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Winston Logging Level

Edit `.env`:

```bash
LOG_LEVEL=info  # Options: error, warn, info, http, debug
```

### File Upload Limits

Edit `src/routes/media.ts`:

```typescript
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});
```

---

## Security Checklist

Before production:

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Set `NODE_ENV=production`
- [ ] Configure CORS origins (edit `src/index.ts`)
- [ ] Enable HTTPS
- [ ] Configure firewall rules
- [ ] Set up database backups
- [ ] Enable rate limiting (optional)
- [ ] Configure CSP headers (optional)
- [ ] Set up monitoring (optional)

---

## Next Steps

1. ✅ Backend running locally
2. Set up database schema (run migrations from main project)
3. Configure frontend to use `http://localhost:3000`
4. Test Telegram bot integration
5. Set up OAuth providers (VK/Yandex)
6. Deploy to production server

---

## Support

- **Documentation**: See `BUILD_REPORT.md` for detailed info
- **API Routes**: 40+ endpoints documented in build report
- **Issues**: Check logs in `logs/` directory
- **Database**: Verify schema in main project `supabase/migrations/`

---

**Status**: ✅ Ready to run
**Build Time**: ~2 seconds
**Startup Time**: ~1 second
**Dependencies**: 449 packages
**Output Size**: ~101 KB (JavaScript)

Happy coding! 🚀
