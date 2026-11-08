const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawn}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parallel-files-')),server=spawn(path.resolve(process.argv[2]),['--no-browser','--port','0','--data-dir',dir],{stdio:'ignore'}),pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let browser;try{
 for(let i=0;i<500&&!fs.existsSync(path.join(dir,'session.json'));i++)await pause(20);
 const session=JSON.parse(fs.readFileSync(path.join(dir,'session.json')));browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(session.url);await page.locator('.studio-matrix').waitFor();await page.waitForFunction(()=>projectInitialised&&!projectBusy);await page.evaluate(()=>projectFlush());
 await page.route('**/api/project/write',async route=>{await pause(400);await route.continue()});
 const downloading=page.waitForEvent('download');const saving=page.evaluate(()=>projectSave());await page.waitForFunction(()=>projectBusy);assert(await page.locator('.app-shell').evaluate(e=>e.inert));
 await page.evaluate(()=>transact('Асинхронная правка во время сохранения',()=>{db.teachers[0].shortName='Проверка А.А.'}));
 await saving;const file=await downloading;await file.saveAs(path.join(dir,'before-edit.parallel'));assert(await page.evaluate(()=>projectModified),'a newer edit was incorrectly marked saved');await page.evaluate(()=>projectFlush());assert(await page.evaluate(()=>projectModified));assert(!await page.locator('.app-shell').evaluate(e=>e.inert));
 const raw=fs.readFileSync(path.join(dir,'before-edit.parallel')).toString('base64');const savedTeacher=await page.evaluate(async data=>{const r=await fetch('/api/project/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});return(await r.json()).state.teachers[0].shortName},raw);assert.notEqual(savedTeacher,'Проверка А.А.','test did not create an older saved snapshot');
 const secondDownload=page.waitForEvent('download');await page.evaluate(()=>projectSave());await secondDownload;assert(!await page.evaluate(()=>projectModified));
 await page.unroute('**/api/project/write');
 // Changes to old workload must remain structurally valid in recovery, including cancelled history.
 await page.evaluate(async()=>{const course=db.courses.find(c=>c.teacherId&&c.weeklyHours);transact('Удаление нагрузки',()=>ProjectModel.removeCourse(db,course.id));await projectFlush();undo();await projectFlush()});
 console.log('PASS: save locks editing, newer asynchronous changes stay dirty, saved snapshot is independent, workload deletion/undo persists through the strict validator');
}finally{if(browser)await browser.close();server.kill();fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
