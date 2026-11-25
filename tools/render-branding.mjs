// Render branding from the same GLB, materials and default outfit as the game.
// Run after updating the player model: node tools/render-branding.mjs
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve(import.meta.dirname, '..');
const server = createServer((req, res) => {
  if (req.url === '/branding') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>');
    return;
  }
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + sep) || !existsSync(path)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png' }[extname(path)] ?? 'application/octet-stream');
  res.end(readFileSync(path));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(origin + '/branding');
  const renders = await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    const { createMaterials, applyMaterials } = await import('/client/src/assets/materials.js');
    const { outfitVisible } = await import('/client/src/render/outfit.js');
    const { DEFAULT_AVATAR, WEAR } = await import('/shared/src/data/features.js');
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/client/public/models/characters/farmer.glb');
    applyMaterials(gltf.scene, createMaterials());
    const look = { ...DEFAULT_AVATAR, hat: 'straw' }; // Official hat shown in the Mihao reference.
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const visible = outfitVisible(o.name, look, WEAR);
      if (visible !== null) o.visible = visible;
      if (o.userData.defColor) { o.material = o.material.clone(); o.material.color.set(o.userData.defColor); }
      o.frustumCulled = false;
    });
    const idle = gltf.animations.find(c => c.name === 'idle');
    if (idle) { const mixer = new THREE.AnimationMixer(gltf.scene); mixer.clipAction(idle).play(); mixer.update(0.1); }
    const scene = new THREE.Scene();
    scene.add(gltf.scene, new THREE.HemisphereLight('#fff5df', '#c6bca8', 2.1));
    const key = new THREE.DirectionalLight('#fff2dc', 2.8); key.position.set(-3, 5, 6); scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 1); fill.position.set(4, 2, 3); scene.add(fill);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    function render(w, h, target, height) {
      renderer.setSize(w, h);
      const half = height / 2, aspect = w / h;
      const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, .01, 20);
      camera.position.set(0, target + .08, 5); camera.lookAt(0, target, 0);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png').split(',')[1];
    }
    const full = render(700, 900, 1.14, 2.6);
    const portrait = render(512, 512, 1.65, 1.45);
    renderer.dispose();
    return { full, portrait };
  });
  writeFileSync(resolve(root, 'client/public/icons/mihao.png'), Buffer.from(renders.full, 'base64'));
  writeFileSync(resolve(root, 'client/public/icons/mihao-portrait.png'), Buffer.from(renders.portrait, 'base64'));
  for (const file of ['logo.svg', 'favicon.svg']) {
    const path = resolve(root, 'client/public', file);
    const svg = readFileSync(path, 'utf8').replace(/<svg x="6"[\s\S]*?<\/svg>/, `<svg x="6" y="9" width="188" height="188" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${renders.portrait}"/></svg>`);
    writeFileSync(path, svg);
  }
  console.log('Updated loading artwork, portrait, logo and favicon from farmer.glb.');
} finally {
  await browser?.close();
  server.close();
}
