/* Native Wails window: OS save dialogs and safe close, no browser or HTTP server. */
if(window.DESKTOP?.native){
 const native=window.go?.main?.DesktopBridge;
 if(!native||!window.runtime?.EventsOn){
  const shell=document.querySelector('.app-shell');if(shell)shell.inert=true;
  const alert=document.createElement('p');alert.setAttribute('role','alert');alert.textContent='Не удалось подключить настольный интерфейс. Закройте окно и запустите программу снова. Данные на диске не изменены.';document.body.append(alert);
 }else{
 window.addEventListener?.('error',e=>native.LogFrontendError?.(String(e.error?.stack||e.message)));
 window.addEventListener?.('unhandledrejection',e=>native.LogFrontendError?.(String(e.reason?.stack||e.reason)));
 download=async function(name,data,type='application/json'){
  try{
   const blob=data instanceof Blob?data:new Blob([data],{type});
   const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
   for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   const saved=await native.SaveFile(name,btoa(binary));
   message(saved?'Файл сохранён.':'Сохранение файла отменено.');return saved;
  }catch(e){message('Не удалось сохранить файл: '+e);return false}
 };
 let closing=false;
 window.parallelClose=async()=>{
  if(closing)return;closing=true;
  try{
   if(saving){message('Завершаю сохранение…');for(let i=0;i<100&&saving;i++)await new Promise(r=>setTimeout(r,100))}
   if(dirty)await persist();
   if(saveError||dirty||saving){message('Окно не закрыто: изменения ещё не сохранены. '+saveError);return}
   if(window.parallelBeforeClose&&!await window.parallelBeforeClose())return;
   await native.Request('/api/shutdown','POST','');
  }finally{closing=false}
 };
 window.runtime.EventsOn('parallel:close-request',window.parallelClose);
 document.documentElement.classList.add('native-window');
 document.addEventListener('parallel:workspace-ready',async()=>{
  if(await window.parallelProjectReady===false)return;
  let signalled=false;const signal=kind=>{if(signalled)return;signalled=true;native.Ready(JSON.stringify({...window.parallelStartup,signalMs:performance.now(),renderSignal:kind,visibility:document.visibilityState}))};
  requestAnimationFrame(()=>requestAnimationFrame(()=>signal('animation-frame')));
  // A minimised or occluded WebView may suspend animation frames entirely.
  setTimeout(()=>signal('background-timer'),500);
 },{once:true});
}

}
