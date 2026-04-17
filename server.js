const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcrypt');
const supabase = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nidly-secret-change-en-prod';

// ─── Config Guepex ───
const GUEPEX_ID    = process.env.GUEPEX_API_ID;
const GUEPEX_TOKEN = process.env.GUEPEX_API_TOKEN;
const GUEPEX_URL   = 'https://api.guepex.app/v1';
const FROM_WILAYA_ID   = 6;    // Béjaïa
const FROM_WILAYA_NAME = 'Béjaïa';

function guepexHeaders() {
  return {
    'X-API-ID':     GUEPEX_ID,
    'X-API-TOKEN':  GUEPEX_TOKEN,
    'Content-Type': 'application/json',
  };
}

let ordersFallback = [];
let productsFallback = [];
let lotsFallback = [];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Helpers Supabase ───
async function getProducts() {
  if (supabase) {
    const { data, error } = await supabase.from('products').select('*').order('created_at');
    if (!error && data) {
      return data.map(p => ({
        id: p.id, name: p.name, price: p.price,
        desc: p.description, image_url: p.image_url, badge: p.badge
      }));
    }
  }
  return productsFallback;
}

async function getLots() {
  if (supabase) {
    const { data, error } = await supabase.from('product_lots').select('*').order('created_at');
    if (!error && data) {
      return data.map(l => ({
        id: l.id, name: l.name, price: l.price, tagline: l.tagline, slug: l.slug
      }));
    }
  }
  return lotsFallback;
}

async function getProductById(id) {
  if (supabase) {
    const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
    if (!error && data) {
      return {
        id: data.id, name: data.name, price: data.price,
        desc: data.description, image_url: data.image_url, badge: data.badge
      };
    }
  }
  return productsFallback.find(p => p.id === id);
}

async function getOrders() {
  if (supabase) {
    const { data, error } = await supabase
      .from('orders')
      .select(`*, wilayas:wilaya_id (nom)`)
      .order('created_at', { ascending: false });

    if (error) { console.error('Erreur getOrders:', error); return []; }

    const orders = await Promise.all((data || []).map(async (o) => {
      let commune_name = null;
      if (o.commune_id && supabase) {
        const { data: c } = await supabase
          .from('communes')
          .select('commune_name_ascii, commune_name')
          .eq('id', o.commune_id)
          .single();
        commune_name = c?.commune_name_ascii || c?.commune_name || null;
      }
      return {
        id: o.id, status: o.status, items: o.items,
        customer: { name: o.customer_name, phone: o.customer_phone, address: o.customer_address },
        wilaya_id: o.wilaya_id, commune_id: o.commune_id,
        wilaya_name: o.wilayas?.nom || null, commune_name,
        shipping_price: o.shipping_price, shipping_type: o.shipping_type,
        delivery_service: o.delivery_service,
        center_id: o.center_id, center_name: o.center_name,
        tracking_yalidine: o.tracking_yalidine,
        total_amount: o.total_amount, notes: o.notes, createdAt: o.created_at
      };
    }));
    return orders;
  }
  return ordersFallback.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function createOrder(orderData) {
  if (supabase) {
    const subtotal = orderData.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const shippingPrice = orderData.shipping_price || 0;
    const total = subtotal + shippingPrice;

    const { data, error } = await supabase.from('orders').insert({
      status: 'pending',
      customer_name:    orderData.customer.firstname + ' ' + orderData.customer.familyname,
      customer_phone:   orderData.customer.phone,
      customer_address: orderData.customer.address,
      wilaya_id:        orderData.wilaya_id || null,
      commune_id:       orderData.commune_id || null,
      shipping_price:   shippingPrice,
      shipping_type:    orderData.shipping_type || 'desk',
      delivery_service: orderData.delivery_service || 'economique',
      center_id:        orderData.center_id || null,
      center_name:      orderData.center_name || null,
      total_amount:     total,
      items:            orderData.items,
      notes:            orderData.notes || null
    }).select().single();

    if (!error && data) {
      return {
        id: data.id, status: data.status, items: data.items,
        customer: {
          firstname:  orderData.customer.firstname,
          familyname: orderData.customer.familyname,
          phone:      data.customer_phone,
          address:    data.customer_address
        },
        wilaya_id: data.wilaya_id, commune_id: data.commune_id,
        shipping_price: data.shipping_price, shipping_type: data.shipping_type,
        delivery_service: data.delivery_service,
        center_id: data.center_id, center_name: data.center_name,
        total_amount: data.total_amount, notes: data.notes,
        createdAt: data.created_at
      };
    }
    if (error) console.error('Erreur createOrder:', error);
  }

  const order = {
    id: 'ord-' + Date.now(), status: 'pending',
    items: orderData.items,
    customer: orderData.customer || { firstname: '', familyname: '', phone: '', address: '' },
    createdAt: new Date().toISOString()
  };
  ordersFallback.push(order);
  return order;
}

async function updateOrderStatus(orderId, status) {
  if (supabase) {
    const { data, error } = await supabase.from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId).select().single();
    if (!error && data) {
      return {
        id: data.id, status: data.status, items: data.items,
        customer: { name: data.customer_name, phone: data.customer_phone, address: data.customer_address },
        createdAt: data.created_at
      };
    }
    return null;
  }
  const order = ordersFallback.find(o => o.id === orderId);
  if (order) { order.status = status; return order; }
  return null;
}

