
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
console.log('THREE rev:', THREE.REVISION);
console.log('PMREMGenerator type:', typeof THREE.PMREMGenerator);
if (typeof THREE.PMREMGenerator === 'function') {
    const r = new THREE.WebGLRenderer({antialias:false});
    r.setSize(8,8);
    const pm = new THREE.PMREMGenerator(r);
    console.log('PMREMGenerator instance created OK');
    pm.dispose();
    r.dispose();
}
