import express, { Request, Response } from 'express';
import { pool } from '../server';
import { getAuthUser } from '../middleware/auth';
import { enrichPropertyDetails } from '../scrapers/boligsiden';

const router = express.Router();

// Columns callers are allowed to set via POST/PUT — prevents arbitrary column
// injection through unvalidated request body keys.
const WRITABLE_PROPERTY_FIELDS = new Set([
  'address', 'postal_code', 'city', 'country', 'latitude', 'longitude',
  'price', 'bedrooms', 'bathrooms', 'sqm', 'year_built', 'property_type',
  'source', 'source_url', 'source_id', 'verified', 'images', 'thumbnail_url',
  'description', 'agent_name', 'agent_phone', 'agent_email',
  'listing_date', 'sold_date', 'energy_label', 'monthly_expense', 'lot_area',
]);

// Mock properties for fallback when database unavailable
const mockProperties = [
  {
    id: 1,
    address: 'Strøget 10, Copenhagen',
    city: 'Copenhagen',
    price: 4500000,
    bedrooms: 3,
    bathrooms: 2,
    sqm: 125,
    source: 'boiq',
    verified: true,
    description: 'Beautiful apartment in central Copenhagen',
    created_at: new Date(),
  },
  {
    id: 2,
    address: 'Nyhavn 67, Copenhagen',
    city: 'Copenhagen',
    price: 6200000,
    bedrooms: 4,
    bathrooms: 2,
    sqm: 180,
    source: 'boiq',
    verified: true,
    description: 'Charming townhouse near Nyhavn',
    created_at: new Date(),
  },
  {
    id: 3,
    address: 'Østerbro Alle 42, Copenhagen',
    city: 'Copenhagen',
    price: 3800000,
    bedrooms: 3,
    bathrooms: 1,
    sqm: 110,
    source: 'boiq',
    verified: true,
    description: 'Spacious residence in Østerbro',
    created_at: new Date(),
  },
  {
    id: 4,
    address: 'Vestergade 5, Copenhagen',
    city: 'Copenhagen',
    price: 5100000,
    bedrooms: 4,
    bathrooms: 2,
    sqm: 145,
    source: 'facebook',
    verified: false,
    description: 'Facebook Marketplace listing',
    created_at: new Date(),
  },
  {
    id: 5,
    address: 'Frederiksstrand 2, Copenhagen',
    city: 'Copenhagen',
    price: 4200000,
    bedrooms: 3,
    bathrooms: 2,
    sqm: 132,
    source: 'instagram',
    verified: false,
    description: 'Instagram real estate post',
    created_at: new Date(),
  },
];

// GET all properties with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      city,
      min_price,
      max_price,
      bedrooms,
      source,
      verified,
      lat,
      lng,
      radius_km,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = 'SELECT * FROM properties WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Filters
    if (city) {
      query += ` AND city ILIKE $${paramIndex}`;
      params.push(`%${city}%`);
      paramIndex++;
    }

    if (min_price) {
      query += ` AND price >= $${paramIndex}`;
      params.push(min_price);
      paramIndex++;
    }

    if (max_price) {
      query += ` AND price <= $${paramIndex}`;
      params.push(max_price);
      paramIndex++;
    }

    if (bedrooms) {
      query += ` AND bedrooms >= $${paramIndex}`;
      params.push(bedrooms);
      paramIndex++;
    }

    if (source) {
      query += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    if (verified === 'true') {
      query += ` AND verified = true`;
    }

    // Geo-radius search (if PostGIS available)
    if (lat && lng && radius_km) {
      query += ` AND ST_Distance(
        ST_Point(longitude, latitude),
        ST_Point($${paramIndex}::float, $${paramIndex + 1}::float)
      ) / 1000 <= $${paramIndex + 2}::float`;
      params.push(lng, lat, radius_km);
      paramIndex += 3;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({
      total: result.rows.length,
      limit,
      offset,
      data: result.rows,
    });
  } catch (error) {
    console.warn('⚠️  Database unavailable, returning mock data');
    
    // Filter mock data based on query params
    let filtered = [...mockProperties];
    const { city, min_price, max_price, bedrooms, source, verified } = req.query;
    
    if (city) {
      filtered = filtered.filter(p => p.city.toLowerCase().includes(String(city).toLowerCase()));
    }
    if (min_price) {
      filtered = filtered.filter(p => p.price >= parseInt(String(min_price)));
    }
    if (max_price) {
      filtered = filtered.filter(p => p.price <= parseInt(String(max_price)));
    }
    if (bedrooms) {
      filtered = filtered.filter(p => p.bedrooms >= parseInt(String(bedrooms)));
    }
    if (source) {
      filtered = filtered.filter(p => p.source === source);
    }
    if (verified === 'true') {
      filtered = filtered.filter(p => p.verified === true);
    }
    
    const limit = parseInt(String(req.query.limit || 50));
    const offset = parseInt(String(req.query.offset || 0));
    
    res.json({
      total: filtered.length,
      limit,
      offset,
      data: filtered.slice(offset, offset + limit),
      message: '📊 Using mock data (database unavailable)',
    });
  }
});

