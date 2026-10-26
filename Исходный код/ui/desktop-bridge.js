/* This file is used only by the installed/portable desktop build. */
(()=>{
 const nativeFetch=window.fetch.bind(window);
 window.fetch=(input,init={})=>{
  if(typeof input==='string'&&input.startsWith('/api/')){
   const headers=new Headers(init.headers||{});
   headers.set('X-App-Token',window.DESKTOP?.token||'');
   return nativeFetch(input,{...init,headers});
  }
  return nativeFetch(input,init);
 };
})();
