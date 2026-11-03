/* Small local IPC messages avoid passing megabytes of escaped JSON to WebView2. */
(function(root){
 const toBase64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out)};
 const fromBase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
 async function encode(text){
  if(text.length<32768||typeof CompressionStream==='undefined')return {data:text,encoding:'utf8'};
  const stream=new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return {data:toBase64(new Uint8Array(await new Response(stream).arrayBuffer())),encoding:'gzip/base64'};
 }
 async function decode(content){
  if(!content?.encoding||content.encoding==='utf8')return content?.data||'';
  if(content.encoding!=='gzip/base64')throw Error('Неподдерживаемые данные приложения');
  return new Response(new Blob([fromBase64(content.data)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 }
 root.ParallelWire={encode,decode,toBase64,fromBase64};if(typeof module!=='undefined')module.exports=root.ParallelWire;
})(globalThis);
