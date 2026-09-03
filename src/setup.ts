#!/usr/bin/env node
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Setup script for HomeRadar PostgreSQL database on Supabase
 * Runs: Schema creation + BoIQ data loading
 */

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  // SSL/TLS for Supabase
  ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

async function setupDatabase() {
  try {
    console.log('🚀 HomeRadar Database Setup');
    console.log(`📡 Connecting to Supabase: ${process.env.DB_HOST}`);
    
    // Test connection
    const testRes = await pool.query('SELECT NOW()');
    console.log('✅ Connected to database');

    // Read schema file
    const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    console.log('📊 Creating tables...');
    
    // Split by semicolons and execute each statement
    const statements = schema.split(';').filter(s => s.trim().length > 0);
    
    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (error: any) {
        // Ignore "already exists" errors
        if (!error.message.includes('already exists')) {
          console.warn('Warning:', error.message);
        }
      }
    }

    console.log('✅ Database schema ready');

    // Load BoIQ data
    console.log('📥 Loading BoIQ property data...');
    
    const boiqProperties = [
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
        listing_date: new Date().toISOString().split('T')[0],
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
        listing_date: new Date().toISOString().split('T')[0],
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
        listing_date: new Date().toISOString().split('T')[0],
      },
      {
        address: 'Vestergade 5, 1456 København V',
        postal_code: '1456',
        city: 'Copenhagen',
        latitude: 55.6659,
        longitude: 12.5469,
        price: 5100000,
        bedrooms: 4,
        bathrooms: 2,
        sqm: 145,
        year_built: 2005,
        property_type: 'apartment',
        agent_name: 'Anna Sørensen',
        agent_email: 'anna@realtor.dk',
        listing_date: new Date().toISOString().split('T')[0],
      },
      {
        address: 'Frederiksstrand 2, 2100 København Ø',
        postal_code: '2100',
        city: 'Copenhagen',
        latitude: 55.7195,
        longitude: 12.5892,
        price: 7200000,
        bedrooms: 5,
        bathrooms: 3,
        sqm: 220,
        year_built: 1995,
        property_type: 'house',
        agent_name: 'Thomas Nielsen',
        agent_email: 'thomas@realtor.dk',
        listing_date: new Date().toISOString().split('T')[0],
      },
    ];

    let inserted = 0;
    for (const prop of boiqProperties) {
      try {
        const existing = await pool.query(
          'SELECT id FROM properties WHERE address = $1 AND city = $2',
          [prop.address, prop.city]
        );

        if (existing.rows.length > 0) {
          console.log(`⏭️  Skipped: ${prop.address} (duplicate)`);
          continue;
        }

        await pool.query(
          `INSERT INTO properties (
            address, postal_code, city, latitude, longitude, price,
            bedrooms, bathrooms, sqm, year_built, property_type,
            source, verified, agent_name, agent_email, listing_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            prop.address,
            prop.postal_code,
            prop.city,
            prop.latitude,
            prop.longitude,
            prop.price,
            prop.bedrooms,
            prop.bathrooms,
            prop.sqm,
            prop.year_built,
            prop.property_type,
            'boiq',
            true,
            prop.agent_name,
            prop.agent_email,
            prop.listing_date,
          ]
        );
        inserted++;
        console.log(`✅ Loaded: ${prop.address}`);
      } catch (error) {
        console.error(`❌ Failed to insert ${prop.address}:`, error);
      }
    }

    console.log(`\n✨ Setup Complete!`);
    console.log(`   Properties loaded: ${inserted}/${boiqProperties.length}`);
    console.log(`   Database: ${process.env.DB_HOST}`);
    console.log(`   API Port: ${process.env.PORT || 3001}`);

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
