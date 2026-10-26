# view3d/

Small 3D rendering for garments on bodies: the maths, one shading model, and two renderers that draw the same scenes —
WebGL (WebGL 2 or 1) in browsers and a pure-JS software renderer that works without WebGL and in Node (mockup images
at build time, the fallback on machines without GPU access).

| file | contents |
| --- | --- |
| `math.js` | column-major 4 × 4 matrices: `perspective`, `lookAt`, `mul`, `transformPoint` (homogeneous), `orbitCamera({ target, distance, yaw, pitch, fov })` → `{ eye, view, proj(aspect), viewProj(aspect) }`, `computeNormals(positions, indices, out?)` |
| `shade.js` | `LIGHTS` (key, fill, rim), hemisphere `SKY` / `GROUND`, `shade(base, normal, view, sheen, roughness, inside)` in linear light, `toLinear` / `toSRGB` |
| `soft.js` | `renderSoft(scene, camera, { width, height, ss, background })` → `{ width, height, data }` (RGBA) |
| `webgl.js` | `createGL(canvas, { preserve })` → `{ setScene, updatePositions, setTexture, render(camera, { background }), snapshot, dispose }` or `null` without WebGL |

## Scenes

```js
{
  meshes: [{
    key, positions: Float32Array, normals?, indices: Uint32Array, uvs?, texture?: { width, height, data (RGBA) },
    color: [r, g, b] (sRGB 0..1), sheen, roughness,
    doubleSided: false,     // back faces skipped (the body)
    cull: 'front',          // front faces skipped: a lining is seen only from inside
    bias,                   // cm the mesh moves toward the eye for the depth test (outer garments of an outfit)
  }],
  shadow: { center: [x, z], radius },   // a soft ground disc
}
```

Meshes that share a `positions` array share one vertex buffer in WebGL; `updatePositions(positions)` re-uploads it
each frame of a simulation. Garments are double-sided: the inside of a garment is shaded darker. Textures are sRGB
and are linearised for lighting; the output is sRGB. The software renderer computes lighting per vertex (Gouraud),
interpolates texture coordinates perspective-correctly with bilinear sampling, and supersamples by `ss`.

## Tests

`node view3d/test.js` (also run by `node check.js`): projections of known points, camera orientation, normals, the
shading bounds, and software renders of small scenes (background, depth test, depth bias, front culling, textures,
supersampling).
