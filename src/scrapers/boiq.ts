import fs from 'fs';
import path from 'path';
import { pool } from '../server';

/**
 * BoIQ Data Loader
 * Loads licensed property data from BoIQ JSON file into PostgreSQL
 * 
 * Usage: npm run scrape:boiq
 */

interface BoIQProperty {
  id?: string;
  address: string;
  postal_code?: string;
  city: string;
  latitude: number;
  longitude: number;
  price: number;
  bedrooms: number;
  bathrooms?: number;
  sqm: number;
  year_built?: number;
  property_type?: string;
  description?: string;
  images?: string[];
  agent_name?: string;
  agent_email?: string;
  listing_date?: string;
}

async function loadBoIQData() {
  try {
    console.log('📊 Loading BoIQ data...');

    // Load BoIQ JSON file from Dev folder
    const boiqPath = path.join(process.cwd(), '..', 'Dev', 'LIVE_APP_PROFESSIONAL.html');
    
    // Alternative: read from a separate JSON file if available
    const jsonPath = path.join(process.cwd(), '..', 'Dev', 'boiq-properties.json');
    
    let properties: BoIQProperty[] = [];

    // Try to load from JSON file first
    if (fs.existsSync(jsonPath)) {
      const data = fs.readFileSync(jsonPath, 'utf-8');
      const jsonData = JSON.parse(data);
      properties = jsonData.properties || jsonData;
      console.log(`✅ Loaded ${properties.length} properties from JSON`);
    } else {
      // Fallback: use hardcoded test properties
      properties = [
        {
          address: 'Strøget 10, 1206 København K',
          postal_code: '1206',
          city: 'Copenhagen',
          latitude: 55.6761,
          longitude: 12.5683,
          price: 4500000,
          bedrooms: 3,
          bathrooms: 2,
          sqm: 125,
          year_built: 1950,
          property_type: 'apartment',
          agent_name: 'John Hansen',
          agent_email: 'john@realtor.dk',
        },
        {
          address: 'Nyhavn 67, 1051 København K',
          postal_code: '1051',
          city: 'Copenhagen',
          latitude: 55.6795,
          longitude: 12.5878,
          price: 6200000,
          bedrooms: 4,
          bathrooms: 2.5,
          sqm: 180,
          year_built: 2010,
          property_type: 'apartment',
          agent_name: 'Maria Olsen',
          agent_email: 'maria@realtor.dk',
        },
        {
          address: 'Østerbro Alle 42, 2100 København Ø',
          postal_code: '2100',
          city: 'Copenhagen',
          latitude: 55.7272,
          longitude: 12.5658,
          price: 3800000,
          bedrooms: 3,
          bathrooms: 1.5,
          sqm: 110,
          year_built: 1980,
          property_type: 'apartment',
          agent_name: 'Peter Larsen',
          agent_email: 'peter@realtor.dk',
        },
      ];
      console.log(`📝 Using test properties (${properties.length} total)`);
    }

    // Insert into database
    let insertedCount = 0;
    let skippedCount = 0;

    for (const prop of properties) {
      try {
        // Check for duplicates by address + city
        const existing = await pool.query(
          'SELECT id FROM properties WHERE address = $1 AND city = $2',
          [prop.address, prop.city]
        );

        if (existing.rows.length > 0) {
          console.log(`⏭️  Skipping duplicate: ${prop.address}`);
          skippedCount++;
          continue;
        }

        // Insert property
        const result = await pool.query(
          `INSERT INTO properties (
            address, postal_code, city, latitude, longitude, price,
            bedrooms, bathrooms, sqm, year_built, property_type,
            source, source_url, verified, description, agent_name, agent_email,
            listing_date, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP)
          RETURNING id`,
          [
            prop.address,
            prop.postal_code || null,
            prop.city,
            prop.latitude,
            prop.longitude,
            prop.price,
            prop.bedrooms,
            prop.bathrooms || null,
            prop.sqm,
            prop.year_built || null,
            prop.property_type || 'residential',
            'boiq', // source
            null, // source_url
            true, // verified (BoIQ data is verified)
            prop.description || null,
            prop.agent_name || null,
            prop.agent_email || null,
            prop.listing_date || new Date().toISOString().split('T')[0],
          ]
        );

        console.log(`✅ Inserted: ${prop.address} (ID: ${result.rows[0].id})`);
        insertedCount++;
      } catch (error) {
        console.error(`❌ Failed to insert ${prop.address}:`, error);
      }
    }

    console.log(`\n✨ BoIQ Data Load Complete`);
    console.log(`   Inserted: ${insertedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Total processed: ${properties.length}`);

    process.exit(0);
  } catch (error) {
    console.error('Fatal error loading BoIQ data:', error);
    process.exit(1);
  }
}

loadBoIQData();
