/* Native Wails window: OS save dialogs and safe close, no browser or HTTP server. */
if(window.DESKTOP?.native){
 const native=window.go.main.DesktopBridge;
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
 window.runtime.EventsOn('parallel:close-request',async()=>{
  if(closing)return;closing=true;
  try{
   if(saving){message('Завершаю сохранение…');for(let i=0;i<100&&saving;i++)await new Promise(r=>setTimeout(r,100))}
   if(dirty)await persist();
   if(saveError||dirty||saving){message('Окно не закрыто: изменения ещё не сохранены. '+saveError);return}
   await native.Request('/api/shutdown','POST','');
  }finally{closing=false}
 });
 document.documentElement.classList.add('native-window');
 native.Ready();
}
