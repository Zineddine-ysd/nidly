const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcrypt');
const https = require('https');
const supabase = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nidly-secret-change-en-prod';

// ─── Config Yalidine ───────────────────────────────────────────────────────────
const YALIDINE_API_ID    = process.env.YALIDINE_API_ID    || '';
const YALIDINE_API_TOKEN = process.env.YALIDINE_API_TOKEN || '';
const YALIDINE_BASE_URL  = 'https://api.guepex.app/v1';
const YALIDINE_FROM_WILAYA = process.env.YALIDINE_FROM_WILAYA || 'Sétif'; // Wilaya expéditeur

let ordersFallback = [];
let productsFallback = [];
let lotsFallback = [];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Helper Yalidine (fetch via https natif) ────────────────────────────────
function yalidineRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(YALIDINE_BASE_URL + endpoint);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'X-API-ID': YALIDINE_API_ID,
        'X-API-TOKEN': YALIDINE_API_TOKEN,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Helpers Supabase ───────────────────────────────────────────────────────
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
      return { id: data.id, name: data.name, price: data.price, desc: data.description, image_url: data.image_url, badge: data.badge };
    }
  }
  return productsFallback.find(p => p.id === id);
}

async function getOrders() {
  if (supabase) {
    // Simple select — wilaya_name et commune_name sont maintenant des colonnes directes
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) { console.error('Erreur getOrders:', error); return []; }

    return (data || []).map(o => ({
      id: o.id,
      status: o.status,
      items: o.items,
      customer: { name: o.customer_name, phone: o.customer_phone, address: o.customer_address },
      wilaya_id:    o.wilaya_id,
      commune_id:   o.commune_id,
      wilaya_name:  o.wilaya_name  || null,
      commune_name: o.commune_name || null,
      stopdesk_id:   o.stopdesk_id   || null,
      stopdesk_name: o.stopdesk_name || null,
      shipping_price:  o.shipping_price,
      shipping_type:   o.shipping_type,
      total_amount:    o.total_amount,
      notes:           o.notes,
      yalidine_tracking:  o.yalidine_tracking  || null,
      yalidine_label:     o.yalidine_label     || null,
      yalidine_import_id: o.yalidine_import_id || null,
      yalidine_status:    o.yalidine_status    || null,
      createdAt: o.created_at
    }));
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
      customer_name:    orderData.customer.name,
      customer_phone:   orderData.customer.phone,
      customer_address: orderData.customer.address,
      wilaya_id:        orderData.wilaya_id    || null,
      commune_id:       orderData.commune_id   || null,
      wilaya_name:      orderData.wilaya_name  || null,
      commune_name:     orderData.commune_name || null,
      stopdesk_id:      orderData.stopdesk_id  || null,
      stopdesk_name:    orderData.stopdesk_name|| null,
      shipping_price:   shippingPrice,
      shipping_type:    orderData.shipping_type || 'desk',
      total_amount:     total,
      items:            orderData.items,
      notes:            orderData.notes        || null
    }).select().single();

    if (!error && data) {
      return {
        id: data.id, status: data.status, items: data.items,
        customer: { name: data.customer_name, phone: data.customer_phone, address: data.customer_address },
        wilaya_id: data.wilaya_id, commune_id: data.commune_id,
        shipping_price: data.shipping_price, shipping_type: data.shipping_type,
        total_amount: data.total_amount, notes: data.notes, createdAt: data.created_at
      };
    }
    if (error) console.error('Erreur createOrder:', error);
  }

  const order = {
    id: 'ord-' + Date.now(), status: 'pending',
    items: orderData.items,
    customer: orderData.customer || { name: '', phone: '', address: '' },
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

// ─── API Wilayas & Communes → supprimés, utiliser /api/yalidine/wilayas et /api/yalidine/communes/:id

// ─── API Produits ───────────────────────────────────────────────────────────
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

// ─── API Auth Admin ─────────────────────────────────────────────────────────
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

// ─── API Commandes (Admin) ──────────────────────────────────────────────────
app.get('/api/orders', authMiddleware, async (req, res) => {
  try { res.json(await getOrders()); }
  catch (err) { console.error('Erreur commandes:', err); res.json(ordersFallback); }
});

app.patch('/api/orders/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Statut invalide' });
  try {
    const order = await updateOrderStatus(req.params.id, status);
    if (!order) return res.status(404).json({ message: 'Commande introuvable' });
    res.json(order);
  } catch { res.status(500).json({ message: 'Erreur serveur' }); }
});

app.delete('/api/orders/:id', authMiddleware, async (req, res) => {
  if (supabase) {
    const { error } = await supabase.from('orders').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ message: error.message });
    return res.json({ deleted: true });
  }
  const idx = ordersFallback.findIndex(o => o.id === req.params.id);
  if (idx > -1) { ordersFallback.splice(idx, 1); return res.json({ deleted: true }); }
  res.status(404).json({ message: 'Introuvable' });
});

