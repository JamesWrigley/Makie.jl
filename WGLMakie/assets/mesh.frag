precision highp float;
precision highp int;

in vec2 frag_uv;
in vec4 frag_color;

in vec3 o_normal;
in vec3 o_camdir;
in float o_clip_distance[8];

uniform int num_clip_planes;

// Smoothes out edge around 0 light intensity, see GLMakie
float smooth_zero_max(float x) {
    const float c = 0.00390625, xswap = 0.6406707120152759, yswap = 0.20508383900190955;
    const float shift = 1.0 + xswap - yswap;
    float pow8 = x + shift;
    pow8 = pow8 * pow8; pow8 = pow8 * pow8; pow8 = pow8 * pow8;
    return x < yswap ? c * pow8 : x;
}

vec3 blinnphong(vec3 N, vec3 V, vec3 L, vec3 color){
    float backlight = get_backlight();
    float diff_coeff = smooth_zero_max(dot(L, -N)) +
        backlight * smooth_zero_max(dot(L, N));

    // specular coefficient
    vec3 H = normalize(L + V);

    float spec_coeff = pow(max(dot(H, -N), 0.0), get_shininess()) +
        backlight * pow(max(dot(H, N), 0.0), get_shininess());
    if (diff_coeff <= 0.0)
        spec_coeff = 0.0;

    // final lighting model
    return get_light_color() * vec3(
        get_diffuse() * diff_coeff * color +
        get_specular() * spec_coeff
    );
}

vec4 get_color(vec3 color, vec2 uv, bool colorrange, bool colormap){
    return vec4(color, 1.0);
}

vec4 get_color(vec4 color, vec2 uv, bool colorrange, bool colormap){
    return color;
}

vec4 get_color(bool color, vec2 uv, bool colorrange, bool colormap){
    return frag_color;  // color not in uniform
}

vec2 apply_uv_transform(mat3 transform, vec2 uv){ return (transform * vec3(uv, 1)).xy; }
vec4 get_color(sampler2D color, vec2 uv, bool colorrange, bool colormap){
    if (get_pattern()) {
        // TODO: per instance
        mat3 t = get_uv_transform();
        vec2 pos = apply_uv_transform(t, gl_FragCoord.xy);
        // vec2 pos = vec2(gl_FragCoord.xy) / vec2(textureSize(color, 0));
        return texture(color, pos);
    } else {
        return texture(color, uv);
    }
}

float _normalize(float val, float from, float to){return (val-from) / (to - from);}

vec4 get_color_from_cmap(float value, sampler2D color_map, vec2 colorrange) {
    float cmin = colorrange.x;
    float cmax = colorrange.y;
    if (value <= cmax && value >= cmin) {
        // in value range, continue!
    } else if (value < cmin) {
        return get_lowclip();
    } else if (value > cmax) {
        return get_highclip();
    } else {
        // isnan is broken (of course) -.-
        // so if outside value range and not smaller/bigger min/max we assume NaN
        return get_nan_color();
    }
    float i01 = clamp((value - cmin) / (cmax - cmin), 0.0, 1.0);
    // 1/0 corresponds to the corner of the colormap, so to properly interpolate
    // between the colors, we need to scale it, so that the ends are at 1 - (stepsize/2) and 0+(stepsize/2).
    float stepsize = 1.0 / float(textureSize(color_map, 0));
    i01 = (1.0 - stepsize) * i01 + 0.5 * stepsize;
    return texture(color_map, vec2(i01, 0.0));
}

vec4 get_color(bool color, vec2 uv, vec2 colorrange, sampler2D colormap){
    if (get_interpolate_in_fragment_shader()) {
        return get_color_from_cmap(frag_color.x, colormap, colorrange);
    } else {
        return frag_color;
    }
}

vec4 get_color(sampler2D values, vec2 uv, vec2 colorrange, sampler2D colormap){
    float value = texture(values, uv).x;
    return get_color_from_cmap(value, colormap, colorrange);
}

vec4 get_color(sampler2D color, vec2 uv, bool colorrange, sampler2D colormap){
    return texture(color, uv);
}

flat in uint frag_instance_id;

vec2 encode_uint_to_float(uint value) {
    float lower = float(value & 0xFFFFu) / 65535.0;
    float upper = float(value >> 16u) / 65535.0;
    return vec2(lower, upper);
}

vec4 pack_int(uint id, uint index) {
    vec4 unpack;
    unpack.rg = encode_uint_to_float(id);
    unpack.ba = encode_uint_to_float(index);
    return unpack;
}

// for picking indices in image, heatmap, surface
uint picking_index_from_uv(sampler2D img, vec2 uv) {
    ivec2 size = textureSize(img, 0);
    ivec2 jl_idx = clamp(ivec2(uv * vec2(size)), ivec2(0), size-1);
    uint idx = uint(jl_idx.y + jl_idx.x * size.y);
    return idx;
}

// These should not get hit
uint picking_index_from_uv(bool img, vec2 uv) { return frag_instance_id; }
uint picking_index_from_uv(vec3 img, vec2 uv) { return frag_instance_id; }
uint picking_index_from_uv(vec4 img, vec2 uv) { return frag_instance_id; }

void main()
{
    for (int i = 0; i < num_clip_planes; i++)
        if (o_clip_distance[i] < 0.0)
            discard;

    vec4 real_color = get_color(uniform_color, frag_uv, get_colorrange(), colormap);
    vec3 shaded_color = real_color.rgb;

    if(get_shading()){
        vec3 L = get_light_direction();
        vec3 N = normalize(o_normal);
        vec3 light = blinnphong(N, normalize(o_camdir), L, real_color.rgb);
        shaded_color = get_ambient() * real_color.rgb + light;
    }

    if (picking && (real_color.a > 0.1)) {
        if (get_PICKING_INDEX_FROM_UV()) {
            fragment_color = pack_int(object_id, picking_index_from_uv(uniform_color, frag_uv));
        } else
            fragment_color = pack_int(object_id, frag_instance_id);

        return;
    }

    if (real_color.a <= 0.0){
        discard;
    }
    fragment_color = vec4(shaded_color, real_color.a);
}
