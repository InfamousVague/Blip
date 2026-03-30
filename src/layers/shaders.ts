/**
 * GLSL shaders for the SatelliteWaterLayer.
 * Three programs: stencil fill, satellite tile blit, fullscreen composite.
 */

// ── Stencil pass: renders water polygon triangles to stencil buffer (no color) ──

export const stencilVert = `
  attribute vec2 a_pos;
  uniform mat4 u_matrix;
  void main() {
    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  }
`;

export const stencilFrag = `
  precision mediump float;
  void main() {
    gl_FragColor = vec4(0.0);
  }
`;

// ── Satellite tile pass: draws a textured quad for one tile ──

export const tileVert = `
  attribute vec2 a_pos;
  uniform mat4 u_matrix;
  uniform vec2 u_tile_tl;
  uniform vec2 u_tile_size;
  varying vec2 v_texcoord;
  void main() {
    v_texcoord = a_pos;
    vec2 mercator = u_tile_tl + a_pos * u_tile_size;
    gl_Position = u_matrix * vec4(mercator, 0.0, 1.0);
  }
`;

export const tileFrag = `
  precision mediump float;
  uniform sampler2D u_texture;
  varying vec2 v_texcoord;
  void main() {
    vec4 color = texture2D(u_texture, v_texcoord);
    // Output premultiplied alpha
    gl_FragColor = vec4(color.rgb * color.a, color.a);
  }
`;

// ── Fullscreen blit: composites the offscreen FBO onto the map ──

export const blitVert = `
  attribute vec2 a_pos;
  varying vec2 v_texcoord;
  void main() {
    v_texcoord = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

export const blitFrag = `
  precision mediump float;
  uniform sampler2D u_texture;
  varying vec2 v_texcoord;
  void main() {
    gl_FragColor = texture2D(u_texture, v_texcoord);
  }
`;

// ── Shader compilation helpers ──

export function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${info}`);
  }
  // Shaders can be detached after linking
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}
