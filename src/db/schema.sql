-- Ensure UUID generation is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table (HomeRadar buyers/users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  preferences JSONB,  -- Budget, cities, features preferences
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;

-- Properties table (real listings)
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Info
  address VARCHAR(255) NOT NULL,
  postal_code VARCHAR(10),
  city VARCHAR(100),
  country VARCHAR(50) DEFAULT 'Denmark',
  
  -- Geographic
  latitude FLOAT,
  longitude FLOAT,
  
  -- Property Details
  price DECIMAL(12, 2),
  bedrooms INT,
  bathrooms DECIMAL(3, 1),
  sqm DECIMAL(8, 2),
  year_built INT,
  property_type VARCHAR(50),  -- 'apartment', 'house', 'villa', etc.
  
  -- Source Info
  source VARCHAR(50),  -- 'boiq', 'facebook', 'instagram', 'agent_portal'
  source_url TEXT,
  source_id VARCHAR(255),  -- External ID from source
  verified BOOLEAN DEFAULT FALSE,
  
  -- Images & Media
  images TEXT[],
  thumbnail_url TEXT,
  
  -- Metadata
  description TEXT,
  agent_name VARCHAR(100),
  agent_phone VARCHAR(20),
  agent_email VARCHAR(255),
  
  -- Timestamps
  listing_date DATE,
  sold_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Extra detail-page fields (lazily backfilled the first time a user opens a listing's details -
-- see enrichPropertyDetails in src/scrapers/boligsiden.ts) so users don't need to leave HomeRadar
-- to see energy rating, monthly expense, or lot size.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS energy_label VARCHAR(5);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS monthly_expense INT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lot_area INT;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_address ON properties (address);
CREATE INDEX IF NOT EXISTS idx_city ON properties (city);
CREATE INDEX IF NOT EXISTS idx_postal_code ON properties (postal_code);
CREATE INDEX IF NOT EXISTS idx_price ON properties (price);
CREATE INDEX IF NOT EXISTS idx_bedrooms ON properties (bedrooms);
CREATE INDEX IF NOT EXISTS idx_source ON properties (source);
CREATE INDEX IF NOT EXISTS idx_geo ON properties (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_created ON properties (created_at);
-- Composite index for the common "filter by city + budget + bedrooms" query pattern
CREATE INDEX IF NOT EXISTS idx_city_price_bedrooms ON properties (city, price, bedrooms);

-- Prevents the same source listing (e.g. a Boligsiden or agent-portal ID) from being inserted twice.
-- Multiple NULL source_ids are still allowed (Postgres treats NULLs as distinct in unique constraints).
ALTER TABLE properties ADD CONSTRAINT uq_properties_source_source_id UNIQUE (source, source_id);

-- Create GIS index for geographic queries (if PostGIS available)
-- CREATE INDEX idx_geo_point ON properties USING GIST (
--   ST_Point(longitude, latitude)
-- );

-- Saved properties (user favorites/watchlist)
CREATE TABLE IF NOT EXISTS saved_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE (user_id, property_id)
);

-- Property Updates Log (track changes)
CREATE TABLE IF NOT EXISTS property_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  field_changed VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Per-listing relevance feedback (👍/👎) with the user's free-text reason and the
-- scoring dimensions detected from it. IDs are TEXT (not FKs) because feedback can be
-- given on mock listings too; property_snapshot captures the listing's attributes at
-- feedback time so reasons can be correlated with what the property actually was.
CREATE TABLE IF NOT EXISTS property_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  property_id TEXT,
  relevant BOOLEAN NOT NULL,
  reason TEXT,
  signals TEXT[],
  property_snapshot JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON property_feedback (user_id, created_at);

-- Agent Portal (real estate agents)
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  company VARCHAR(255),
  verified BOOLEAN DEFAULT FALSE,
  password_hash VARCHAR(255),
  instagram_username VARCHAR(100),  -- Public IG Business/Creator handle, for Business Discovery lookups
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(100);

-- Agent Listings (pre-listing, early access)
CREATE TABLE IF NOT EXISTS agent_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  address VARCHAR(255) NOT NULL,
  city VARCHAR(100),
  price_estimate DECIMAL(12, 2),
  bedrooms INT,
  bathrooms DECIMAL(3, 1),
  sqm DECIMAL(8, 2),
  description TEXT,
  images TEXT[],
  status VARCHAR(50) DEFAULT 'coming_soon',  -- 'coming_soon', 'listed', 'sold'
  expected_listing_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications (in-app alerts for users)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_properties(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_property ON saved_properties(property_id);
CREATE INDEX IF NOT EXISTS idx_agents_email ON agents(email);
CREATE INDEX IF NOT EXISTS idx_agent_listings ON agent_listings(agent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
