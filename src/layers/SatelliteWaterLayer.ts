/**
 * Custom MapLibre layer that renders satellite imagery only on water areas.
 * Uses the stencil buffer with water polygon geometry from the vector tile source
 * to achieve pixel-perfect coastline masking.
 */

import type { CustomLayerInterface } from "maplibre-gl";
import { createProgram, stencilVert, stencilFrag, tileVert, tileFrag, blitVert, blitFrag } from "./shaders";
import { SatelliteTileCache, getVisibleTiles, tileMercatorBounds } from "./satellite-tile-cache";
import { buildWaterMesh, type WaterMesh } from "./water-stencil";

interface GLState {
  framebuffer: WebGLFramebuffer | null;
  viewport: Int32Array;
  stencilTest: boolean;
  blend: boolean;
  colorMask: boolean[];
  stencilMask: number;
  program: WebGLProgram | null;
  arrayBuffer: WebGLBuffer | null;
  activeTexture: number;
  textureBinding: WebGLTexture | null;
  blendSrc: number;
  blendDst: number;
}

function saveState(gl: WebGLRenderingContext): GLState {
  return {
    framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
    viewport: gl.getParameter(gl.VIEWPORT),
    stencilTest: gl.isEnabled(gl.STENCIL_TEST),
    blend: gl.isEnabled(gl.BLEND),
    colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
    stencilMask: gl.getParameter(gl.STENCIL_WRITEMASK),
    program: gl.getParameter(gl.CURRENT_PROGRAM),
    arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
    activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
    textureBinding: gl.getParameter(gl.TEXTURE_BINDING_2D),
    blendSrc: gl.getParameter(gl.BLEND_SRC_RGB),
    blendDst: gl.getParameter(gl.BLEND_DST_RGB),
  };
}

function restoreState(gl: WebGLRenderingContext, s: GLState) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.framebuffer);
  gl.viewport(s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3]);
  if (s.stencilTest) gl.enable(gl.STENCIL_TEST); else gl.disable(gl.STENCIL_TEST);
  if (s.blend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
  gl.colorMask(s.colorMask[0], s.colorMask[1], s.colorMask[2], s.colorMask[3]);
  gl.stencilMask(s.stencilMask);
  gl.useProgram(s.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, s.arrayBuffer);
  gl.activeTexture(s.activeTexture);
  gl.bindTexture(gl.TEXTURE_2D, s.textureBinding);
  gl.blendFunc(s.blendSrc, s.blendDst);
}

export class SatelliteWaterLayer implements CustomLayerInterface {
  id = "satellite-water";
  type = "custom" as const;
  renderingMode = "2d" as const;

  private map: maplibregl.Map | null = null;
  private gl: WebGLRenderingContext | null = null;

  // Shader programs
  private stencilProg: WebGLProgram | null = null;
  private tileProg: WebGLProgram | null = null;
  private blitProg: WebGLProgram | null = null;

  // Buffers
  private quadBuf: WebGLBuffer | null = null;
  private waterBuf: WebGLBuffer | null = null;
  private waterVertexCount = 0;

  // Offscreen FBO
  private fbo: WebGLFramebuffer | null = null;
  private fboColor: WebGLTexture | null = null;
  private fboDepthStencil: WebGLRenderbuffer | null = null;
  private fboWidth = 0;
  private fboHeight = 0;

  // Tile cache
  private tileCache: SatelliteTileCache | null = null;

  // Water mesh
  private meshDirty = true;
  private sourceDataHandler: (() => void) | null = null;

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    this.map = map;
    this.gl = gl;

    // Compile shaders
    this.stencilProg = createProgram(gl, stencilVert, stencilFrag);
    this.tileProg = createProgram(gl, tileVert, tileFrag);
    this.blitProg = createProgram(gl, blitVert, blitFrag);

