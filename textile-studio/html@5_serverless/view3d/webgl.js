import{computeNormals}from"./math.js";import{LIGHTS,SKY,GROUND}from"./shade.js";const VS=`
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv;
uniform mat4 uVP; uniform vec3 uEyeV; uniform float uBias; varying vec3 vPos; varying vec3 vNor; varying vec2 vUv;
void main() { vPos = aPos; vNor = aNor; vUv = aUv; gl_Position = uVP * vec4(aPos + normalize(uEyeV - aPos) * uBias, 1.0); }`;const FS=`
precision highp float;
varying vec3 vPos; varying vec3 vNor; varying vec2 vUv;
uniform vec3 uEye; uniform vec3 uColor; uniform float uSheen; uniform float uRough; uniform float uTex;
uniform sampler2D uTexture; uniform vec3 uLd[3]; uniform vec3 uLc[3]; uniform float uLk[3]; uniform vec3 uSky; uniform vec3 uGround;
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec3 n = normalize(vNor);
  bool inside = !gl_FrontFacing;
  if (inside) n = -n;
  vec3 v = normalize(uEye - vPos);
  vec3 base = uTex > 0.5 ? toLin(texture2D(uTexture, vUv).rgb) : toLin(uColor);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 col = base * mix(uGround, uSky, hemi);
  float sheen = inside ? uSheen * 0.3 : uSheen;
  float rough = inside ? 1.0 : uRough;
  float shin = 8.0 + (1.0 - rough) * 90.0;
  for (int i = 0; i < 3; i++) {
    float nd = dot(n, uLd[i]);
    col += base * uLc[i] * max(0.0, (nd + 0.25) / 1.25) * uLk[i];
    if (nd > 0.0) {
      vec3 h = normalize(uLd[i] + v);
      col += uLc[i] * pow(max(0.0, dot(n, h)), shin) * (0.04 + sheen * 0.9) * uLk[i];
    }
  }
  if (inside) col *= 0.62;
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;const BG_VS='attribute vec2 aP; varying float vT; void main() { vT = aP.y * 0.5 + 0.5; gl_Position = vec4(aP, 0.999, 1.0); }';const BG_FS='precision mediump float; varying float vT; uniform vec3 uTop; uniform vec3 uBot; void main() { gl_FragColor = vec4(mix(uBot, uTop, vT), 1.0); }';function program(gl,vs,fs){const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
function createGL(canvas,o={}){let gl=null;const attrs={antialias:true,preserveDrawingBuffer:!!o.preserve,alpha:false};try{gl=canvas.getContext('webgl2',attrs)||canvas.getContext('webgl',attrs);}catch{gl=null;}
if(!gl)return null;const isGL2=typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext;if(!isGL2&&!gl.getExtension('OES_element_index_uint'))return null;let prog,bg;try{prog=program(gl,VS,FS);bg=program(gl,BG_VS,BG_FS);}catch(e){void e;return null;}
const loc=(n)=>gl.getUniformLocation(prog,n);const U={vp:loc('uVP'),eye:loc('uEye'),color:loc('uColor'),sheen:loc('uSheen'),rough:loc('uRough'),tex:loc('uTex'),sampler:loc('uTexture'),ld:loc('uLd'),lc:loc('uLc'),lk:loc('uLk'),sky:loc('uSky'),ground:loc('uGround'),eyeV:loc('uEyeV'),bias:loc('uBias')};const A={pos:gl.getAttribLocation(prog,'aPos'),nor:gl.getAttribLocation(prog,'aNor'),uv:gl.getAttribLocation(prog,'aUv')};const bgBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bgBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);let vbufs=new Map();let draws=[];const white=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));const pot=(n)=>(n&(n-1))===0;const makeTexture=(t)=>{const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,t.width,t.height,0,gl.RGBA,gl.UNSIGNED_BYTE,t.data instanceof Uint8Array?t.data:new Uint8Array(t.data.buffer,t.data.byteOffset,t.data.byteLength));const mip=isGL2||(pot(t.width)&&pot(t.height));if(mip)gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mip?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return tex;};const vbufFor=(m)=>{let b=vbufs.get(m.positions);if(!b){b={pos:gl.createBuffer(),nor:gl.createBuffer(),uv:gl.createBuffer(),positions:m.positions,normals:m.normals||null,uvs:m.uvs||null,allIdx:[]};vbufs.set(m.positions,b);}
b.allIdx.push(m.indices);if(m.uvs)b.uvs=m.uvs;if(m.normals)b.normals=m.normals;return b;};const upload=(b)=>{if(!b.normals||b.autoNormals){const total=b.allIdx.reduce((s,a)=>s+a.length,0);const all=new Uint32Array(total);let o2=0;for(const a of b.allIdx){all.set(a,o2);o2+=a.length;}
b.normals=computeNormals(b.positions,all,b.normals);b.autoNormals=true;}
gl.bindBuffer(gl.ARRAY_BUFFER,b.pos);gl.bufferData(gl.ARRAY_BUFFER,b.positions,gl.DYNAMIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,b.nor);gl.bufferData(gl.ARRAY_BUFFER,b.normals,gl.DYNAMIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,b.uv);gl.bufferData(gl.ARRAY_BUFFER,b.uvs||new Float32Array((b.positions.length/3)*2),gl.STATIC_DRAW);};const api={gl,isGL2,setScene(scene){for(const d of draws){gl.deleteBuffer(d.ibuf);if(d.tex&&d.tex!==white)gl.deleteTexture(d.tex);}
for(const b of vbufs.values()){gl.deleteBuffer(b.pos);gl.deleteBuffer(b.nor);gl.deleteBuffer(b.uv);}
vbufs=new Map();draws=scene.meshes.map((m)=>{const b=vbufFor(m);const ibuf=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibuf);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,m.indices instanceof Uint32Array?m.indices:new Uint32Array(m.indices),gl.STATIC_DRAW);return{b,ibuf,count:m.indices.length,tex:m.texture?makeTexture(m.texture):null,color:m.color||[0.8,0.8,0.8],sheen:m.sheen??0.1,rough:m.roughness??0.6,cull:m.cull||(m.doubleSided===false?'back':null),bias:m.bias||0};});for(const b of vbufs.values())upload(b);api.shadow=scene.shadow||null;},updatePositions(positions,normals){const b=vbufs.get(positions);if(!b)return;if(normals){b.normals=normals;b.autoNormals=false;}
upload(b);},setTexture(index,t){const d=draws[index];if(!d)return;if(d.tex)gl.deleteTexture(d.tex);d.tex=t?makeTexture(t):null;},render(cam,o2={}){const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;gl.viewport(0,0,w,h);const[top,bot]=o2.background||[[0.93,0.94,0.96],[0.8,0.82,0.86]];gl.disable(gl.DEPTH_TEST);gl.useProgram(bg);gl.uniform3fv(gl.getUniformLocation(bg,'uTop'),top);gl.uniform3fv(gl.getUniformLocation(bg,'uBot'),bot);const ap=gl.getAttribLocation(bg,'aP');gl.bindBuffer(gl.ARRAY_BUFFER,bgBuf);gl.enableVertexAttribArray(ap);gl.vertexAttribPointer(ap,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disableVertexAttribArray(ap);gl.enable(gl.DEPTH_TEST);gl.clear(gl.DEPTH_BUFFER_BIT);gl.useProgram(prog);gl.uniformMatrix4fv(U.vp,false,cam.viewProj(w/h));gl.uniform3fv(U.eye,cam.eye);gl.uniform3fv(U.eyeV,cam.eye);const n=(v)=>{const l=Math.hypot(...v);return v.map((x)=>x/l);};gl.uniform3fv(U.ld,LIGHTS.flatMap((l)=>n(l.dir)));gl.uniform3fv(U.lc,LIGHTS.flatMap((l)=>l.color));gl.uniform1fv(U.lk,LIGHTS.map((l)=>l.k));gl.uniform3fv(U.sky,SKY);gl.uniform3fv(U.ground,GROUND);gl.uniform1i(U.sampler,0);gl.activeTexture(gl.TEXTURE0);for(const d of draws){gl.bindBuffer(gl.ARRAY_BUFFER,d.b.pos);gl.enableVertexAttribArray(A.pos);gl.vertexAttribPointer(A.pos,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,d.b.nor);gl.enableVertexAttribArray(A.nor);gl.vertexAttribPointer(A.nor,3,gl.FLOAT,false,0,0);if(A.uv>=0){gl.bindBuffer(gl.ARRAY_BUFFER,d.b.uv);gl.enableVertexAttribArray(A.uv);gl.vertexAttribPointer(A.uv,2,gl.FLOAT,false,0,0);}
gl.bindTexture(gl.TEXTURE_2D,d.tex||white);gl.uniform1f(U.tex,d.tex?1:0);gl.uniform3fv(U.color,d.color);gl.uniform1f(U.sheen,d.sheen);gl.uniform1f(U.rough,d.rough);gl.uniform1f(U.bias,d.bias);if(d.cull){gl.enable(gl.CULL_FACE);gl.cullFace(d.cull==='front'?gl.FRONT:gl.BACK);}else gl.disable(gl.CULL_FACE);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,d.ibuf);gl.drawElements(gl.TRIANGLES,d.count,gl.UNSIGNED_INT,0);}
gl.disable(gl.CULL_FACE);},snapshot(type='image/png'){return canvas.toDataURL(type);},dispose(){for(const d of draws){gl.deleteBuffer(d.ibuf);if(d.tex)gl.deleteTexture(d.tex);}
for(const b of vbufs.values()){gl.deleteBuffer(b.pos);gl.deleteBuffer(b.nor);gl.deleteBuffer(b.uv);}
draws=[];vbufs=new Map();gl.getExtension('WEBGL_lose_context')?.loseContext();},};return api;}
export{createGL};