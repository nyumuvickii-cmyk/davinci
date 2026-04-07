const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { getDb } = require('./db');

const app  = express();
const PORT = 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve the frontend (index.html + any static assets) from the same folder
app.use(express.static(path.join(__dirname)));

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET  /api/menu  — return all menu items
app.get('/api/menu', async (req, res) => {
  try {
    const db    = await getDb();
    const items = db.prepare('SELECT * FROM menu_items ORDER BY category, id').all();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET  /api/orders  — return all orders (newest first)
app.get('/api/orders', async (req, res) => {
  try {
    const db     = await getDb();
    const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
    const result = orders.map(order => ({
      ...order,
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all([order.id])
    }));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/orders  — place a new order
app.post('/api/orders', async (req, res) => {
  const { name, phone, address, payment, items } = req.body;

  if (!name || !phone || !address || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    const db       = await getDb();
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const tax      = parseFloat((subtotal * 0.08).toFixed(2));
    const total    = parseFloat((subtotal + tax).toFixed(2));

    const placeOrder = db.transaction(() => {
      const { lastInsertRowid: orderId } = db.prepare(
        'INSERT INTO orders (name, phone, address, payment, subtotal, tax, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(name, phone, address, payment || 'Card', subtotal, tax, total);

      items.forEach(i =>
        db.prepare(
          'INSERT INTO order_items (order_id, menu_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)'
        ).run([orderId, i.id, i.name, i.price, i.quantity])
      );

      return orderId;
    });

    const orderId = placeOrder();
    res.status(201).json({ success: true, orderId, message: 'Order placed successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET  /api/orders/:id  — get a single order
app.get('/api/orders/:id', async (req, res) => {
  try {
    const db    = await getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get([req.params.id]);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all([order.id]);
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/orders/:id/status  — update order status
app.patch('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['received', 'preparing', 'ready', 'delivered'];
  if (!valid.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  }
  try {
    const db = await getDb();
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true, message: 'Status updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Catch-all: serve index.html for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────────
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🔥 BurgerBlaze backend running!`);
    console.log(`   Frontend : http://localhost:${PORT}`);
    console.log(`   API Base : http://localhost:${PORT}/api\n`);
  });
}).catch(err => {
  console.error('❌ Failed to initialise database:', err);
  process.exit(1);
});
