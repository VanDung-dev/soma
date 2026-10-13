#version 300 es
precision highp float;
in vec3 world_position;
in vec3 world_normal;
uniform vec3 eye;
uniform vec3 camera_target;
uniform vec4 base_color;
uniform float roughness;
uniform float metallic;
uniform float alpha_cutoff;
uniform bool selected;
uniform bool picking;
uniform vec3 pick_color;
uniform float reveal;
out vec4 output_color;
vec3 srgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
    // Ordered dithering fades opaque geometry without changing depth or material blending.
    if (reveal < 1.0) {
        const float threshold[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
        ivec2 pixel = ivec2(gl_FragCoord.xy) % 4;
        if (reveal <= (threshold[pixel.y * 4 + pixel.x] + 0.5) / 16.0) discard;
    }
    if (base_color.a <= 0.0 || base_color.a < alpha_cutoff) discard;
    if (picking) { output_color = vec4(pick_color, 1.0); return; }
    vec3 n = normalize(world_normal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 v = normalize(eye - world_position);
    vec3 l = normalize(eye - camera_target);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), l));
    vec3 up = cross(l, right);
    vec3 h = normalize(v + l);
    float nl = max(dot(n, l), 0.0), nv = max(dot(n, v), 0.0001);
    float nh = max(dot(n, h), 0.0), vh = max(dot(v, h), 0.0);
    float a = max(roughness * roughness, 0.0025), a2 = a * a;
    float d = a2 / max(3.14159265 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0), 0.000001);
    float k = pow(roughness + 1.0, 2.0) / 8.0;
    float g = nv / (nv * (1.0-k) + k) * nl / max(nl * (1.0-k) + k, 0.0001);
    vec3 f0 = mix(vec3(0.04), base_color.rgb, metallic);
    vec3 f = f0 + (1.0-f0) * pow(1.0-vh, 5.0);
    vec3 diffuse = (1.0-f) * (1.0-metallic) * base_color.rgb / 3.14159265;
    vec3 specular = d * g * f / max(4.0 * nv * nl, 0.0001);
    float sky = dot(n, up) * 0.5 + 0.5;
    vec3 ambient = mix(vec3(0.12, 0.10, 0.09), vec3(0.30, 0.33, 0.36), sky);
    float fill = max(dot(n, normalize(l + right * 0.6 + up * 0.3)), 0.0);
    float rim = pow(1.0-nv, 3.0) * max(dot(n, normalize(l - right * 1.6 + up * 0.4)), 0.0);
    vec3 color = base_color.rgb * (ambient + fill * 0.16)
        + (diffuse + specular) * nl * vec3(3.2, 3.0, 2.8) + rim * vec3(0.13, 0.17, 0.20);
    if (selected) color += vec3(0.093, 0.045, 0.007);
    color += (1.0 - reveal) * vec3(0.12, 0.20, 0.16);
    output_color = vec4(srgb(clamp(color, 0.0, 1.0)), base_color.a);
}
