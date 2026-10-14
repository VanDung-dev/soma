import fragment from '../../../crates/anatomy_wasm/src/shaders/model.frag.glsl?raw';

// Run with a loaded WASM viewer and its canvas context to cover framebuffer reuse.
export function checkViewerShadows(viewer, gl, ids) {
  const original = gl.bindFramebuffer;
  let passes = 0;
  let sharedFramebuffer;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  gl.bindFramebuffer = function(target, buffer) {
    if (buffer && !sharedFramebuffer) sharedFramebuffer = buffer;
    if (buffer && buffer === sharedFramebuffer) passes++;
    return original.call(this, target, buffer);
  };
  try {
    viewer.set_visibility(JSON.stringify(ids)); viewer.render();
    assert(passes === 1, 'Visibility must rebuild shadows');
    viewer.rotate(0.05, 0); viewer.render();
    assert(passes === 2, 'Camera orbit must update shadows with the light');
    viewer.pan(0.01, -0.01); viewer.zoom(0.98); viewer.render();
    assert(passes === 2, 'Pan and zoom must reuse shadows');
    const rgba = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const index = rgba.findIndex((v, i) => i % 4 === 3 && v === 255);
    assert(index >= 0, 'Expected visible opaque anatomy');
    const pixel = Math.floor(index / 4), id = viewer.pick(pixel % gl.canvas.width, Math.floor(pixel / gl.canvas.width));
    assert(ids.includes(id), 'Picking must return a visible structure');
    assert(passes === 3, 'Picking must write its IDs');
    viewer.render(); assert(passes === 4, 'Picking must invalidate the shared shadow map');
    viewer.render(); assert(passes === 4, 'A stable frame must reuse shadows');
    viewer.resize(gl.canvas.width, gl.canvas.height);
    const beforeResize = passes;
    viewer.render();
    assert(passes === beforeResize + 1, 'Resize must rebuild shadows');
    viewer.begin_reconstruction(0, false); viewer.render();
    assert(passes === beforeResize + 2, 'Reconstruction must rebuild shadows');
    assert(gl.getError() === gl.NO_ERROR, 'WASM viewer WebGL error');
    return { visibility: true, cameraLight: true, panZoomCache: true, picking: id, resize: true, reconstruction: true, shadowPasses: passes };
  } finally {
    gl.bindFramebuffer = original;
    viewer.select(''); viewer.inspect('reset'); viewer.render();
  }
}

