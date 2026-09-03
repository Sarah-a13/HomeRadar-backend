-- Create database
CREATE DATABASE IF NOT EXISTS homeradar;

-- Users table (HomeRadar buyers/users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  preferences JSONB,  -- Budget, cities, features preferences
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  INDEX idx_address (address),
  INDEX idx_city (city),
  INDEX idx_postal_code (postal_code),
  INDEX idx_price (price),
  INDEX idx_bedrooms (bedrooms),
  INDEX idx_source (source),
  INDEX idx_geo (latitude, longitude),
  INDEX idx_created (created_at)
);

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

-- Agent Portal (real estate agents)
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  company VARCHAR(255),
  verified BOOLEAN DEFAULT FALSE,
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

-- Create indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_saved_user ON saved_properties(user_id);
CREATE INDEX idx_saved_property ON saved_properties(property_id);
CREATE INDEX idx_agents_email ON agents(email);
CREATE INDEX idx_agent_listings ON agent_listings(agent_id);
