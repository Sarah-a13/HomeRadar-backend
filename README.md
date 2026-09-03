# HomeRadar Backend - Full Stack Setup

Real estate intelligence backend with PostgreSQL database and Node.js/Express API server.

## 📋 Architecture

```
┌─────────────────────────────┐
│   React Frontend (GitHub)   │
│   (Real listing UI)         │
└──────────────┬──────────────┘
               │ API calls
┌──────────────▼──────────────┐
│  Express.js API Server      │
│  (Node.js - localhost:3001) │
└──────────────┬──────────────┘
               │ SQL queries
┌──────────────▼──────────────┐
│  PostgreSQL Database        │
│  (localhost:5432)           │
└─────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Docker & Docker Compose (for PostgreSQL)
- PostgreSQL 15 (or use Docker)

### 1. Setup Database (Local)

#### Option A: Docker (Recommended)
```bash
cd backend
docker-compose up -d
```

This starts:
- PostgreSQL on `localhost:5432`
- pgAdmin on `localhost:5050` (admin / admin)
- Automatically loads schema from `src/db/schema.sql`

#### Option B: Local PostgreSQL
```bash
# Create database
createdb homeradar

# Load schema
psql homeradar < src/db/schema.sql
```

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your database credentials:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=homeradar
PORT=3001
JWT_SECRET=your-secret-key
```

### 4. Load BoIQ Data

```bash
npm run scrape:boiq
```

This loads 76+ verified properties from BoIQ into your database.

### 5. Start Backend Server

```bash
npm run dev
```

Server starts on `http://localhost:3001`

**Test it:**
```bash
curl http://localhost:3001/health
# Response: {"status":"ok","timestamp":"2024-01-15T..."}
```

---

## 📡 API Endpoints

### Properties
- `GET /api/properties` - List all properties (with filters)
- `GET /api/properties/:id` - Get single property
- `POST /api/properties` - Create property (admin)
- `PUT /api/properties/:id` - Update property
- `GET /api/properties/source/:source` - Get by source (boiq, facebook, etc)

**Example:**
```bash
# Get all properties in Copenhagen under 4M DKK, 3+ bedrooms
curl "http://localhost:3001/api/properties?city=Copenhagen&max_price=4000000&bedrooms=3"
```

### Users
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - Login user
- `GET /api/users/profile` - Get user profile (requires token)
- `PUT /api/users/preferences` - Update preferences (requires token)

**Example:**
```bash
# Register
curl -X POST http://localhost:3001/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure123",
    "first_name": "John",
    "last_name": "Doe"
  }'
```

### Agents (Real Estate Partners)
- `POST /api/agents/register` - Register agent
- `POST /api/agents/login` - Login agent
- `POST /api/agents/listings` - Create "coming soon" listing
- `GET /api/agents/my-listings` - Get agent's listings
- `GET /api/agents/coming-soon` - Get all coming-soon listings

**Example:**
```bash
# Agent creates coming-soon listing
curl -X POST http://localhost:3001/api/agents/listings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "Nyhavn 50, Copenhagen",
    "city": "Copenhagen",
    "price_estimate": 5500000,
    "bedrooms": 3,
    "bathrooms": 2,
    "sqm": 150,
    "description": "Beautiful waterfront apartment",
    "expected_listing_date": "2024-02-01"
  }'
```

---

## 🗄️ Database Schema

### Main Tables

**properties** - All real estate listings
- id, address, city, price, bedrooms, bathrooms, sqm
- latitude, longitude (for geo-queries)
- source (boiq, facebook, instagram, agent_portal)
- verified (boolean)
- created_at, updated_at

**users** - HomeRadar platform users
- id, email, password_hash
- preferences (JSONB: budget, cities, features)
- created_at

**agents** - Real estate agent partners
- id, name, email, phone, company
- verified (boolean)
- created_at

**agent_listings** - "Coming soon" / early-access listings
- agent_id, address, city, price_estimate
- status (coming_soon, listed, sold)
- expected_listing_date
- created_at

**saved_properties** - User favorites/watchlist
- user_id, property_id, saved_at, notes

See `src/db/schema.sql` for full schema.

---

## 📊 Data Sources

### Currently Implemented
- ✅ **BoIQ** - Licensed verified property data (76+ properties)
- ✅ **Agent Portal** - Real estate agent submissions (coming soon)

### Planned
- 🔲 **Facebook Marketplace** - Headless browser scraping
- 🔲 **Instagram** - Hashtag monitoring + API integration
- 🔲 **Real estate websites** - Feed integration

### Data Loading
```bash
npm run scrape:boiq        # Load BoIQ data
npm run seed               # Seed test data (coming soon)
```

---

## 🔐 Authentication

JWT-based authentication for users and agents.

**Tokens:**
- Valid for 7 days
- Include in requests: `Authorization: Bearer <token>`
- Stored in browser localStorage (frontend)

**Endpoints requiring auth:**
- `GET /api/users/profile`
- `PUT /api/users/preferences`
- `POST /api/agents/listings`
- `GET /api/agents/my-listings`

---

## 🔧 Configuration

### Environment Variables
```
DB_HOST              Database host (localhost)
DB_PORT              Database port (5432)
DB_USER              Database user
DB_PASSWORD          Database password
DB_NAME              Database name
PORT                 Server port (3001)
NODE_ENV             development | production
JWT_SECRET           JWT signing secret
```

### Add to `.env` Later
```
BOIQ_API_KEY         BoIQ data API key
FACEBOOK_TOKEN       Facebook API token
INSTAGRAM_TOKEN      Instagram Graph API token
GOOGLE_MAPS_API_KEY  Google Maps geocoding
```

---

## 📦 Deployment

### Local Docker
```bash
docker-compose up
```

### Cloud Deployment

**Option A: Railway.app (Recommended - Free Tier)**
```bash
# Install railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway up
```

**Option B: Render.com (Free Tier)**
```bash
# Connect GitHub repo
# Select "Web Service"
# Build command: npm run build
# Start command: npm start
```

**Option C: Vercel with Serverless**
```bash
# Deploy as serverless functions (API routes)
# Configure database on Supabase
# Use Vercel env variables
```

### Database Hosting
- **Supabase** - Free PostgreSQL (5GB) + Auth
- **Railway** - Free PostgreSQL tier
- **Render** - Free PostgreSQL (5GB)

---

## 🧪 Testing

```bash
# Run tests (coming soon)
npm test

# Type checking
npx tsc --noEmit
```

---

## 📝 Next Steps

1. ✅ Backend scaffold created
2. 🔄 **Now**: Connect React frontend to API
3. 📊 Load BoIQ data into PostgreSQL
4. 🔐 Add authentication to React
5. 🎨 Update React UI to show real listings
6. 🚀 Deploy to production
7. 📱 Add Facebook/Instagram scrapers

---

## 🐛 Troubleshooting

**Port 5432 already in use:**
```bash
docker-compose down
# or kill process on port 5432
```

**Database connection error:**
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check logs
docker-compose logs postgres
```

**Cannot connect with psql:**
```bash
psql -h localhost -U postgres -d homeradar
```

---

## 📞 Support

- Database: See `src/db/schema.sql`
- API: See individual route files in `src/api/`
- Data: See scrapers in `src/scrapers/`

---

**Ready to connect the frontend?** 🚀
