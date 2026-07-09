// Stylised toon look shared by every mesh in the game:
//  - MeshToonMaterial with a hard 3-step gradient ramp
//  - fresnel rim light injected into the toon shader
//  - inverted-hull outlines (works on SkinnedMesh too — the outline shell
//    shares the skeleton so it deforms with the body)
//  - cheap blob shadows (radial-gradient sprite), no shadow maps on mobile
import * as THREE from "three";

// Ashima 3D simplex noise — a compact, dependency-free gradient ("Perlin-family")
// noise used to drive the death dissolve. Shared verbatim by the body and the
// outline shell so a fragment dissolves from both at the exact same threshold.
const NOISE_GLSL = `
  vec4 _permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 _taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = _permute(_permute(_permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = _taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }`;

// Injects the dissolve varying into a vertex shader: object-space position so
// the noise pattern is glued to the mesh surface (stable while the body
// ragdolls / skins). `scale` widens the pattern for larger creatures.
function injectDissolveVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vDissolvePos;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDissolvePos = position;");
}

let _ramp = null;
export function toonRamp() {
  if (_ramp) return _ramp;
  // 3 bands + a bright top step: dark / mid / light / highlight
  const data = new Uint8Array([90, 90, 90, 255, 160, 160, 160, 255, 235, 235, 235, 255, 255, 255, 255, 255]);
  _ramp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  _ramp.minFilter = THREE.NearestFilter;
  _ramp.magFilter = THREE.NearestFilter;
  _ramp.needsUpdate = true;
  return _ramp;
}