// ─── API Création commande (Front) ──────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
  const { items, customer, wilaya_id, commune_id, wilaya_name, commune_name, stopdesk_id, stopdesk_name, shipping_price, shipping_type, notes } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Panier vide' });
  }
  try {
    const order = await createOrder({ items, customer, wilaya_id, commune_id, wilaya_name, commune_name, stopdesk_id, stopdesk_name, shipping_price, shipping_type, notes });
    res.status(201).json(order);
  } catch (err) {
    console.error('Erreur création commande:', err);
    res.status(500).json({ message: 'Erreur lors de la création de la commande' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// ─── API Yalidine ─────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/yalidine/wilayas — liste des wilayas Yalidine
app.get('/api/yalidine/wilayas', async (req, res) => {
  try {
    const result = await yalidineRequest('GET', '/wilayas/');
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ message: 'Erreur connexion Yalidine', error: err.message });
  }
});

// GET /api/yalidine/communes/:wilaya_id — communes Yalidine
app.get('/api/yalidine/communes/:wilaya_id', async (req, res) => {
  try {
    const result = await yalidineRequest('GET', `/communes/?wilaya_id=${req.params.wilaya_id}`);
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ message: 'Erreur connexion Yalidine', error: err.message });
  }
});

// GET /api/yalidine/centers — centres stop desk
app.get('/api/yalidine/centers', async (req, res) => {
  const wilaya_id = req.query.wilaya_id || '';
  const endpoint = wilaya_id ? `/centers/?wilaya_id=${wilaya_id}` : '/centers/';
  try {
    const result = await yalidineRequest('GET', endpoint);
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ message: 'Erreur connexion Yalidine', error: err.message });
  }
});

// GET /api/yalidine/fees — tarifs entre wilayas
app.get('/api/yalidine/fees', async (req, res) => {
  const { from_wilaya_id, to_wilaya_id } = req.query;
  if (!from_wilaya_id || !to_wilaya_id) {
    return res.status(400).json({ message: 'from_wilaya_id et to_wilaya_id requis' });
  }
  try {
    const result = await yalidineRequest('GET', `/fees/?from_wilaya_id=${from_wilaya_id}&to_wilaya_id=${to_wilaya_id}`);
    res.status(result.status).json(result.body);
  } catch (err) {
    res.status(500).json({ message: 'Erreur connexion Yalidine', error: err.message });
  }
});

// POST /api/orders/:id/yalidine — envoyer une commande à Yalidine
app.post('/api/orders/:id/yalidine', authMiddleware, async (req, res) => {
  if (!YALIDINE_API_ID || !YALIDINE_API_TOKEN) {
    return res.status(503).json({ message: 'Yalidine non configuré (YALIDINE_API_ID / YALIDINE_API_TOKEN manquants)' });
  }

  // Récupérer la commande
  let order = null;
  if (supabase) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ message: 'Commande introuvable' });

    order = {
      ...data,
      wilaya_name:  data.wilaya_name  || null,
      commune_name: data.commune_name || null,
      customer: { name: data.customer_name, phone: data.customer_phone, address: data.customer_address }
    };
  } else {
    order = ordersFallback.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ message: 'Commande introuvable' });
  }

  if (order.yalidine_tracking) {
    return res.status(409).json({ message: 'Déjà envoyé à Yalidine', tracking: order.yalidine_tracking });
  }

  // Préparer les paramètres de la commande Yalidine
  const nameParts = (order.customer.name || '').trim().split(/\s+/);
  const firstname  = nameParts[0] || 'Client';
  const familyname = nameParts.slice(1).join(' ') || '-';

  // Récupérer les overrides depuis le body (ex: is_stopdesk, stopdesk_id, freeshipping)
  const {
    is_stopdesk    = order.shipping_type !== 'maison',
    stopdesk_id    = req.body.stopdesk_id || order.stopdesk_id || null,
    freeshipping   = false,
    declared_value = order.total_amount || 0,
    do_insurance   = true,
    has_exchange   = false,
    product_to_collect = null,
    to_commune_name = order.commune_name,
    to_wilaya_name  = order.wilaya_name,
    length = 0, width = 0, height = 0, weight = 0
  } = req.body;

  const productList = (order.items || []).map(i => `${i.name} x${i.qty}`).join(', ') || 'Produit';
