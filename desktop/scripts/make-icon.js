// Generate desktop/build/icon.ico from the university logo (frontend/public/uowa-logo-b.svg).
// The logo is a tall crest; we rasterize it crisply at each icon size, center it on a square
// transparent canvas with a small margin, and pack all sizes into one multi-resolution .ico.
//
// Run via `npm run icon` after changing the source logo. The produced icon.ico is committed, so a
// normal build does not need to re-run this.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const rootDir = path.join(__dirname, '..', '..');
const svgPath = path.join(rootDir, 'frontend', 'public', 'uowa-logo-b.svg');
const buildDir = path.join(__dirname, '..', 'build');
const outIco = path.join(buildDir, 'icon.ico');
const outPng = path.join(buildDir, 'icon.png'); // 256px preview / fallback

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const MARGIN = 0.86; // logo occupies this fraction of the canvas; the rest is padding

async function renderSize(svg, size) {
    const inner = Math.round(size * MARGIN);
    // Rasterize the SVG to fit within inner×inner (preserving aspect), on transparent ground…
    const logo = await sharp(svg, { density: 512 })
        .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    // …then center it on the full size×size transparent canvas.
    return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: logo, gravity: 'center' }])
        .png()
        .toBuffer();
}

(async () => {
    fs.mkdirSync(buildDir, { recursive: true });
    const svg = fs.readFileSync(svgPath);
    const pngs = await Promise.all(SIZES.map((s) => renderSize(svg, s)));
    fs.writeFileSync(outIco, await pngToIco(pngs));
    fs.writeFileSync(outPng, pngs[SIZES.indexOf(256)]);
    console.log(`✅  Wrote ${path.relative(rootDir, outIco)} (${SIZES.join(', ')} px) and icon.png`);
})();
