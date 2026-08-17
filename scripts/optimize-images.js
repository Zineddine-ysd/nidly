// Script ponctuel : recompresse les images de assets/ en place (même nom, même format,
// même chemin — donc aucune référence HTML à changer) pour réduire la bande passante Render.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIRS = [path.join(__dirname, '..', 'assets')];
const MAX_DIM = 1600;
const JPEG_QUALITY = 78;
const PNG_QUALITY = 80;

async function optimizeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const before = fs.statSync(filePath).size;
  const buf = fs.readFileSync(filePath);
  let img = sharp(buf, { failOn: 'none' });
  const meta = await img.metadata();

  if (meta.width && meta.width > MAX_DIM) {
    img = img.resize({ width: MAX_DIM, withoutEnlargement: true });
  }

  let outBuf;
  if (ext === '.jpg' || ext === '.jpeg') {
    outBuf = await img.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  } else if (ext === '.png') {
    // Convertit en JPEG seulement si pas de transparence réelle (évite de casser les
    // visuels produits en fond transparent) ; sinon recompresse le PNG en place.
    const hasAlpha = meta.hasAlpha;
    let alphaUsed = false;
    if (hasAlpha) {
      const stats = await sharp(buf).stats();
      alphaUsed = stats.isOpaque === false;
    }
    if (!alphaUsed) {
      outBuf = await img.flatten({ background: '#ffffff' }).png({ quality: PNG_QUALITY, compressionLevel: 9, palette: true }).toBuffer();
    } else {
      outBuf = await img.png({ quality: PNG_QUALITY, compressionLevel: 9, palette: true }).toBuffer();
    }
  } else if (ext === '.avif' || ext === '.webp') {
    outBuf = buf; // déjà un format moderne compressé, on ne touche pas
  } else {
    return null;
  }

  if (outBuf.length < before) {
    fs.writeFileSync(filePath, outBuf);
    return { file: filePath, before, after: outBuf.length };
  }
  return { file: filePath, before, after: before, skipped: true };
}

async function main() {
  const results = [];
  for (const dir of DIRS) {
    const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|avif|webp)$/i.test(f));
    for (const f of files) {
      const r = await optimizeFile(path.join(dir, f));
      if (r) results.push(r);
    }
  }
  let totalBefore = 0, totalAfter = 0;
  results.forEach(r => {
    totalBefore += r.before;
    totalAfter += r.after;
    const pct = r.before ? Math.round((1 - r.after / r.before) * 100) : 0;
    console.log(`${path.basename(r.file).padEnd(28)} ${(r.before/1024).toFixed(0).padStart(6)} KB -> ${(r.after/1024).toFixed(0).padStart(6)} KB  (-${pct}%)`);
  });
  console.log('---');
  console.log(`TOTAL: ${(totalBefore/1024/1024).toFixed(2)} MB -> ${(totalAfter/1024/1024).toFixed(2)} MB`);
}

main().catch(err => { console.error(err); process.exit(1); });
