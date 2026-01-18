const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const SCHEMA = require('./schema');

class DatabaseManager {
  constructor(config) {
    this.config = config;
    this.db = null;
    this.dbPath = path.resolve(config.path);
  }

  /**
   * Initialize database connection and run migrations
   */
  async initialize() {
    try {
      // Ensure data directory exists
      const dbDir = path.dirname(this.dbPath);

      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log(`Created database directory: ${dbDir}`);
      }

      // Initialize SQL.js
      const SQL = await initSqlJs();

      // Load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(buffer);
        console.log(`Database loaded from: ${this.dbPath}`);
      } else {
        this.db = new SQL.Database();
        console.log(`New database created at: ${this.dbPath}`);
      }

      // Run migrations
      this.runMigrations();

      // Save database
      this.save();

      return this.db;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Run database migrations (create tables and indexes)
   */
  runMigrations() {
    try {
      console.log('Running database migrations...');

      // Create tables
      Object.entries(SCHEMA.tables).forEach(([name, sql]) => {
        this.db.run(sql);
        console.log(`  ✓ Table: ${name}`);
      });

      // Create indexes
      Object.entries(SCHEMA.indexes).forEach(([name, sql]) => {
        this.db.run(sql);
        console.log(`  ✓ Index: ${name}`);
      });

      console.log('Database migrations completed');
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  /**
   * Save database to file
   */
  save() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  /**
   * Get database instance
   */
  getDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.save();
      this.db.close();
      console.log('Database connection closed');
    }
  }
}

module.exports = DatabaseManager;
