import fragment from '../../../crates/anatomy_wasm/src/shaders/model.frag.glsl?raw';

// Run in Vite: (await import('/tests/shadow.browser.mjs')).checkShadowFiltering()
export function checkShadowFiltering() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw Error('WebGL2 required');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const shaders = [], program = gl.createProgram(), texture = gl.createTexture();
  const compile = (type, source) => {
    const shader = gl.createShader(type); shaders.push(shader);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    assert(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  };
  try {
    compile(gl.VERTEX_SHADER, `#version 300 es
      out vec3 world_position;
      uniform vec2 slope;
      uniform float extent;
      uniform float shift;
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
        gl_Position = vec4(p, 0.0, 1.0);
        vec2 receiver = p * extent + vec2(shift, 0.0);
        world_position = vec3(receiver, dot(slope, receiver));
      }`);
    compile(gl.FRAGMENT_SHADER, fragment.split('void main()')[0] + `void main() {
      output_color = vec4(vec3(sunlight_visibility(normalize(vec3(-0.65, -0.35, 1.0)),
        normalize(vec3(0.707107, 0.5, 0.5)))), 1.0);
    }`);
    gl.linkProgram(program);
    assert(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const loc = name => gl.getUniformLocation(program, name), size = 64;
    gl.uniformMatrix4fv(loc('shadow_projection'), false,
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    gl.uniform2f(loc('shadow_texel'), 1 / size, 1 / size);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
    }
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
      gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const draw = (slope, occluder, extent = 0.65, shift = 0) => {
      const depths = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size, v = (y + 0.5) / size;
        const z = 0.5 + slope[0] * (u - 0.5) + slope[1] * (v - 0.5)
          - (occluder && u > 0.45 && u < 0.55 ? 0.2 : 0);
        const encoded = [z % 1, (z * 255) % 1, (z * 65025) % 1];
        depths.set([Math.round((encoded[0] - encoded[1] / 255) * 255),
          Math.round((encoded[1] - encoded[2] / 255) * 255), Math.round(encoded[2] * 255), 255],
        (y * size + x) * 4);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, depths);
      gl.uniform2fv(loc('slope'), slope);
      gl.uniform1f(loc('extent'), extent);
      gl.uniform1f(loc('shift'), shift);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      assert(gl.getError() === gl.NO_ERROR, 'Shadow filtering produced a WebGL error');
      return pixels.filter((_, i) => i % 4 === 0);
    };
    const minima = [[0, 0], [0.65, 0.35], [-0.65, 0.35], [0.95, 0]].map(slope => {
      const minimum = Math.min(...draw(slope, false));
      assert(minimum >= 254, `A plane must not shadow itself at slope ${slope}: ${minimum}/255`);
      return minimum;
    });
    assert(Math.min(...draw([0.65, 0.35], false, 1)) >= 254,
      'Clamped border texels must use their actual receiver depth');
    const shadow = draw([0.65, 0.35], true);
    assert(Math.min(...shadow) < 5 && Math.max(...shadow) >= 254, 'Keep shadows from real occluders');
    const edgeSamples = Array.from({ length: 33 }, (_, step) => {
      const u = 35 / size + (step / 32 - 0.5) * 4 / size;
      const shift = 2 * (u - 0.5) - 0.65 / canvas.width;
      return draw([0.65, 0.35], true, 0.65, shift)[48 * canvas.width + 48];
    });
    assert(new Set(edgeSamples).size > 16, 'Shadow edges must interpolate at subtexel positions');
    assert(edgeSamples.every((value, i) => i === 0 ||
      (value >= edgeSamples[i - 1] && value - edgeSamples[i - 1] <= 17)),
    `Shadow edges must fade continuously: ${edgeSamples}`);
    return { selfShadowMinima: minima, clampedBorder: true, occluder: true,
      edgeLevels: new Set(edgeSamples).size };
  } finally {
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.deleteProgram(program); gl.deleteTexture(texture);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
