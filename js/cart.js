// Panier local (sera remplacé par le backend)
function getCart() {
  return JSON.parse(localStorage.getItem('nidly_cart') || '[]');
}

function saveCart(cart) {
  localStorage.setItem('nidly_cart', JSON.stringify(cart));
  updateCartDisplay();
}

function updateCartDisplay() {
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + item.qty, 0);
  const cartBtn = document.querySelector('.nav-cart');
  if (cartBtn) cartBtn.innerHTML = `🛍 Panier (${total})`;
}
function addToCart(productId, name, price, qty, img = '') {
  const cart = getCart();
  const existing = cart.find(p => p.id == productId);
  if (existing) { existing.qty += qty; }
  else cart.push({ id: productId, name, price: parseInt(price), qty, img });
  saveCart(cart);
}

// Gestion des formulaires d'ajout au panier
document.querySelectorAll


('.add-form').forEach(form => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = form.dataset.productId;
    const name = form.dataset.productName;
    const price = form.dataset.productPrice;
    const qty = parseInt(form.querySelector('.qty-input').value) || 1;
    
    addToCart(id, name, price, qty);
    const btn = form.querySelector('.btn-add-cart');
    const orig = btn.textContent;
    btn.textContent = '✓ Ajouté !';
    btn.style.background = 'var(--sage)';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
  });
});

// Boutons + sur la page d'accueil
document.querySelectorAll('.product-add').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const card = btn.closest('.product-card');
    const name = card?.querySelector('.product-name')?.textContent;
    const price = card?.querySelector('.product-price')?.textContent?.replace(/\D/g, '');
    const idx = Array.from(document.querySelectorAll('.product-card')).indexOf(card) + 1;
    if (name && price) addToCart(idx, name, price, 1);
    btn.textContent = '✓';
    btn.style.background = 'var(--sage)';
    btn.style.borderColor = 'var(--sage)';
    btn.style.color = 'white';
    setTimeout(() => {
      btn.textContent = '+';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 1500);
  });
});
function removeFromCart(productId) {
  const cart = getCart().filter(p => p.id != productId);
  saveCart(cart);
  if (typeof renderCart === 'function') renderCart();
}
// Init au chargement
document.addEventListener('DOMContentLoaded', updateCartDisplay);
