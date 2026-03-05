const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcrypt');
const supabase = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nidly-secret-change-en-prod';

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
        id: p.id,
        name: p.name,
        price: p.price,
        desc: p.description,
        image_url: p.image_url,
        badge: p.badge
      }));
    }
  }
  return productsFallback;
}
// ─── Helpers Supabase ───
async function getLots() {
  if (supabase) {
    const { data, error } = await supabase.from('product_lots').select('*').order('created_at');
    if (!error && data) {
      return data.map(l => ({
        id: l.id,
        name: l.name,
        price: l.price,
        tagline: l.tagline,
        slug: l.slug
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
        id: data.id,
        name: data.name,
        price: data.price,
        desc: data.description,
        image_url: data.image_url,
        badge: data.badge
      };
    }
  }
  return productsFallback.find(p => p.id === id);
}

async function getOrders() {
  if (supabase) {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        wilayas:wilaya_id (nom),
        communes:commune_id (nom)
      `)
      .order('created_at', { ascending: false });
    if (!error && data) {
      return data.map(o => ({
        id: o.id,
        status: o.status,
        items: o.items,
        customer: {
          name: o.customer_name,
          phone: o.customer_phone,
          address: o.customer_address
        },
        wilaya_id: o.wilaya_id,
        commune_id: o.commune_id,
        wilaya_name: o.wilayas?.nom,
        commune_name: o.communes?.nom,
        shipping_price: o.shipping_price,
        shipping_type: o.shipping_type,
        total_amount: o.total_amount,
        notes: o.notes,
        createdAt: o.created_at
      }));
    }
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
      customer_name: orderData.customer.name,
      customer_phone: orderData.customer.phone,
      customer_address: orderData.customer.address,
      wilaya_id: orderData.wilaya_id || null,
      commune_id: orderData.commune_id || null,
      shipping_price: shippingPrice,
      shipping_type: orderData.shipping_type || 'desk',
      total_amount: total,
      items: orderData.items,
      notes: orderData.notes || null
    }).select().single();
    
    if (!error && data) {
      return {
        id: data.id,
        status: data.status,
        items: data.items,
        customer: {
          name: data.customer_name,
          phone: data.customer_phone,
          address: data.customer_address
        },
        wilaya_id: data.wilaya_id,
        commune_id: data.commune_id,
        shipping_price: data.shipping_price,
        shipping_type: data.shipping_type,
        total_amount: data.total_amount,
        notes: data.notes,
        createdAt: data.created_at
      };
    }
  }
  
  // Fallback
  const order = {
    id: 'ord-' + Date.now(),
    status: 'pending',
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
      .eq('id', orderId)
      .select()
      .single();
    
    if (!error && data) {
      return {
        id: data.id,
        status: data.status,
        items: data.items,
        customer: {
          name: data.customer_name,
          phone: data.customer_phone,
          address: data.customer_address
        },
        createdAt: data.created_at
      };
    }
    return null;
  }
  
  // Fallback
  const order = ordersFallback.find(o => o.id === orderId);
  if (order) {
    order.status = status;
    return order;
  }
  return null;
}
// ─── API Wilayas & Communes ───
app.get('/api/wilayas', async (req, res) => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('wilayas')
        .select('id, nom, nom_arabe, prix_desk, prix_maison')
        .order('id');  // order par id (numéro wilaya) plutôt que nom

      if (error) {
        console.error('Supabase wilayas error:', error);
        return res.status(500).json({ message: error.message });
      }
      return res.json(data || []);
    } catch (err) {
      console.error('Erreur wilayas:', err);
      return res.status(500).json({ message: 'Erreur serveur' });
    }
  }
  res.json([]);
});

app.get('/api/wilayas/:id/communes', async (req, res) => {
  if (supabase) {
    try {
      const wilayaId = req.params.id; // ex: "6"
      const wilayaCode = String(wilayaId).padStart(2, '0'); // ex: "06"

      // Ta table communes utilise wilaya_code (ex: '06') pas wilaya_id
      const { data, error } = await supabase
        .from('communes')
        .select('id, commune_name, commune_name_ascii, wilaya_code')
        .or(`wilaya_code.eq.${wilayaCode},wilaya_code.eq.${wilayaId}`)
        .order('commune_name_ascii');

      if (error) {
        console.error('Supabase communes error:', error);
        return res.status(500).json({ message: error.message });
      }
      return res.json(data || []);
    } catch (err) {
      console.error('Erreur communes:', err);
      return res.status(500).json({ message: 'Erreur serveur' });
    }
  }
  res.json([]);
});








// ─── API Produits ───
app.get('/api/products', async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (err) {
    console.error('Erreur produits:', err);
    res.json(productsFallback);
  }
});

app.get('/api/lots', async (req, res) => {
  try {
    const lots = await getLots();
    res.json(lots);
  } catch (err) {
    console.error('Erreur lots:', err);
    res.json(lotsFallback);
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await getProductById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Produit introuvable' });
    res.json(product);
  } catch (err) {
    console.error('Erreur produit:', err);
    const p = productsFallback.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ message: 'Produit introuvable' });
    res.json(p);
  }
});

// ─── API Auth Admin ───
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  
  if (!email || !password) {
    return res.status(400).json({ message: 'Email et mot de passe requis' });
  }

  // Vérifier dans Supabase si configuré
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('admins')
        .select('email, password_hash')
        .eq('email', email)
        .single();

      if (error || !data) {
        return res.status(401).json({ message: 'Identifiants incorrects' });
      }

      // Vérifier le mot de passe avec bcrypt
      const isValid = await bcrypt.compare(password, data.password_hash);
      if (isValid) {
        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token });
      } else {
        return res.status(401).json({ message: 'Identifiants incorrects' });
      }
    } catch (err) {
      console.error('Erreur authentification:', err);
      return res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Fallback si Supabase non configuré
  if (email === adminUserFallback.email && password === adminUserFallback.password) {
    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  }
  
  res.status(401).json({ message: 'Identifiants incorrects' });
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant' });
  }
  try {
    const token = auth.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token invalide' });
  }
}

// ─── API Commandes (Admin) ───
app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await getOrders();
    res.json(orders);
  } catch (err) {
    console.error('Erreur commandes:', err);
    res.json(ordersFallback);
  }
});

app.patch('/api/orders/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'shipped', 'delivered'].includes(status)) {
    return res.status(400).json({ message: 'Statut invalide' });
  }
  
  try {
    const order = await updateOrderStatus(req.params.id, status);
    if (!order) return res.status(404).json({ message: 'Commande introuvable' });
    res.json(order);
  } catch (err) {
    console.error('Erreur mise à jour:', err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ─── API Création commande (Front) ───
app.post('/api/orders', async (req, res) => {
  const { items, customer, wilaya_id, commune_id, shipping_price, shipping_type, notes } = req.body || {};
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Panier vide' });
  }
  
  try {
    const order = await createOrder({ 
      items, 
      customer, 
      wilaya_id, 
      commune_id, 
      shipping_price, 
      shipping_type, 
      notes 
    });
    res.status(201).json(order);
  } catch (err) {
    console.error('Erreur création commande:', err);
    res.status(500).json({ message: 'Erreur lors de la création de la commande' });
  }
});


app.listen(PORT, () => {
  console.log(`Nidly API démarrée sur http://localhost:${PORT}`);

  if (supabase) {
    console.log('✅ Supabase connecté');
  } else {
    console.log('⚠️  Mode fallback (données en mémoire) - Configurez Supabase pour la persistance');
  }

});
