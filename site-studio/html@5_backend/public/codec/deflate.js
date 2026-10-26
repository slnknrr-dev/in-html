const toBytes=(input)=>(typeof input==='string'?new TextEncoder().encode(input):input instanceof Uint8Array?input:new Uint8Array(input));async function pipe(bytes,transform){const stream=new Blob([bytes]).stream().pipeThrough(transform);return new Uint8Array(await new Response(stream).arrayBuffer());}
async function compress(input,format='deflate-raw'){return pipe(toBytes(input),new CompressionStream(format));}
async function decompress(input,format='deflate-raw'){return pipe(toBytes(input),new DecompressionStream(format));}
async function deflate(input){return compress(input,'deflate-raw');}
async function inflate(bytes){return new TextDecoder().decode(await decompress(bytes,'deflate-raw'));}
export{deflate,inflate,decompress,compress};