// Run in the Vite browser: (await import('/tests/shading.browser.mjs')).checkShading()
export function checkShading() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw Error('WebGL2 required');
  const shaders = [], programs = [], textures = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const compile = (type, source) => {
    const shader = gl.createShader(type); shaders.push(shader);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    assert(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = `#version 300 es
    out vec3 world_position; out vec3 world_normal;
    uniform mat3 surface_basis;
    void main() {
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      world_position = vec3(0.0); world_normal = surface_basis * vec3(0.0, 0.0, 1.0);
    }`;
  const link = source => {
    const program = gl.createProgram(); programs.push(program);
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source)); gl.linkProgram(program);
    assert(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
    gl.useProgram(program); return program;
  };
  const pixel = () => {
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const rgba = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    assert(gl.getError() === gl.NO_ERROR, 'WebGL draw error'); return [...rgba];
  };
  gl.viewport(0, 0, 1, 1);
  try {
    const tone = link(fragment.split('void main()')[0] + 'void main() { output_color = vec4(filmic(base_color.rgb), 1.0); }');
    // Neutral Filmic sRGB samples from Blender's OCIO config, exposure 0 / look None.
    const samples = [[0, 0], [0.01, 0.1011], [0.05, 0.2731], [0.18, 0.5002], [0.33, 0.6179],
      [0.5, 0.6950], [1, 0.8072], [2, 0.8923], [4, 0.9494], [8, 0.9832], [16, 0.9997]];
    let previous = -1;
    for (const [linear, display] of samples) {
      gl.uniform4f(gl.getUniformLocation(tone, 'base_color'), linear, linear, linear, 1);
      const rgba = pixel();
      assert(Math.abs(rgba[0] / 255 - display) < 0.008, `Filmic mismatch at ${linear}: ${rgba}`);
      assert(rgba[0] > previous && rgba[0] === rgba[1] && rgba[1] === rgba[2], 'Neutral curve must be monotonic');
      previous = rgba[0];
    }
    const model = link(fragment), loc = name => gl.getUniformLocation(model, name);
    gl.uniform4f(loc('base_color'), 0.5, 0.5, 0.5, 1);
    gl.uniform1f(loc('roughness'), 1); gl.uniform1f(loc('reveal'), 1);
    gl.uniform1f(loc('specular'), 0.04);
    const identity = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    gl.uniformMatrix3fv(loc('light_basis'), false, identity);
    gl.uniformMatrix3fv(loc('surface_basis'), false, identity);
    gl.uniform3f(loc('eye'), 0, 0, 10); const front = pixel();
    const c = Math.SQRT1_2;
    gl.uniformMatrix3fv(loc('light_basis'), false, new Float32Array([c, 0, -c, 0, 1, 0, c, 0, c]));
    gl.uniform3f(loc('eye'), 10, 0, 10); const side = pixel();
    assert(front.slice(0, 3).some((v, i) => Math.abs(v - side[i]) > 10), 'Light direction must follow camera orbit');
    const reverse = new Float32Array([-1, 0, 0, 0, 1, 0, 0, 0, -1]);
    gl.uniformMatrix3fv(loc('light_basis'), false, reverse);
    gl.uniformMatrix3fv(loc('surface_basis'), false, reverse);
    gl.uniform3f(loc('eye'), 0, 0, -10); const back = pixel();
    assert(front.slice(0, 3).every((v, i) => Math.abs(v - back[i]) <= 1), 'Front and back surfaces must receive equal light when facing the camera');
    gl.uniformMatrix3fv(loc('light_basis'), false, identity);
    gl.uniformMatrix3fv(loc('surface_basis'), false, identity);
    gl.uniform3f(loc('eye'), 0, 0, 10);
    gl.uniform1f(loc('subsurface'), 1); const scattering = pixel();
    assert(scattering.slice(0, 3).every((v, i) => v > front[i]), 'Source subsurface weight must soften unlit surfaces');
    gl.uniform1f(loc('subsurface'), 0);
    const texture = gl.createTexture(); textures.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniformMatrix4fv(loc('shadow_projection'), false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    gl.uniform2f(loc('shadow_texel'), 1 / 1024, 1 / 1024);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    const lit = pixel();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([51, 0, 0, 255]));
    const shadowed = pixel();
    assert(shadowed.slice(0, 3).every((v, i) => v < lit[i] - 10), 'Occluders must cast a key-light shadow');
    gl.uniform1i(loc('shadow_pass'), 1); const depth = pixel();
    assert(Math.abs((depth[0] + depth[1] / 255 + depth[2] / 65025) / 255 - 0.5) < 0.0001, 'Shadow depth must survive RGBA8 packing');
    gl.uniform1i(loc('shadow_pass'), 0);
    gl.uniform1i(loc('picking'), 1); gl.uniform3f(loc('pick_color'), 17 / 255, 89 / 255, 203 / 255);
    assert(JSON.stringify(pixel()) === '[17,89,203,255]', 'Picking IDs must bypass tone mapping');
    gl.uniform1i(loc('picking'), 0); gl.uniform4f(loc('base_color'), 0.5, 0.5, 0.5, 0.15);
    assert(Math.abs(pixel()[3] - 38) <= 1, 'Preserve material opacity');
    gl.uniform1f(loc('alpha_cutoff'), 0.2); assert(pixel().every(v => v === 0), 'Preserve alpha mask');
    gl.uniform1f(loc('alpha_cutoff'), 0); gl.uniform1f(loc('reveal'), 0);
    assert(pixel().every(v => v === 0), 'Reconstruction must still hide unrevealed surfaces');
    return { filmicSamples: samples.length, cameraLighting: { front, side, back }, shadows: { lit, shadowed }, subsurface: true, picking: true, opacity: true, alphaMask: true, reconstruction: true };
  } finally {
    programs.forEach(program => gl.deleteProgram(program)); shaders.forEach(shader => gl.deleteShader(shader));
    textures.forEach(texture => gl.deleteTexture(texture));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
