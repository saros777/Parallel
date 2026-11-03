/* Ordinary desktop document commands and reviewed, separate table imports. */
const PM=ProjectModel;
let projectInfo=null,projectModified=false,projectBusy=false,projectMenu=null;
const projectNative=()=>window.DESKTOP?.native?window.go.main.DesktopBridge:null;
function projectTitle(){
 const name=projectInfo?.name||'Без названия.parallel';
 $('#project-name').textContent=(projectModified?'● ':'')+name;$('#project-name').title=projectInfo?.path||'Новое расписание — выберите файл при сохранении';
 document.title=(projectModified?'* ':'')+name+' — Параллель';window.runtime?.WindowSetTitle?.(document.title);
}
window.parallelProjectChanged=()=>{if(!loading){projectModified=true;projectTitle()}};
function projectSetInfo(info){projectInfo=info;if(projectInfo&&!projectInfo.path&&db?.meta?.projectName)projectInfo.name=db.meta.projectName+'.parallel';projectModified=!!info?.modified;projectTitle();if(!loading)renderStatus()}
const projectStatusBefore=renderStatus;
renderStatus=function(){projectStatusBefore();if(connected&&!loading&&!saving&&!dirty&&!saveError)$('#save-state').textContent=projectModified?'Автокопия · '+lastSaved:'Файл сохранён'};
$('.top-actions').insertAdjacentHTML('afterbegin','<button id="project-menu-button" aria-haspopup="menu" aria-expanded="false">Файл ▾</button><span id="project-name"></span>');
$('#open-file').textContent='Открыть';$('#save-file').textContent='Сохранить';$('#file').accept='.parallel,.json';
function projectCloseMenu(){projectMenu?.remove();projectMenu=null;$('#project-menu-button').setAttribute('aria-expanded','false')}
$('#project-menu-button').onclick=e=>{
 e.stopPropagation();if(projectMenu){projectCloseMenu();return}
 const actions=[['new','Новое расписание','Ctrl+N'],['open','Открыть…','Ctrl+O'],['save','Сохранить','Ctrl+S'],['saveas','Сохранить как…','Ctrl+Shift+S'],['import','Импорт таблицы…',''],['export','Экспорт таблиц…','']];
 projectMenu=document.createElement('div');projectMenu.id='project-menu';projectMenu.setAttribute('role','menu');
 projectMenu.innerHTML=actions.map(([id,text,key])=>`<button role="menuitem" data-project-command="${id}">${text}<small>${key}</small></button>`).join('')+(projectInfo?.recent?.length?'<hr><strong>Последние расписания</strong>'+projectInfo.recent.map((p,i)=>`<button role="menuitem" data-project-recent="${i}" title="${h(p)}">${h(p.split(/[\\/]/).at(-1))}</button>`).join(''):'');
 document.body.append(projectMenu);const rect=e.currentTarget.getBoundingClientRect();projectMenu.style.left=Math.max(6,Math.min(innerWidth-300,rect.left))+'px';projectMenu.style.top=(rect.bottom+4)+'px';$('#project-menu-button').setAttribute('aria-expanded','true');
 projectMenu.querySelectorAll('[data-project-command]').forEach(b=>b.onclick=()=>{const command=b.dataset.projectCommand;projectCloseMenu();({new:projectNew,open:projectOpen,save:()=>projectSave(),saveas:()=>projectSave(true),import:projectImportTable,export:projectExportTable})[command]()});
 projectMenu.querySelectorAll('[data-project-recent]').forEach(b=>b.onclick=()=>{const i=+b.dataset.projectRecent;projectCloseMenu();projectOpen(i)});
};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#project-menu,#project-menu-button'))projectCloseMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')projectCloseMenu()});
async function projectFlush(){
 clearTimeout(saveTimer);if(dirty&&!saving)await persist();
 for(let i=0;saving&&i<200;i++)await new Promise(r=>setTimeout(r,25));
 if(dirty&&!saving&&!saveError)await persist();
 if(saving||dirty||saveError)throw Error('Рабочая копия ещё не сохранена. '+saveError);
 clearTimeout(saveTimer);saveAgain=false;
}
async function projectSave(saveAs=false){
 if(projectBusy)return false;projectBusy=true;
 try{
  await projectFlush();const native=projectNative();
  if(native){const info=await native.SaveProject(saveAs);if(info.cancelled)return false;projectSetInfo(info);message('Расписание сохранено: '+info.path)}
  else{db.preferences=settings;const r=await fetch('/api/project/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:db})}),result=await r.json();if(!r.ok)throw Error(result.error);await download((db.meta.projectName||'Расписание')+'.parallel',ParallelWire.fromBase64(result.data),'application/x-parallel-schedule');projectModified=false;projectTitle()}
  return true;
 }catch(e){message('Не удалось сохранить расписание: '+(e.message||e));return false}finally{projectBusy=false}
}
function projectConfirm(){
 if(!projectModified)return Promise.resolve(true);
 return new Promise(resolve=>{
  const element=$('#dialog');let done=false;
  const onClose=()=>{if(!element.open&&!done){done=true;element.removeEventListener('close',onClose);resolve(false)}};
  const finish=value=>{if(done)return;done=true;element.removeEventListener('close',onClose);element.close();resolve(value)};
  dialog('Сохранить изменения расписания?',`<p>Файл: <strong>${h(projectInfo?.name||'Без названия.parallel')}</strong></p><p>Сохраните изменения в отдельный файл, прежде чем продолжить.</p>`,[{text:'Сохранить',class:'primary',action:async()=>{if(await projectSave())finish(true)}},{text:'Продолжить без сохранения',action:()=>finish(true)},{text:'Отмена',action:()=>finish(false)}]);
  $('#dialog-action-0').focus();element.addEventListener('close',onClose);
 });
}
window.parallelBeforeClose=async()=>{
 if(projectBusy)return false;
 if($('#dialog').open){message('Сначала сохраните или закройте текущую карточку.');return false}
 return projectConfirm();
};
function projectAdopt(next,info){
 clearTimeout(saveTimer);studioCancel();db=next;settings={subject:true,teacher:true,room:true,group:true,abbreviate:true,labels:{},...db.preferences};revision=info?.revision??revision;selectedClasses=null;classFilter='';teacherFilter='';selectedLesson=null;route='schedule';studioPeriod='base';date=SM.anchor(db);saveError='';dirty=false;fingerprint=stateMark();projectSetInfo(info||{name:(db.meta.projectName||'Расписание')+'.parallel',modified:false});render();
}
async function projectOpen(index=null){
 if(projectBusy||$('#dialog').open)return;
 try{await projectFlush();if(!await projectConfirm())return;const native=projectNative();if(!native){$('#file').click();return}
  projectBusy=true;const selected=Number.isInteger(index)?await native.ReadRecentProject(index):await native.ReadProject();if(!selected.token)return;
  const next=normalize(JSON.parse(await ParallelWire.decode(selected.content))),info=await native.ActivateProject(selected.token);projectAdopt(next,info);message('Открыто расписание: '+info.path);
 }catch(e){message('Файл не открыт; текущая работа сохранена: '+(e.message||e))}finally{projectBusy=false}
}
async function projectNew(){
 if(projectBusy||$('#dialog').open)return;
 try{await projectFlush();if(!await projectConfirm())return;
  dialog('Новое расписание',`<div class="directory-form"><label>Название<input id="project-new-name" value="Новое расписание"></label><label>Учебный год<input id="project-new-year" value="${h(db.meta.academicYear||'2026-2027')}"></label><label class="checkbox-line full"><input type="checkbox" id="project-copy-directories" checked>Скопировать справочники и нагрузку; все карточки поместить в резерв</label></div><p class="hint">Новое расписание сохраняется в собственный файл. Текущее расписание не заменяется на диске.</p><p class="error" id="project-new-error"></p>`,[{text:'Отмена',action:()=>$('#dialog').close()},{text:'Создать',class:'primary',action:async()=>{try{
   const name=$('#project-new-name').value.trim(),year=$('#project-new-year').value.trim();if(!name)throw Error('Укажите название');const m=year.match(/^(\d{4})\s*[-–/]\s*(\d{4})$/);if(!m||+m[2]!==+m[1]+1)throw Error('Учебный год: например, 2026-2027');
   const next=PM.newProject({...db,preferences:settings},name,m[1]+'-'+m[2],$('#project-copy-directories').checked),native=projectNative(),info=native?await native.NewProject(JSON.stringify(next)):{name:name+'.parallel',modified:true};$('#dialog').close();projectAdopt(next,info);dirty=true;render();message('Создано новое расписание. Выберите «Сохранить», чтобы указать файл.');
  }catch(e){$('#project-new-error').textContent=e.message||String(e)}}}]);
 }catch(e){message(e.message||String(e))}
}
$('#open-file').onclick=()=>projectOpen();$('#save-file').onclick=()=>projectSave();
if(projectNative())$('#exit-application').onclick=()=>window.parallelClose();
$('#file').onchange=async e=>{
 const file=e.target.files[0];if(!file)return;
 try{await projectFlush();if(!await projectConfirm())return;const bytes=new Uint8Array(await file.arrayBuffer()),r=await fetch('/api/project/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:ParallelWire.toBase64(bytes)})}),result=await r.json();if(!r.ok)throw Error(result.error);projectAdopt(normalize(result.state),{name:file.name,modified:false});dirty=true;await persist();message('Открыто: '+file.name)}catch(error){message('Импорт не выполнен: '+error.message)}finally{e.target.value=''}
};
document.addEventListener('keydown',e=>{
 if(!(e.ctrlKey||e.metaKey)||!['s','o','n'].includes(e.key.toLowerCase()))return;
 e.preventDefault();e.stopImmediatePropagation();projectCloseMenu();const key=e.key.toLowerCase();
 if($('#dialog').open){if(key==='s'&&!e.shiftKey)$('#dialog .dialog-footer .primary')?.click();else message('Завершите редактирование текущей карточки.');return}
 if(key==='s')projectSave(e.shiftKey);if(key==='o')projectOpen();if(key==='n')projectNew();
},true);
async function projectWriteBook(book,format){
 const native=projectNative();if(native)return native.WriteSpreadsheet(JSON.stringify(book),format);
 const r=await fetch('/api/spreadsheet/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({book,format})}),result=await r.json();if(!r.ok)throw Error(result.error);await download('Расписание_данные.'+format,ParallelWire.fromBase64(result.data),format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv');return true;
}
function projectExportTable(template=false){
 const kinds=Object.keys(PM.names),preferred=route==='directory'?(studioDirectory==='courses'?'courses':studioDirectory):'base';
 dialog(template?'Шаблон таблиц':'Экспорт отдельных данных',`<div class="export-kinds">${kinds.map(k=>`<label class="checkbox-line"><input type="checkbox" data-export-kind="${k}" ${template||k===preferred?'checked':''}>${PM.names[k]}</label>`).join('')}</div><label>Формат<select id="table-export-format"><option value="xlsx">Excel XLSX — каждый раздел на своём листе</option><option value="csv">CSV — один выбранный раздел</option></select></label><p class="hint">В XLSX сохраняются понятные названия и постоянные ID. Датированные уроки экспортируются за выбранную неделю. Импорт сначала показывает изменения и ошибки.</p><p class="error" id="table-export-error"></p>`,[{text:'Отмена',action:()=>$('#dialog').close()},{text:template?'Сохранить шаблон':'Экспортировать',class:'primary',action:async()=>{try{
  const selected=$$('[data-export-kind]:checked').map(x=>x.dataset.exportKind),format=$('#table-export-format').value;if(!selected.length)throw Error('Выберите хотя бы один раздел');if(format==='csv'&&selected.length!==1)throw Error('Для CSV выберите один раздел');
  const source=template?{classes:[],teachers:[],subjects:[],rooms:[],courses:[],groups:[],lessons:[],preferences:{},meta:db.meta}:({...db,preferences:settings}),from=studioPeriod==='base'?SM.anchor(db):monday(date),book=PM.exportBook(source,selected,{from,to:SM.add(from,6)});
  if(await projectWriteBook(book,format)){$('#dialog').close();message(template?'Шаблон сохранён.':'Таблицы сохранены.')}
 }catch(e){$('#table-export-error').textContent=e.message||String(e)}}}]);
}
async function projectImportTable(){
 try{
  const native=projectNative();if(native){const content=await native.ReadSpreadsheet();if(!content.data)return;projectImportPreview(JSON.parse(await ParallelWire.decode(content)));return}
  const input=document.createElement('input');input.type='file';input.accept='.xlsx,.csv,.tsv';input.id='table-file-input';input.hidden=true;document.body.append(input);input.onchange=async()=>{try{const f=input.files[0];if(!f)return;const r=await fetch('/api/spreadsheet/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name,data:ParallelWire.toBase64(new Uint8Array(await f.arrayBuffer()))})}),result=await r.json();if(!r.ok)throw Error(result.error);projectImportPreview(result)}catch(e){message('Таблица не импортирована: '+e.message)}finally{input.remove()}};input.click();
 }catch(e){message('Таблица не открыта: '+(e.message||e))}
}
function projectImportPreview(book){
 const infer=name=>Object.entries(PM.names).find(([k,n])=>n.toLowerCase()===name.toLowerCase())?.[0]||null;
 let plan,collisionCount=0;const known=book.sheets.filter(s=>infer(s.name));
 dialog('Импорт таблицы — предварительная проверка',`<div class="directory-form"><label>Лист<select id="table-import-sheet">${known.length>1?'<option value="all">Все известные листы</option>':''}${book.sheets.map((s,i)=>`<option value="${i}">${h(s.name)}</option>`).join('')}</select></label><label>Раздел<select id="table-import-kind">${Object.entries(PM.names).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label></div><div id="table-import-preview"></div><label class="checkbox-line" id="table-import-force-label" hidden><input type="checkbox" id="table-import-force">Применить с указанными пересечениями</label>`,[{text:'Отмена',action:()=>$('#dialog').close()},{text:'Применить изменения',class:'primary',action:()=>{
  if(!plan||plan.issues.length||collisionCount&&!$('#table-import-force').checked)return;
  transact('Импорт таблиц',()=>{for(const k of [...PM.fields,'overrides','baseSchedule'])db[k]=plan.next[k];settings=plan.next.preferences;db.preferences=settings});$('#dialog').close();message(`Импорт: добавлено ${plan.counts.added}, обновлено ${plan.counts.updated}.`);
 }}]);
 const sheet=$('#table-import-sheet'),kind=$('#table-import-kind');kind.value=route==='directory'&&PM.names[studioDirectory]?studioDirectory:infer(book.sheets[0].name)||'teachers';
 function preview(){
  const all=sheet.value==='all';kind.disabled=all;const selections=all?book.sheets.filter(s=>infer(s.name)).map(s=>({kind:infer(s.name),sheet:s})):[{kind:kind.value,sheet:book.sheets[+sheet.value]}];
  plan=PM.importPlan({...db,preferences:settings},selections);collisionCount=0;
  if(!plan.issues.length&&selections.some(x=>['base','dated','courses'].includes(x.kind))){const from=SM.anchor(db),to=SM.add(from,6),context=x=>({...x,basePreview:true,baseSchedule:null,lessons:SM.template(x),overrides:{},extraLessons:[]}),old=E.conflicts(context(db)),next=E.conflicts(context(plan.next)),ids=new Set(old.map(i=>i.kind+'|'+i.lessonIds.slice().sort().join('|')));collisionCount=next.filter(i=>!ids.has(i.kind+'|'+i.lessonIds.slice().sort().join('|'))).length}
  $('#table-import-preview').innerHTML=`<p><strong>Добавится: ${plan.counts.added}</strong> · обновится: ${plan.counts.updated} · без изменений: ${plan.counts.unchanged}</p>${plan.issues.length?`<div class="import-issues"><strong>Исправьте ошибки (${plan.issues.length})</strong><ul>${plan.issues.slice(0,30).map(e=>`<li>${h(e)}</li>`).join('')}</ul></div>`:''}${collisionCount?`<p class="error">Новых пересечений в основном расписании: ${collisionCount}. Проверьте назначения учителей, классов и кабинетов.</p>`:''}<div class="import-preview-table"><table class="data-table"><thead><tr><th>Лист / строка</th><th>Запись</th><th>Действие</th></tr></thead><tbody>${plan.preview.slice(0,30).map(r=>`<tr><td>${h(r.sheet)} · ${r.row}</td><td>${h(r.name)}</td><td>${{added:'Добавить',updated:'Обновить',unchanged:'Без изменений'}[r.result]}</td></tr>`).join('')}</tbody></table></div><p class="hint">Существующие записи связываются по ID или названию. Ничего не удаляется автоматически. До нажатия «Применить» рабочие данные не меняются.</p>`;
  $('#table-import-force-label').hidden=!collisionCount;$('#dialog-action-1').disabled=!!plan.issues.length||!(plan.counts.added+plan.counts.updated)||!!collisionCount&&!$('#table-import-force').checked;
 }
 sheet.onchange=()=>{if(sheet.value!=='all')kind.value=infer(book.sheets[+sheet.value].name)||kind.value;preview()};kind.onchange=preview;$('#table-import-force').onchange=preview;preview();
}
renderData=function(){
 $('#heading-actions').innerHTML='';$('#view').innerHTML=`<div class="project-data-grid"><section class="panel"><h2>Файл расписания</h2><p><strong>${h(projectInfo?.name||'Без названия.parallel')}</strong></p><p class="project-path">${h(projectInfo?.path||'Файл ещё не выбран')}</p><div class="project-actions"><button id="data-project-new">Новое</button><button id="data-project-open">Открыть…</button><button id="data-project-save" class="primary">Сохранить</button><button id="data-project-saveas">Сохранить как…</button></div><p>Каждое расписание — отдельный файл <strong>.parallel</strong>. Можно хранить несколько вариантов, копировать файл на флешку и открывать его на другом компьютере. Автовосстановление не заменяет команду сохранения в выбранный файл.</p></section><section class="panel"><h2>Excel и отдельные данные</h2><div class="project-actions"><button id="data-table-import">Импорт XLSX / CSV…</button><button id="data-table-export" class="primary">Экспорт…</button><button id="data-table-template">Шаблон XLSX…</button></div><p>Учителя, классы, предметы, кабинеты, подгруппы, нагрузка и карточки расписания импортируются отдельно. Перед применением показываются изменения и ошибки. XLSX не требует установленного Excel.</p></section><section class="panel"><h2>Восстановление</h2><p>Рабочая копия автоматически записывается на этот компьютер; при закрытии программа предложит сохранить изменения в файл. Предыдущие рабочие версии хранятся в папке backups.</p><button id="project-recovery-folder">Открыть папку восстановления</button> <button id="project-json-backup">Экспорт JSON-копии</button><p>Старые JSON-файлы открываются через «Открыть». При сохранении для них создаётся файл .parallel; исходный JSON не перезаписывается.</p></section></div>`;
 $('#data-project-new').onclick=projectNew;$('#data-project-open').onclick=()=>projectOpen();$('#data-project-save').onclick=()=>projectSave();$('#data-project-saveas').onclick=()=>projectSave(true);$('#data-table-import').onclick=projectImportTable;$('#data-table-export').onclick=()=>projectExportTable();$('#data-table-template').onclick=()=>projectExportTable(true);$('#project-recovery-folder').onclick=()=>fetch('/api/open-folder',{method:'POST'});$('#project-json-backup').onclick=()=>download('Расписание_резервная-копия.json',JSON.stringify({...db,preferences:settings}));
};
document.addEventListener('parallel:workspace-ready',async()=>{
 const native=projectNative();if(native){projectSetInfo(await native.ProjectInfo());const pending=await native.PendingProject();if(pending.token){if(await projectConfirm()){try{const next=normalize(JSON.parse(await ParallelWire.decode(pending.content))),info=await native.ActivateProject(pending.token);projectAdopt(next,info)}catch(e){message('Файл не открыт: '+e.message)}}}}
 else projectSetInfo({name:(db.meta.projectName||'Расписание')+'.parallel',modified:true,recent:[]});
}, {once:true});
if(projectNative())window.runtime.EventsOn('parallel:project-request',async selected=>{try{await projectFlush();if(!await projectConfirm())return;const next=normalize(JSON.parse(await ParallelWire.decode(selected.content))),info=await projectNative().ActivateProject(selected.token);projectAdopt(next,info)}catch(e){message('Файл не открыт: '+e.message)}});
