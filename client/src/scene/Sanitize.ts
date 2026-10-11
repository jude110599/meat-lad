import { ShaderPass } from 'postprocessing';
import { NoBlending, ShaderMaterial, Uniform } from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

// NaN fails every comparison, so the lessThan() test also catches drivers
// that fold isnan() away.
const FRAG = /* glsl */ `
uniform sampler2D inputBuffer;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(inputBuffer, vUv);
  bool ok = !any(isnan(c)) && !any(isinf(c)) && all(lessThan(abs(c), vec4(1.0e4)));
  gl_FragColor = ok ? clamp(c, 0.0, 64.0) : vec4(0.0, 0.0, 0.0, 1.0);
}
`;

/**
 * The first post pass: replaces NaN, infinite and absurd pixels in the HDR
 * scene buffer with black and caps the rest. Bloom's mipmap blur averages
 * pixels together, so a single NaN (from a shader edge case on one GPU)
 * would otherwise smear across every mip and turn the whole screen black.
 */
export function makeSanitizePass(): ShaderPass {
  const mat = new ShaderMaterial({
    name: 'SanitizeMaterial',
    uniforms: { inputBuffer: new Uniform(null) },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: NoBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const pass = new ShaderPass(mat, 'inputBuffer');
  pass.name = 'SanitizePass';
  return pass;
}