// GET single property by ID - lazily enriches Boligsiden listings with full detail-page
// info (description, bathrooms, energy label, monthly expense, lot size, agent contact)
// the first time they're viewed, so users get everything without leaving HomeRadar.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let result = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      // Try mock data
      const mockProp = mockProperties.find(p => p.id === parseInt(id));
      if (mockProp) {
        return res.json(mockProp);
      }
      return res.status(404).json({ error: 'Property not found' });
    }

    let property = result.rows[0];
    if (property.source === 'boligsiden' && property.description === null && property.source_url) {
      try {
        await enrichPropertyDetails(property.id, property.source_url);
        result = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);
        property = result.rows[0];
      } catch (error: any) {
        console.error(`Failed to enrich property ${id}:`, error.message);
      }
    }

    res.json(property);
  } catch (error) {
    console.warn(`⚠️  Database unavailable, trying mock data for property ${req.params.id}`);
    
    // Fallback to mock data
    const mockProp = mockProperties.find(p => p.id === parseInt(req.params.id));
    if (mockProp) {
      return res.json(mockProp);
    }
    
    res.status(404).json({ error: 'Property not found' });
  }
});

// POST new property (internal use / admin) — requires auth
router.post('/', async (req: Request, res: Response) => {
  if (!getAuthUser(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const {
      address,
      postal_code,
      city,
      latitude,
      longitude,
      price,
      bedrooms,
      bathrooms,
      sqm,
      year_built,
      property_type,
      source,
      source_url,
      source_id,
      verified,
      images,
      description,
      agent_name,
      agent_email,
      listing_date,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO properties (
        address, postal_code, city, latitude, longitude, price,
        bedrooms, bathrooms, sqm, year_built, property_type,
        source, source_url, source_id, verified, images,
        description, agent_name, agent_email, listing_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *`,
      [
        address,
        postal_code,
        city,
        latitude,
        longitude,
        price,
        bedrooms,
        bathrooms,
        sqm,
        year_built,
        property_type,
        source,
        source_url,
        source_id,
        verified,
        images,
        description,
        agent_name,
        agent_email,
        listing_date,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(500).json({ error: 'Failed to create property' });
  }
});

// PUT update property — requires auth; only whitelisted columns can be set
router.put('/:id', async (req: Request, res: Response) => {
  if (!getAuthUser(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const { id } = req.params;
    const updates = req.body;

    const validKeys = Object.keys(updates).filter(key => WRITABLE_PROPERTY_FIELDS.has(key));
    if (validKeys.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Build dynamic update query from a whitelisted, parameterized set of columns only
    const setClause = validKeys
      .map((key, idx) => `${key} = $${idx + 2}`)
      .join(', ');

    const result = await pool.query(
      `UPDATE properties SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id, ...validKeys.map(key => updates[key])]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(500).json({ error: 'Failed to update property' });
  }
});

// GET properties by source (e.g., all BoIQ listings)
router.get('/source/:source', async (req: Request, res: Response) => {
  try {
    const { source } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      'SELECT * FROM properties WHERE source = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [source, limit, offset]
    );

    res.json({
      source,
      total: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching properties by source:', error);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

export default router;
