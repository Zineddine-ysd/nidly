// Configuration API - Changez cette URL selon votre environnement
const API_URL = (() => {
  // Si on est en développement local
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  
  return 'https://nidly.onrender.com'; 
})();
