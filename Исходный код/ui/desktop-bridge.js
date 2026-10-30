/* This file is used only by the installed/portable desktop build. */
(()=>{
 const nativeFetch=window.fetch.bind(window);
 window.fetch=(input,init={})=>{
  if(typeof input==='string'&&input.startsWith('/api/')){
   if(window.DESKTOP?.native)return window.go.main.DesktopBridge.Request(input,init.method||'GET',init.body||'').then(r=>new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json'}}));
   const headers=new Headers(init.headers||{});
   headers.set('X-App-Token',window.DESKTOP?.token||'');
   return nativeFetch(input,{...init,headers});
  }
  return nativeFetch(input,init);
 };
})();
