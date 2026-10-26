#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D selection_mask;
uniform vec2 texel;
out vec4 output_color;
void main() {
    float inside = texture(selection_mask, uv).r;
    const vec2 directions[8] = vec2[8](
        vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1),
        vec2(0.7071, 0.7071), vec2(-0.7071, 0.7071),
        vec2(0.7071, -0.7071), vec2(-0.7071, -0.7071)
    );
    float edge = 0.0, glow = 0.0;
    for (int i = 0; i < 8; i++) {
        edge = max(edge, texture(selection_mask, uv + directions[i] * texel * 2.0).r);
        glow = max(glow, texture(selection_mask, uv + directions[i] * texel * 5.0).r);
    }
    output_color = vec4(mix(vec3(0.08, 0.65, 0.95), vec3(0.72, 0.94, 1.0), edge),
        (1.0 - inside) * max(edge * 0.95, glow * 0.3));
}
