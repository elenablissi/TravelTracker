import pg from "pg";

// Creating a new PostgreSQL client using database url
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

await db.connect();

export default db;
