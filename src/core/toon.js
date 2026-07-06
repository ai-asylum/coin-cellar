// Stylised toon look shared by every mesh in the game:
//  - MeshToonMaterial with a hard 3-step gradient ramp
//  - fresnel rim light injected into the toon shader
//  - inverted-hull outlines (works on SkinnedMesh too — the outline shell
//    shares the skeleton so it deforms with the body)
//  - cheap blob shadows (radial-gradient sprite), no shadow maps on mobile
import * as THREE from "three";

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
export function makeToonMaterial({ color = 0xffffff, vertexColors = false, rim = 0.5, rimColor = 0xbfd7ff, occlude = false } = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp(),
    vertexColors,
  });
  if (rim > 0 || occlude) {
    const rc = new THREE.Color(rimColor);
    mat.onBeforeCompile = (shader) => {
      let common = "#include <common>";
      let inject = "";
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

// Outline material: black backfaces pushed out along the normal in the
// vertex shader (after skinning, so it hugs animated bodies).
export function makeOutlineMaterial(width = 0.02, color = 0x1a0e24) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true });
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
  };
  return mat;
}

// Outline shell for a SkinnedMesh (shares geometry + skeleton) or Mesh.
export function addOutline(mesh, width = 0.022) {
  let shell;
  if (mesh.isSkinnedMesh) {
    shell = new THREE.SkinnedMesh(mesh.geometry, makeOutlineMaterial(width));
    shell.bind(mesh.skeleton, mesh.bindMatrix);
  } else {
    shell = new THREE.Mesh(mesh.geometry, makeOutlineMaterial(width));
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