const price = (order.total_amount || 0) - (order.shipping_price || 0);
  // Solution A : si stop desk, récupérer commune/wilaya exactes du bureau depuis Yalidine
  // Evite l'erreur "stopdesk_id does not belong to to_commune_name"
  let finalCommuneName = to_commune_name || '';
  let finalWilayaName  = to_wilaya_name  || '';
  if (is_stopdesk && stopdesk_id) {
    try {
      const centerRes = await yalidineRequest('GET', `/centers/${stopdesk_id}`);
      if (centerRes.body?.commune_name) {
        finalCommuneName = centerRes.body.commune_name;
        finalWilayaName  = centerRes.body.wilaya_name || finalWilayaName;
        console.log('Commune corrigée depuis bureau:', finalCommuneName, finalWilayaName);
      }
    } catch (e) {
      console.warn('Impossible de récupérer la commune du bureau:', e.message);
    }
  }

  const parcelPayload = [{
    order_id:          String(order.id).slice(0, 64),
    from_wilaya_name:  YALIDINE_FROM_WILAYA,
    firstname,
    familyname,
    contact_phone:     order.customer.phone || '',
    address:           order.customer.address || '',
    to_commune_name:   finalCommuneName,
    to_wilaya_name:    finalWilayaName,
    product_list:      productList,
    price,
    do_insurance,
    declared_value:    declared_value || price,
    length,
    width,
    height,
    weight,
    freeshipping,
    is_stopdesk,
    ...(is_stopdesk && stopdesk_id ? { stopdesk_id } : {}),
    has_exchange,
    ...(has_exchange ? { product_to_collect } : {})
  }];

  try {
    const result = await yalidineRequest('POST', '/parcels/', parcelPayload);
    const responseBody = result.body;

    // Extraire le résultat pour cet order_id
    const orderId = String(order.id).slice(0, 64);
    const parcelResult = responseBody[orderId] || Object.values(responseBody)[0];

    if (!parcelResult || !parcelResult.success) {
      return res.status(400).json({
        message: parcelResult?.message || 'Erreur Yalidine lors de la création du colis',
        yalidine_response: responseBody
      });
    }

    // Sauvegarder le tracking en BDD
    const tracking   = parcelResult.tracking;
    const label      = parcelResult.label;
    const import_id  = parcelResult.import_id;

    if (supabase) {
      await supabase.from('orders').update({
        yalidine_tracking:  tracking,
        yalidine_label:     label,
        yalidine_import_id: import_id,
        yalidine_status:    'En préparation',
        status:             'shipped',
        updated_at:         new Date().toISOString()
      }).eq('id', req.params.id);
    } else {
      const o = ordersFallback.find(x => x.id === req.params.id);
      if (o) { o.yalidine_tracking = tracking; o.yalidine_label = label; o.status = 'shipped'; }
    }

    res.json({ success: true, tracking, label, import_id, labels: parcelResult.labels });
  } catch (err) {
    console.error('Erreur Yalidine:', err);
    res.status(500).json({ message: 'Erreur connexion Yalidine', error: err.message });
  }
});

// GET /api/orders/:id/yalidine/status — rafraîchir le statut depuis Yalidine
app.get('/api/orders/:id/yalidine/status', authMiddleware, async (req, res) => {
  let tracking = null;
  if (supabase) {
    const { data } = await supabase.from('orders').select('yalidine_tracking').eq('id', req.params.id).single();
    tracking = data?.yalidine_tracking;
  }
  if (!tracking) return res.status(404).json({ message: 'Pas de tracking Yalidine pour cette commande' });

  try {
    const result = await yalidineRequest('GET', `/parcels/${tracking}`);
    const parcel = result.body;
    const newStatus = parcel.last_status || null;

    if (supabase && newStatus) {
      await supabase.from('orders').update({ yalidine_status: newStatus }).eq('id', req.params.id);
    }

    res.json({ tracking, last_status: newStatus, parcel });
  } catch (err) {
    res.status(500).json({ message: 'Erreur Yalidine', error: err.message });
  }
});

// DELETE /api/orders/:id/yalidine — supprimer le colis Yalidine (si en préparation)
app.delete('/api/orders/:id/yalidine', authMiddleware, async (req, res) => {
  let tracking = null;
  if (supabase) {
    const { data } = await supabase.from('orders').select('yalidine_tracking').eq('id', req.params.id).single();
    tracking = data?.yalidine_tracking;
  }
  if (!tracking) return res.status(404).json({ message: 'Pas de tracking Yalidine pour cette commande' });

  try {
    const result = await yalidineRequest('DELETE', `/parcels/${tracking}`);
    if (result.status === 200) {
      if (supabase) {
        await supabase.from('orders').update({
          yalidine_tracking: null, yalidine_label: null,
          yalidine_import_id: null, yalidine_status: null
        }).eq('id', req.params.id);
      }
      res.json({ deleted: true, tracking });
    } else {
      res.status(400).json({ message: 'Impossible de supprimer sur Yalidine', response: result.body });
    }
  } catch (err) {
    res.status(500).json({ message: 'Erreur Yalidine', error: err.message });
  }
});

// ─── Config endpoint (pour vérifier si Yalidine est configuré) ───────────────
app.get('/api/config', authMiddleware, (req, res) => {
  res.json({
    yalidine_configured: !!(YALIDINE_API_ID && YALIDINE_API_TOKEN),
    yalidine_from_wilaya: YALIDINE_FROM_WILAYA
  });
});

app.listen(PORT, () => {
  console.log(`✅ Nidly API sur http://localhost:${PORT}`);
  if (supabase) console.log('✅ Supabase connecté');
  else console.log('⚠️  Mode fallback (pas de Supabase)');
  if (YALIDINE_API_ID) console.log(`✅ Yalidine configuré (from: ${YALIDINE_FROM_WILAYA})`);
  else console.log('⚠️  Yalidine non configuré (ajoutez YALIDINE_API_ID et YALIDINE_API_TOKEN dans .env)');
});
