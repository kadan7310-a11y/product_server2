require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("Missing API_KEY in .env  (run: npm run genkey)");
  process.exit(1);
}

const DB_FILE = path.join(__dirname, "data", "products.json");

// ---------- tiny JSON-file database ----------
function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}
function writeDb(items) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2));
}

// ---------- app ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- API key middleware ----------
function requireApiKey(req, res, next) {
  const provided = req.get("x-api-key") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(API_KEY);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: "Invalid or missing API key" });
  next();
}

// ---------- validation ----------
function validate(body, partial = false) {
  const errors = [];
  const { name, price, stock, category, description } = body;

  if (!partial || name !== undefined) {
    if (typeof name !== "string" || !name.trim()) errors.push("name is required");
  }
  if (!partial || price !== undefined) {
    if (typeof price !== "number" || !(price >= 0)) errors.push("price must be a number >= 0");
  }
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
    errors.push("stock must be a whole number >= 0");
  }
  if (category !== undefined && typeof category !== "string") errors.push("category must be text");
  if (description !== undefined && typeof description !== "string") errors.push("description must be text");
  return errors;
}

function clean(body) {
  const out = {};
  if (body.name !== undefined) out.name = body.name.trim();
  if (body.price !== undefined) out.price = body.price;
  if (body.stock !== undefined) out.stock = body.stock;
  if (body.category !== undefined) out.category = body.category.trim();
  if (body.description !== undefined) out.description = body.description.trim();
  return out;
}

// ---------- routes ----------
const api = express.Router();
api.use(requireApiKey);

// List (supports ?q=search&category=x)
api.get("/products", (req, res) => {
  let items = readDb();
  const { q, category } = req.query;
  if (q) {
    const s = String(q).toLowerCase();
    items = items.filter(
      (p) => p.name.toLowerCase().includes(s) || (p.description || "").toLowerCase().includes(s)
    );
  }
  if (category) items = items.filter((p) => p.category === category);
  res.json(items);
});

// Get one
api.get("/products/:id", (req, res) => {
  const item = readDb().find((p) => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Product not found" });
  res.json(item);
});

// Create
api.post("/products", (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });

  const now = new Date().toISOString();
  const product = {
    id: crypto.randomUUID(),
    stock: 0,
    category: "",
    description: "",
    ...clean(req.body),
    createdAt: now,
    updatedAt: now,
  };
  const items = readDb();
  items.unshift(product);
  writeDb(items);
  res.status(201).json(product);
});

// Update
api.put("/products/:id", (req, res) => {
  const errors = validate(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });

  const items = readDb();
  const i = items.findIndex((p) => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Product not found" });

  items[i] = { ...items[i], ...clean(req.body), updatedAt: new Date().toISOString() };
  writeDb(items);
  res.json(items[i]);
});

// Delete
api.delete("/products/:id", (req, res) => {
  const items = readDb();
  const i = items.findIndex((p) => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Product not found" });
  const [removed] = items.splice(i, 1);
  writeDb(items);
  res.json(removed);
});

app.use("/api", api);

// 404 for unknown API paths, generic error handler
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => console.log(`Product server running at http://localhost:${PORT}`));
