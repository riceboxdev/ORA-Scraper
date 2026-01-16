# ORA Image Scraper Service

A Dockerized image scraping service with web admin UI for the ORA platform.

## Quick Start

### Prerequisites
- Node.js 20+
- Firebase project with Firestore and Storage
- API keys (optional): Unsplash, Reddit

### Local Development

```bash
cd scraper-service

# Install dependencies
npm install

# Create .env from template
cp .env.example .env
# Edit .env with your Firebase project ID and API keys

# Add Firebase credentials
# Download from Firebase Console > Project Settings > Service Accounts
cp path/to/serviceAccountKey.json firebase-credentials.json

# Start development server
npm run dev
```

Open http://localhost:3000 for the admin UI.

## Dokploy Deployment

### 1. Push to Git
Ensure your `scraper-service/` directory is committed to your repo.

### 2. Create Service in Dokploy
1. Go to Dokploy dashboard
2. Create new **Application**
3. Connect your Git repository
4. Set **Build Path**: `scraper-service`
5. Set **Dockerfile Path**: `scraper-service/Dockerfile`

### 3. Configure Environment Variables
In Dokploy > Application > Environment:

```
FIREBASE_PROJECT_ID=your-project-id
UNSPLASH_ACCESS_KEY=your-key
REDDIT_CLIENT_ID=your-id
REDDIT_CLIENT_SECRET=your-secret
```

### 4. Add Firebase Credentials
Upload `firebase-credentials.json` via Dokploy file manager or mount as a volume.

### 5. Mount Data Volume
In Dokploy > Volumes, add:
- **Container Path**: `/app/data`
- **Host Path**: `/opt/ora-scraper/data`

### 6. Deploy
Click Deploy. The service will be available at your configured domain.

## Configuration

### Schedule Settings (via UI)
- **Batch Size**: Images per scrape run (1-100)
- **Interval**: Hours between runs (1-24)
- **Enabled**: Turn scraping on/off

### Source Types
- **Unsplash**: Search query (e.g., "interior design")
- **Reddit**: Subreddit name (e.g., "RoomPorn")
- **URL**: Website to scrape (e.g., "https://example.com")

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sources` | GET | List all sources |
| `/api/sources` | POST | Create source |
| `/api/sources/:id` | PUT | Update source |
| `/api/sources/:id` | DELETE | Delete source |
| `/api/sources/settings/schedule` | GET/PUT | Schedule config |
| `/api/jobs/run` | POST | Trigger manual run |
| `/api/jobs/status` | GET | Current status |
| `/api/jobs/stats` | GET | Today's statistics |
| `/health` | GET | Health check |

## Cloud Functions

Deploy the updated `index.ts` to enable AI quality analysis:

```bash
cd ORA/functions
npm run deploy
```

This adds the `analyzeImageQuality` function used by the scraper.