// `occlude`: when true, fragments that sit on the line between the camera and
// the tracked point (uPlayer) dither away, so a wall can't hide the player.
// Feed it live positions every frame via mat.userData.shader.uniforms.
export function makeToonMaterial({ color = 0xffffff, map = null, vertexColors = false, rim = 0.5, rimColor = 0xbfd7ff, occlude = false, dissolve = false, polygonOffset = false } = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    map,
    gradientMap: toonRamp(),
    vertexColors,
  });
  // Bias applied fragments a hair nearer the camera so decorative trim/decals
  // laid flush on a surface (door battens, trapdoor planks, floor discs) always
  // win the depth tie against the surface beneath instead of z-fighting it.
  if (polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
  }
  // Dissolve uniforms live on userData so callers can drive them every frame
  // regardless of whether onBeforeCompile has run yet (they're referenced by
  // identity when the shader compiles).
  if (dissolve) {
    mat.userData.uDissolve = { value: 0 };   // 0 = intact, 1 = fully gone
    mat.userData.uBlacken = { value: 0 };    // 0 = lit body, 1 = charred black
    mat.userData.uDissolveScale = { value: 4.5 };
    mat.userData.uEdgeColor = { value: new THREE.Color(0xff7a1a) };
  }
  if (rim > 0 || occlude || dissolve) {
    const rc = new THREE.Color(rimColor);
    mat.onBeforeCompile = (shader) => {
      let common = "#include <common>";
      let inject = "";
      if (dissolve) {
        shader.uniforms.uDissolve = mat.userData.uDissolve;
        shader.uniforms.uBlacken = mat.userData.uBlacken;
        shader.uniforms.uDissolveScale = mat.userData.uDissolveScale;
        shader.uniforms.uEdgeColor = mat.userData.uEdgeColor;
        common += `
          uniform float uDissolve;
          uniform float uBlacken;
          uniform float uDissolveScale;
          uniform vec3 uEdgeColor;
          varying vec3 vDissolvePos;
          ${NOISE_GLSL}`;
        injectDissolveVertex(shader);
        // burn the body to black, then eat it away from the noisy edge inward,
        // leaving a thin ember-hot rim on the fragments about to vanish
        inject += `
          float _dn = snoise(vDissolvePos * uDissolveScale) * 0.5 + 0.5;
          float _edge = _dn - uDissolve;
          if (uDissolve > 0.0 && _edge < 0.0) discard;
          outgoingLight = mix(outgoingLight, vec3(0.0), uBlacken);
          if (uDissolve > 0.0) {
            float _glow = 1.0 - smoothstep(0.0, 0.14, _edge);
            outgoingLight += uEdgeColor * _glow * 2.2;
          }`;
      }
      if (rim > 0) {
        shader.uniforms.uRim = { value: rim };
        shader.uniforms.uRimColor = { value: rc };
        common += "\nuniform float uRim;\nuniform vec3 uRimColor;";
        inject += `
          float rimF = 1.0 - saturate(dot(normalize(vViewPosition), normal));
          rimF = smoothstep(0.55, 0.95, rimF);
          outgoingLight += uRimColor * rimF * uRim;`;
      }
      if (occlude) {
        shader.uniforms.uPlayer = { value: new THREE.Vector3() };
        shader.uniforms.uCamPos = { value: new THREE.Vector3() };
        shader.uniforms.uFadeRadius = { value: 1.7 };
        common += `
          uniform vec3 uPlayer;
          uniform vec3 uCamPos;
          uniform float uFadeRadius;
          varying vec3 vWorldPos;
          // interleaved gradient noise: a cheap, stable ordered-dither pattern
          float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;
        // world-space position of the fragment, instancing-aware
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;")
          .replace(
            "#include <project_vertex>",
            `#include <project_vertex>
             vec4 _wp = vec4(transformed, 1.0);
             #ifdef USE_INSTANCING
               _wp = instanceMatrix * _wp;
             #endif
             _wp = modelMatrix * _wp;
             vWorldPos = _wp.xyz;`
          );
        inject += `
          vec3 _ab = uPlayer - uCamPos;
          float _t = dot(vWorldPos - uCamPos, _ab) / max(dot(_ab, _ab), 1e-4);
          vec3 _closest = uCamPos + _ab * clamp(_t, 0.0, 1.0);
          float _d = distance(vWorldPos, _closest);
          // fade only fragments between the camera and the player, near the ray
          float _occ = 1.0 - smoothstep(uFadeRadius * 0.5, uFadeRadius, _d);
          _occ *= smoothstep(0.02, 0.14, _t) * (1.0 - smoothstep(0.88, 1.0, _t));
          if (_occ * 0.85 > ign(gl_FragCoord.xy)) discard;`;
      }
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", common)
        .replace("#include <opaque_fragment>", inject + "\n#include <opaque_fragment>");
      mat.userData.shader = shader;
    };
  }
  return mat;
}

// Drive an `occlude:true` material's see-through cutout: feed it the camera and
// the tracked point (the player's torso) so walls on the line between them
// dither away. Safe to call before the shader has compiled (no-op until then).
const _torso = new THREE.Vector3();
export function feedOccluder(mat, player, cam, torsoFrac = 0.6) {
  const sh = mat && mat.userData && mat.userData.shader;
  if (!sh || !sh.uniforms.uPlayer) return;
  _torso.copy(player.position).setY((player.height ?? 1) * torsoFrac);
  sh.uniforms.uPlayer.value.copy(_torso);
  sh.uniforms.uCamPos.value.copy(cam.position);
}

// Outline material: black backfaces pushed out along the normal in the
// vertex shader (after skinning, so it hugs animated bodies).
export function makeOutlineMaterial(width = 0.02, color = 0x1a0e24, dissolve = false) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true });
  if (dissolve) {
    mat.userData.uDissolve = { value: 0 };
    mat.userData.uDissolveScale = { value: 4.5 };
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uOutline;")
      .replace(
        "#include <project_vertex>",
        `objectNormal = normalize(objectNormal);
         transformed += objectNormal * uOutline;
         #include <project_vertex>`
      );
    if (dissolve) {
      shader.uniforms.uDissolve = mat.userData.uDissolve;
      shader.uniforms.uDissolveScale = mat.userData.uDissolveScale;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uDissolve;
           uniform float uDissolveScale;
           varying vec3 vDissolvePos;
           ${NOISE_GLSL}`
        )
        .replace(
          "#include <opaque_fragment>",
          `float _dn = snoise(vDissolvePos * uDissolveScale) * 0.5 + 0.5;
           if (uDissolve > 0.0 && _dn - uDissolve < 0.0) discard;
           #include <opaque_fragment>`
        );
      injectDissolveVertex(shader);
    }
  };
  return mat;
}

// Outline shell for a SkinnedMesh (shares geometry + skeleton) or Mesh.
export function addOutline(mesh, width = 0.022, dissolve = false) {
  let shell;
  if (mesh.isSkinnedMesh) {
    shell = new THREE.SkinnedMesh(mesh.geometry, makeOutlineMaterial(width, undefined, dissolve));
    shell.bind(mesh.skeleton, mesh.bindMatrix);
  } else {
    shell = new THREE.Mesh(mesh.geometry, makeOutlineMaterial(width, undefined, dissolve));
  }
  shell.raycast = () => {};
  shell.frustumCulled = mesh.frustumCulled;
  mesh.add(shell);
  return shell;
}

let _blobTex = null;
function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, "rgba(10,5,20,0.45)");
  grad.addColorStop(1, "rgba(10,5,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

const _blobGeo = new THREE.PlaneGeometry(1, 1);
export function makeBlobShadow(radius = 0.5) {
  const mat = new THREE.MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
  });
  const m = new THREE.Mesh(_blobGeo, mat);
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(radius * 2);
  m.renderOrder = 1;
  m.raycast = () => {};
  return m;
}
