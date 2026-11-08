/* This file is used only by the installed/portable desktop build. */
(()=>{
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,init={})=>{
  if(typeof input==='string'&&input.startsWith('/api/')){
   if(window.DESKTOP?.native){
    const bridge=window.go?.main?.DesktopBridge;if(!bridge)throw Error('Настольный интерфейс недоступен');
    if(bridge.RequestEncoded&&window.ParallelWire){const encoded=await ParallelWire.encode(init.body||'');const r=await bridge.RequestEncoded(input,init.method||'GET',encoded.data,encoded.encoding);return new Response(await ParallelWire.decode(r.content),{status:r.status,headers:{'Content-Type':'application/json'}})}
    const r=await bridge.Request(input,init.method||'GET',init.body||'');return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json'}});
   }
   const headers=new Headers(init.headers||{});
   headers.set('X-App-Token',window.DESKTOP?.token||'');
   return nativeFetch(input,{...init,headers});
  }
  return nativeFetch(input,init);
 };
})();