// ─── Création colis Guepex ───
async function createGuepexParcel(order, wilayaName, communeName) {
  const isStopdesk  = order.shipping_type === 'desk';
  const isExpress   = order.delivery_service === 'express';
  const productList = order.items.map(i => `${i.name} x${i.qty}`).join(', ');

  const body = [{
    order_id:         String(order.id),
    from_wilaya_name: FROM_WILAYA_NAME,
    firstname:        order.customer.firstname  || order.customer.name || '',
    familyname:       order.customer.familyname || '',
    contact_phone:    order.customer.phone,
    address:          isStopdesk ? (order.center_name || 'Stop Desk') : (order.customer.address || 'Non précisée'),
    to_wilaya_name:   wilayaName,
    to_commune_name:  communeName || wilayaName,
    product_list:     productList,
    price:            order.total_amount,
    declared_value:   order.total_amount,
    weight:           1,
    length:           20,
    width:            15,
    height:           10,
    freeshipping:     false,
    is_stopdesk:      isStopdesk,
    ...(isStopdesk && order.center_id ? { stopdesk_id: order.center_id } : {}),
    is_express:       isExpress,
    has_exchange:     false,
    do_insurance:     false,
  }];

  const res = await fetch(`${GUEPEX_URL}/parcels/`, {
    method: 'POST',
    headers: guepexHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Guepex ${res.status}: ${errText}`);
  }

  return res.json();
}

// ─── API Wilayas & Communes (Supabase) ───
app.get('/api/wilayas', async (req, res) => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('wilayas').select('id, nom, nom_arabe').order('id');
      if (error) return res.status(500).json({ message: error.message });
      return res.json(data || []);
    } catch (err) { return res.status(500).json({ message: 'Erreur serveur' }); }
  }
  res.json([]);
});

app.get('/api/wilayas/:id/communes', async (req, res) => {
  if (supabase) {
    try {
      const wilayaId = req.params.id;
      const wilayaCode = String(wilayaId).padStart(2, '0');
      const { data, error } = await supabase
        .from('communes')
        .select('id, commune_name, commune_name_ascii, wilaya_code')
        .or(`wilaya_code.eq.${wilayaCode},wilaya_code.eq.${wilayaId}`)
        .order('commune_name_ascii');
      if (error) return res.status(500).json({ message: error.message });
      return res.json(data || []);
    } catch (err) { return res.status(500).json({ message: 'Erreur serveur' }); }
  }
  res.json([]);
});

// ─── API Guepex — Frais de livraison ───
// GET /api/guepex/fees?to_wilaya_id=16
app.get('/api/guepex/fees', async (req, res) => {
  const { to_wilaya_id } = req.query;
  if (!to_wilaya_id) return res.status(400).json({ message: 'to_wilaya_id requis' });

  try {
    const url = `${GUEPEX_URL}/deliveryfees/?from_wilaya_id=${FROM_WILAYA_ID}&to_wilaya_id=${to_wilaya_id}`;
    const r = await fetch(url, { headers: guepexHeaders() });
    const data = await r.json();
    // Retourne le premier résultat directement
    const fee = data?.data?.[0] || data?.[0] || null;
    res.json(fee || { desk_fee: 0, home_fee: 0, express_desk_fee: 0, express_home_fee: 0 });
  } catch (err) {
    console.error('Erreur fees Guepex:', err.message);
    res.status(500).json({ message: 'Erreur récupération frais' });
  }
});

// ─── API Guepex — Centres Stop Desk ───
// GET /api/guepex/centers?wilaya_id=16
app.get('/api/guepex/centers', async (req, res) => {
  const { wilaya_id } = req.query;
  if (!wilaya_id) return res.status(400).json({ message: 'wilaya_id requis' });

  try {
    const url = `${GUEPEX_URL}/centers/?wilaya_id=${wilaya_id}&page_size=100`;
    const r = await fetch(url, { headers: guepexHeaders() });
    const data = await r.json();
    res.json(data?.data || data || []);
  } catch (err) {
    console.error('Erreur centers Guepex:', err.message);
    res.status(500).json({ message: 'Erreur récupération centres' });
  }
});

// ─── API Produits ───
app.get('/api/products', async (req, res) => {
  try { res.json(await getProducts()); } catch { res.json(productsFallback); }
});
app.get('/api/lots', async (req, res) => {
  try { res.json(await getLots()); } catch { res.json(lotsFallback); }
});
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await getProductById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Produit introuvable' });
    res.json(product);
  } catch {
    const p = productsFallback.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ message: 'Produit introuvable' });
    res.json(p);
  }
});

// ─── API Auth Admin ───
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Email et mot de passe requis' });
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('admins').select('email, password_hash').eq('email', email).single();
      if (error || !data) return res.status(401).json({ message: 'Identifiants incorrects' });
      const isValid = await bcrypt.compare(password, data.password_hash);
      if (isValid) {
        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token });
      }
      return res.status(401).json({ message: 'Identifiants incorrects' });
    } catch { return res.status(500).json({ message: 'Erreur serveur' }); }
  }
  res.status(401).json({ message: 'Identifiants incorrects' });
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Token manquant' });
  try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ message: 'Token invalide' }); }
}

// ─── API Commandes (Admin) ───
app.get('/api/orders', authMiddleware, async (req, res) => {
  try { res.json(await getOrders()); }
  catch (err) { console.error('Erreur commandes:', err); res.json(ordersFallback); }
});

app.patch('/api/orders/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'shipped', 'delivered'].includes(status))
    return res.status(400).json({ message: 'Statut invalide' });
  try {
    const order = await updateOrderStatus(req.params.id, status);
    if (!order) return res.status(404).json({ message: 'Commande introuvable' });
    res.json(order);
  } catch { res.status(500).json({ message: 'Erreur serveur' }); }
});

// ─── API Création commande (Front) ───
app.post('/api/orders', async (req, res) => {
  const {
    items, customer, wilaya_id, commune_id,
    shipping_price, shipping_type, delivery_service,
    center_id, center_name, notes
  } = req.body || {};

  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ message: 'Panier vide' });
  if (!customer?.firstname || !customer?.phone)
    return res.status(400).json({ message: 'Informations client incomplètes' });

  try {
    // 1. Sauvegarder la commande en DB
    const order = await createOrder({
      items, customer, wilaya_id, commune_id,
      shipping_price, shipping_type, delivery_service,
      center_id, center_name, notes
    });

    // 2. Récupérer les noms wilaya + commune pour Guepex
    let wilayaName = '', communeName = '';
    if (supabase && wilaya_id) {
      const { data: w } = await supabase.from('wilayas').select('nom').eq('id', wilaya_id).single();
      wilayaName = w?.nom || '';
    }
    if (supabase && commune_id) {
      const { data: c } = await supabase.from('communes')
        .select('commune_name_ascii, commune_name').eq('id', commune_id).single();
      communeName = c?.commune_name_ascii || c?.commune_name || '';
    }

    // 3. Créer le colis sur Guepex
    try {
      const guepex = await createGuepexParcel(
        { ...order, center_id, center_name, delivery_service },
        wilayaName,
        communeName
      );
      console.log('✅ Guepex colis créé:', JSON.stringify(guepex));

      // 4. Sauvegarder le numéro de tracking
      const tracking = guepex?.data?.[0]?.tracking || guepex?.[0]?.tracking;
      if (tracking && supabase) {
        await supabase.from('orders')
          .update({ tracking_yalidine: tracking })
          .eq('id', order.id);
        console.log(`📦 Tracking Yalidine: ${tracking}`);
      }

      res.status(201).json({ ...order, tracking_yalidine: tracking || null });
    } catch (guepexErr) {
      // Commande créée mais colis Guepex échoué → on log et on répond quand même OK
      console.error('⚠️  Guepex échoué (commande OK):', guepexErr.message);
      res.status(201).json(order);
    }

  } catch (err) {
    console.error('Erreur création commande:', err);
    res.status(500).json({ message: 'Erreur lors de la création de la commande' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Nidly API sur http://localhost:${PORT}`);
  if (supabase) console.log('✅ Supabase connecté');
  else console.log('⚠️  Mode fallback');
  if (GUEPEX_ID) console.log('✅ Guepex configuré');
  else console.log('⚠️  GUEPEX_API_ID manquant dans .env');
});
