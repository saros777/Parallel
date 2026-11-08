const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
(async()=>{
 const calls=[],events=new Map(),messages=[],readyCalls=[],frames=[],timers=[];
 const bridge={Ready:raw=>readyCalls.push(JSON.parse(raw)),Request:async(path,method,body)=>{calls.push({path,method,body});return {status:path==='/api/state'?409:200,body:path==='/api/state'?'{"error":"stale"}':'{"ok":true}'}},SaveFile:async(name,data)=>{assert.equal(name,'backup.json');assert.equal(Buffer.from(data,'base64').toString(),'saved data');return true}};
 const context={window:{DESKTOP:{native:true},go:{main:{DesktopBridge:bridge}},fetch:async()=>new Response('asset'),runtime:{EventsOn:(name,fn)=>events.set(name,fn)}},document:{addEventListener:(name,fn)=>events.set(name,fn),documentElement:{classList:{add(){}}}},Response,Headers,Blob,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout,message:m=>messages.push(m),dirty:true,saving:false,saveError:'',download:null};
 context.performance={now:()=>42};context.requestAnimationFrame=fn=>frames.push(fn);context.setTimeout=(fn,ms)=>{if(ms===500){timers.push(fn);return}return setTimeout(fn,ms)};
 context.persist=async()=>{context.dirty=false};vm.createContext(context);
 vm.runInContext(fs.readFileSync('ui/desktop-bridge.js','utf8'),context);
 const response=await context.window.fetch('/api/state',{method:'PUT',body:'{}'});assert.equal(response.status,409);assert.equal((await response.json()).error,'stale');assert.deepEqual(calls[0],{path:'/api/state',method:'PUT',body:'{}'});
 assert.equal(await (await context.window.fetch('/engine.js')).text(),'asset');
 vm.runInContext(fs.readFileSync('ui/native.js','utf8'),context);
 await events.get('parallel:workspace-ready')();assert.equal(readyCalls.length,0);timers.shift()();assert.equal(readyCalls[0].renderSignal,'background-timer');frames.shift()();frames.shift()();assert.equal(readyCalls.length,1,'ready must be reported once when frames resume');
 await context.download('backup.json','saved data');assert(messages.includes('Файл сохранён.'));
 calls.length=0;context.dirty=true;context.saveError='disk full';context.persist=async()=>{};await events.get('parallel:close-request')();assert.equal(calls.length,0,'native window must not close after failed save');assert.equal(context.window.parallelClosing,false);
 context.saveError='';context.persist=async()=>{context.dirty=false};await events.get('parallel:close-request')();assert(!context.dirty);assert.equal(calls.at(-1).path,'/api/shutdown');assert.equal(context.window.parallelClosing,true,'new document requests must stay paused after shutdown was accepted');
 console.log('Native transport: IPC response/status, OS file dialog payload, save-before-close, failed-save protection and suspended-frame startup passed');
})().catch(e=>{console.error(e);process.exit(1)});
