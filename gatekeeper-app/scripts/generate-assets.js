const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function main() {
  const srcPath = path.join(__dirname, '..', 'assets', 'source', 'gatekeeper-logo.png');
  const img = sharp(srcPath);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;

  // 1. BFS for ticketCore from center (405, 370) with th = 32
  const ticketCore = new Uint8Array(w * h);
  const queue = [370 * w + 405];
  ticketCore[370 * w + 405] = 1;
  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const neighbors = [curr - 1, curr + 1, curr - w, curr + w];
    for (const n of neighbors) {
      if (n >= 0 && n < w * h && !ticketCore[n]) {
        const nx = n % w;
        const ny = Math.floor(n / w);
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const idx = n * 4;
          const b = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (b > 32) {
            ticketCore[n] = 1;
            queue.push(n);
          }
        }
      }
    }
  }

  // 2. Fill all holes inside ticketCore
  const outside = new Uint8Array(w * h);
  const oQueue = [0];
  outside[0] = 1;
  let oHead = 0;
  while (oHead < oQueue.length) {
    const curr = oQueue[oHead++];
    const neighbors = [curr - 1, curr + 1, curr - w, curr + w];
    for (const n of neighbors) {
      if (n >= 0 && n < w * h && !outside[n] && !ticketCore[n]) {
        outside[n] = 1;
        oQueue.push(n);
      }
    }
  }

  const ticketSolid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!outside[i]) ticketSolid[i] = 1;
  }

  // 3. Distance transform from ticketSolid
  const dist = new Float32Array(w * h).fill(999);
  const dQueue = [];
  for (let i = 0; i < w * h; i++) {
    if (ticketSolid[i]) {
      dist[i] = 0;
      dQueue.push(i);
    }
  }
  let dHead = 0;
  while (dHead < dQueue.length) {
    const curr = dQueue[dHead++];
    const cd = dist[curr];
    if (cd >= 30) continue;
    const neighbors = [curr - 1, curr + 1, curr - w, curr + w];
    for (const n of neighbors) {
      if (n >= 0 && n < w * h) {
        if (dist[n] > cd + 1) {
          dist[n] = cd + 1;
          dQueue.push(n);
        }
      }
    }
  }

  // 4. Extract cleanly on black #000000
  const isolated = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = dist[i];
      let factor = 0;
      if (d <= 14) {
        factor = 1.0;
      } else if (d < 26) {
        const t = (d - 14) / (26 - 14);
        factor = 0.5 * (1 + Math.cos(t * Math.PI));
      }
      if (y < 105) {
        if (y <= 85) factor = 0;
        else factor *= (y - 85) / 20;
      }
      if (x > 645) {
        if (x >= 660) factor = 0;
        else factor *= (660 - x) / 15;
      }
      const idx = i * 4;
      isolated[idx] = Math.round(data[idx] * factor);
      isolated[idx + 1] = Math.round(data[idx + 1] * factor);
      isolated[idx + 2] = Math.round(data[idx + 2] * factor);
      isolated[idx + 3] = 255;
    }
  }

  // Crop square around center cx=398, cy=344 of size 520x520
  const cropSize = 520;
  const cropLeft = 138;
  const cropTop = 84;
  const croppedPng = await sharp(isolated, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: cropLeft, top: cropTop, width: cropSize, height: cropSize })
    .png()
    .toBuffer();

  // Helper to place cropped artwork on a black square canvas
  async function makeCanvas(canvasSize, artSize) {
    const resizedArt = await sharp(croppedPng)
      .resize(artSize, artSize, { fit: 'contain' })
      .toBuffer();

    const offset = Math.round((canvasSize - artSize) / 2);
    return sharp({
      create: {
        width: canvasSize,
        height: canvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      }
    })
      .composite([{ input: resizedArt, left: offset, top: offset }])
      .png()
      .toBuffer();
  }

  const assetsDir = path.join(__dirname, '..', 'assets');

  // 1. icon.png: 1024x1024, filling ~75% width (768px)
  const iconBuf = await makeCanvas(1024, 768);
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconBuf);
  console.log('assets/icon.png: ' + iconBuf.length + ' bytes');

  // 2. adaptive-icon.png: 1024x1024, inside central 66% (676px)
  const adaptiveBuf = await makeCanvas(1024, 676);
  fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), adaptiveBuf);
  console.log('assets/adaptive-icon.png: ' + adaptiveBuf.length + ' bytes');

  // 3. splash-icon.png: 1024x1024 on black
  const splashBuf = await makeCanvas(1024, 768);
  fs.writeFileSync(path.join(assetsDir, 'splash-icon.png'), splashBuf);
  console.log('assets/splash-icon.png: ' + splashBuf.length + ' bytes');

  // 4. favicon.png: 48x48
  const favBuf = await makeCanvas(48, 44);
  fs.writeFileSync(path.join(assetsDir, 'favicon.png'), favBuf);
  console.log('assets/favicon.png: ' + favBuf.length + ' bytes');

  // 5. logo.png: 256x256
  const logoBuf = await makeCanvas(256, 240);
  fs.writeFileSync(path.join(assetsDir, 'logo.png'), logoBuf);
  console.log('assets/logo.png: ' + logoBuf.length + ' bytes');

  console.log('All assets generated successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