    // Unit quad for tile rendering (0,0)→(1,1)
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);

    // Tile cache
    this.tileCache = new SatelliteTileCache(gl, () => map.triggerRepaint());

    // Mark mesh dirty when vector tiles change or map moves
    this.sourceDataHandler = () => { this.meshDirty = true; map.triggerRepaint(); };
    map.on("sourcedata", this.sourceDataHandler);
    map.on("moveend", () => { this.meshDirty = true; map.triggerRepaint(); });
    map.on("move", () => map.triggerRepaint());
  }

  private ensureFBO(gl: WebGLRenderingContext, w: number, h: number) {
    if (this.fbo && this.fboWidth === w && this.fboHeight === h) return;

    // Cleanup old
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboColor) gl.deleteTexture(this.fboColor);
    if (this.fboDepthStencil) gl.deleteRenderbuffer(this.fboDepthStencil);

    this.fboWidth = w;
    this.fboHeight = h;

    // Color texture
    this.fboColor = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.fboColor);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // Depth-stencil renderbuffer
    this.fboDepthStencil = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.fboDepthStencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);

    // FBO
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboColor, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.fboDepthStencil);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  private rebuildWaterMesh(gl: WebGLRenderingContext) {
    if (!this.map) return;
    const mesh: WaterMesh = buildWaterMesh(this.map);
    if (mesh.vertexCount === 0) {
      this.waterVertexCount = 0;
      return;
    }

    if (!this.waterBuf) this.waterBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.DYNAMIC_DRAW);
    this.waterVertexCount = mesh.vertexCount;
    this.meshDirty = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prerender(gl: WebGLRenderingContext, options: any) {
    if (!this.map || !this.tileCache) return;

    const state = saveState(gl);
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;

    this.ensureFBO(gl, w, h);

    // Rebuild water mesh if needed
    if (this.meshDirty) this.rebuildWaterMesh(gl);
    if (this.waterVertexCount === 0) {
      restoreState(gl, state);
      return;
    }

    // Bind offscreen FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    const matrix = new Float32Array(options.modelViewProjectionMatrix);

    // ── Pass 1: Write water polygons to stencil buffer ──
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.stencilMask(0xFF);
    gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.disable(gl.BLEND);

    gl.useProgram(this.stencilProg);
    const sMatLoc = gl.getUniformLocation(this.stencilProg!, "u_matrix");
    gl.uniformMatrix4fv(sMatLoc, false, matrix);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuf);
    const sPosLoc = gl.getAttribLocation(this.stencilProg!, "a_pos");
    gl.enableVertexAttribArray(sPosLoc);
    gl.vertexAttribPointer(sPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, this.waterVertexCount);
    gl.disableVertexAttribArray(sPosLoc);

    // ── Pass 2: Draw satellite tiles where stencil is non-zero ──
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilMask(0x00);

    gl.useProgram(this.tileProg);
    const tMatLoc = gl.getUniformLocation(this.tileProg!, "u_matrix");
    const tTlLoc = gl.getUniformLocation(this.tileProg!, "u_tile_tl");
    const tSizeLoc = gl.getUniformLocation(this.tileProg!, "u_tile_size");
    const tTexLoc = gl.getUniformLocation(this.tileProg!, "u_texture");
    gl.uniformMatrix4fv(tMatLoc, false, matrix);
    gl.uniform1i(tTexLoc, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    const tPosLoc = gl.getAttribLocation(this.tileProg!, "a_pos");
    gl.enableVertexAttribArray(tPosLoc);
    gl.vertexAttribPointer(tPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);

    const tiles = getVisibleTiles(this.map);
    for (const tile of tiles) {
      const tex = this.tileCache.getTile(tile.z, tile.x, tile.y);
      if (!tex) continue;
      const { tl, size } = tileMercatorBounds(tile.z, tile.x, tile.y);
      gl.uniform2f(tTlLoc, tl[0], tl[1]);
      gl.uniform2f(tSizeLoc, size, size);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.disableVertexAttribArray(tPosLoc);
    gl.disable(gl.STENCIL_TEST);

    restoreState(gl, state);
  }

  render(gl: WebGLRenderingContext) {
    if (!this.fboColor || this.waterVertexCount === 0) return;

    const state = saveState(gl);

    // Blit the offscreen FBO to screen
    gl.useProgram(this.blitProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboColor);
    gl.uniform1i(gl.getUniformLocation(this.blitProg!, "u_texture"), 0);

    // Fullscreen quad using the same quad buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    const bPosLoc = gl.getAttribLocation(this.blitProg!, "a_pos");
    gl.enableVertexAttribArray(bPosLoc);
    // Remap 0..1 quad to -1..1 clip space
    // The blit vertex shader does: gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0)
    // Actually our blitVert uses a_pos directly as clip coords (-1..1)
    // So we need a separate buffer. Let's create one inline.
    const fsQuad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, fsQuad, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(bPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Restore the quad buffer data for next frame's tile rendering
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);

    gl.disableVertexAttribArray(bPosLoc);
    restoreState(gl, state);
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext) {
    if (this.sourceDataHandler && this.map) {
      this.map.off("sourcedata", this.sourceDataHandler);
    }
    if (this.stencilProg) gl.deleteProgram(this.stencilProg);
    if (this.tileProg) gl.deleteProgram(this.tileProg);
    if (this.blitProg) gl.deleteProgram(this.blitProg);
    if (this.quadBuf) gl.deleteBuffer(this.quadBuf);
    if (this.waterBuf) gl.deleteBuffer(this.waterBuf);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboColor) gl.deleteTexture(this.fboColor);
    if (this.fboDepthStencil) gl.deleteRenderbuffer(this.fboDepthStencil);
    this.tileCache?.dispose();
    this.map = null;
    this.gl = null;
  }
}
