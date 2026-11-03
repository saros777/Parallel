const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'parallel-speed-')),server=spawn(path.resolve(process.argv[2]),['--no-browser','--port','0','--data-dir',temp],{stdio:'ignore'}),wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;try{
 for(let i=0;i<500&&!fs.existsSync(path.join(temp,'session.json'));i++){if(server.exitCode!==null)throw Error('Server exited');await wait(20)}
 const session=JSON.parse(fs.readFileSync(path.join(temp,'session.json')));browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(session.url,{waitUntil:'domcontentloaded'});await p.locator('.studio-matrix').waitFor();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const result=await p.evaluate(async()=>{
  const startupMs=performance.now(),l=studioRows.find(l=>!l.locked&&!l.cancelled&&!l.parked);let started=performance.now();studioTake(l.id);const pickupMs=performance.now()-started;
  while(document.querySelector('.target-pending'))await new Promise(requestAnimationFrame);
  const headersMs=performance.now()-started,td=[...document.querySelectorAll('[data-entity]')].find(td=>td.dataset.entity===l.classId&&!td.querySelector('[data-lesson]')&&!studioAvailability(td).blocked&&!studioAvailability(td).notes.length);
  if(!td)throw Error('No free target in the real database');const other=[...document.querySelectorAll('[data-entity]')].find(e=>e!==td&&!e.querySelector(`[data-lesson="${l.id}"]`));
  const target={date:td.dataset.date,slot:+td.dataset.slot};started=performance.now();studioPlace(td);const dropMs=performance.now()-started;
  if(studioPick)throw Error('Highlighted free target rejected placement');const placed=SM.template(db).find(x=>x.id===l.id);if(placed.slot!==target.slot||placed.date!==target.date)throw Error('Lesson not placed at the requested target');
  const cellReused=other.isConnected;undo();
  return {datedLessons:db.lessons.length,visibleCards:studioRows.length,startupMs:Math.round(startupMs),pickupMs:Math.round(pickupMs),allHeadersMs:Math.round(headersMs),dropMs:Math.round(dropMs),unchangedCellReused:cellReused};
 });
 assert(result.startupMs<3000,'Startup exceeded 3 seconds in the test browser');assert(result.pickupMs<100,'Pickup blocked interaction');assert(result.allHeadersMs<350,'Availability headers took too long');assert(result.dropMs<250,'Placement took too long');assert(result.unchangedCellReused,'Placement rebuilt the entire grid');assert.deepEqual(errors,[]);
 console.log(JSON.stringify(result));if(process.env.PARALLEL_PERFORMANCE_REPORT)fs.writeFileSync(process.env.PARALLEL_PERFORMANCE_REPORT,JSON.stringify({...result,environment:'Linux Chromium; full original database; not a Windows startup measurement'},null,2));
}finally{if(browser)await browser.close();server.kill();fs.rmSync(temp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
