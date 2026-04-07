/**
 * db.js  –  Persistent SQLite database using sql.js (pure JavaScript).
 *
 * sql.js keeps the database in memory and we flush it to disk after
 * every write so data survives server restarts.
 */

const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, 'burgerblaze.db');

// We export a Promise that resolves to the db wrapper so server.js can await it.
let _db = null;

async function getDb() {
  if (_db) return _db;

  const SQL = await initSqlJs();

  // Load existing file or create new in-memory db
  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // ── Helper: save db to disk after every mutation ─────────────────────────────
  function persist() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  // ── Create tables ─────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id          INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      price       REAL    NOT NULL,
      description TEXT,
      emoji       TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      phone      TEXT    NOT NULL,
      address    TEXT    NOT NULL,
      payment    TEXT    NOT NULL DEFAULT 'Card',
      subtotal   REAL    NOT NULL,
      tax        REAL    NOT NULL,
      total      REAL    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'received',
      created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_id    INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      price      REAL    NOT NULL,
      quantity   INTEGER NOT NULL
    );
  `);

  // ── Seed menu (only if empty) ─────────────────────────────────────────────────
  const countRes = db.exec('SELECT COUNT(*) AS n FROM menu_items');
  const count    = countRes[0]?.values[0]?.[0] ?? 0;

  if (count === 0) {
    const items = [
      [1,  'Spicy Single Burger', 'burgers',  350, 'Single patty, cheddar, lettuce, tomatoes, onion rings', '🍔'],
      [2,  'Inferno Chicken',     'burgers',  150, 'Spicy crispy chicken, pickles, mayo',                   '🍗'],
      [3,  'Classic Cheese',      'burgers',  110, 'Beef patty, american cheese, lettuce, tomato',          '🧀'],
      [4,  'Veggie Delight',      'burgers',  120, 'Plant-based patty, avocado, sprouts',                   '🥬'],
      [5,  'Loaded Fries',        'sides',    700, 'Cheese, bacon, green onions, ranch',                    '🍟'],
      [6,  'Onion Rings',         'sides',    700, 'Crispy battered onions with dipping sauce',             '🧅'],
      [7,  'Mozzarella Sticks',   'sides',    650, '6 pieces with marinara sauce',                          '🧀'],
      [8,  'Side Salad',          'sides',    700, 'Fresh greens with house dressing',                      '🥗'],
      [9,  'Blaze Cola',          'drinks',   300, 'Large 32oz fountain drink',                             '🥤'],
      [10, 'Milkshake',           'drinks',   620, 'Vanilla, chocolate, or strawberry',                     '🥤'],
      [11, 'Iced Coffee',         'drinks',   400, 'Cold brew with cream and sugar',                        '☕'],
      [12, 'Lemonade',            'drinks',   400, 'Fresh squeezed lemonade',                               '🍋'],
      [13, 'Sundae',              'desserts', 540, 'Ice cream with toppings',                               '🍦'],
      [14, 'Apple Pie',           'desserts', 450, 'Warm apple pie with cinnamon',                          '🥧'],
      [15, 'Brownie',             'desserts', 400, 'Chocolate fudge brownie',                               '🍫'],
    ];

    items.forEach(([id, name, category, price, description, emoji]) => {
      db.run(
        'INSERT INTO menu_items (id, name, category, price, description, emoji) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, category, price, description, emoji]
      );
    });

    persist();
    console.log('✅ Menu seeded with 15 items.');
  }

  // ── Public API (mirrors the better-sqlite3 surface used in server.js) ─────────

  function all(sql, params = []) {
    const res = db.exec(sql, params);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  function get(sql, params = []) {
    return all(sql, params)[0] ?? null;
  }

  function run(sql, params = []) {
    db.run(sql, params);
    const lastId = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] ?? null;
    persist();
    return { lastInsertRowid: lastId };
  }

  // Transaction helper – runs fn() and persists once at the end
  function transaction(fn) {
    return () => {
      db.run('BEGIN');
      try {
        const result = fn();
        db.run('COMMIT');
        persist();
        return result;
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      }
    };
  }

  // Minimal .prepare() shim so server.js works without changes
  function prepare(sql) {
    return {
      all:  (params = []) => all(sql, params),
      get:  (params = []) => get(sql, params),
      run:  (...args)      => {
        // better-sqlite3 allows .run(p1, p2, ...) or .run([p1, p2])
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return run(sql, params);
      },
    };
  }

  _db = { all, get, run, transaction, prepare };
  return _db;
}

module.exports = { getDb };
