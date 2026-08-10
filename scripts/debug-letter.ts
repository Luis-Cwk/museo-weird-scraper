// Debug voxel sculpture: just renders the letter "O"
import fs from "fs";
import path from "path";

const cellSize = 0.4;
const depth = 5;

// Reuse the same building blocks
// Inline copy of just what we need
const charW = 5, charH = 7;
const text = "HOLA";

const glyphs5x7 = {
  "H": ["1...1", "1...1", "1...1", "11111", "1...1", "1...1", "1...1"],
  "O": [".111.", "1...1", "1...1", "1...1", "1...1", "1...1", ".111."],
  "L": ["1....", "1....", "1....", "1....", "1....", "1....", "11111"],
  "A": ["..1..", ".1.1.", "1...1", "11111", "1...1", "1...1", "1...1"],
};

const pixels: { x: number; y: number }[] = [];
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  const glyph = (glyphs5x7 as Record<string, string[]>)[ch];
  for (let row = 0; row < charH; row++) {
    for (let col = 0; col < charW; col++) {
      if (glyph[row][col] === "1") {
        pixels.push({ x: i * (charW + 1) + col, y: row });
      }
    }
  }
}

const voxelWidth = text.length * (charW + 1);
const voxelHeight = charH;
const centerX = -voxelWidth * cellSize * 0.5;
const centerY = voxelHeight * cellSize * 0.5;  // positive
const voxelCount = pixels.length * depth;

// Inline HTML
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>debug-HOLA</title>
<style>html,body{margin:0;padding:0;background:#0a0a0a;overflow:hidden}canvas{display:block}</style>
</head><body>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
const PIXELS = ${JSON.stringify(pixels)};
const LAYOUT = { cellSize: ${cellSize}, depth: ${depth}, centerX: ${centerX}, centerY: ${centerY}, voxelCount: ${voxelCount} };
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0a0a');
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 6);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.PointLight(0xffffff, 2, 0, 0));
camera.add(new THREE.AmbientLight(0x404040, 1));
scene.add(camera);
const voxelGeom = new THREE.BoxGeometry(LAYOUT.cellSize, LAYOUT.cellSize, LAYOUT.cellSize);
const voxelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff7a1a'), roughness: 0.3, metalness: 0.7 });
const voxelMesh = new THREE.InstancedMesh(voxelGeom, voxelMat, LAYOUT.voxelCount);
const m = new THREE.Matrix4();
let i = 0;
for (const p of PIXELS) {
  for (let d = 0; d < LAYOUT.depth; d++) {
    if (i >= LAYOUT.voxelCount) break;
    m.makeTranslation(
      LAYOUT.centerX + p.x * LAYOUT.cellSize,
      LAYOUT.centerY - p.y * LAYOUT.cellSize,
      (d - LAYOUT.depth / 2) * LAYOUT.cellSize,
    );
    voxelMesh.setMatrixAt(i++, m);
  }
}
voxelMesh.count = i;
scene.add(voxelMesh);
window.__scene = scene;
window.__camera = camera;
function loop() {
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
</script>
</body></html>`;

const out = path.join(__dirname, "..", "data", "artworks", "debug-O.html");
fs.writeFileSync(out, html);
console.log('wrote', out);
