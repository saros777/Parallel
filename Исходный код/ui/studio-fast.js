/* Reuse existing cells and resolve a target day once, rather than the whole year. */
let studioPaintShape=null,studioFitFrame=0,studioConflictKeys=new Set();
const studioTextCache=new Map(),studioMeasureCanvas=document.createElement('canvas'),studioMeasureContext=studioMeasureCanvas.getContext('2d');
function studioTextMeasure(text){if(!studioTextCache.has(text)){if(studioMeasureContext)studioMeasureContext.font='400 100px Inter, Arial, sans-serif';studioTextCache.set(text,Math.max(.5,studioMeasureContext?studioMeasureContext.measureText(text).width/100:[...text].length*.65).toFixed(3))}return studioTextCache.get(text)}
const studioFitImmediate=studioFit;
studioFit=function(){if(!studioFitFrame)studioFitFrame=requestAnimationFrame(()=>{
 studioFitFrame=0;if(!CSS.supports('container-type','size')){studioFitImmediate();return}
 const workspace=$('#studio-workspace'),grid=$('.studio-grid');if(!workspace||!grid)return;
 workspace.style.setProperty('--side-width',studioSide+'px');workspace.style.setProperty('--bottom-height',studioBottom+'px');
 const width=grid.clientWidth,height=grid.clientHeight,n=Math.max(20,studioEntities.length),entity=studioAxis==='teachers'?110:44,stamp=[width,height,n,entity,studioSlots].join('|');if(workspace.__fitStamp===stamp)return;workspace.__fitStamp=stamp;
 const row=Math.max(1,(height-36)/n-1),cell=Math.max(1,(width-entity)/(studioSlots*5));
 workspace.style.setProperty('--rows',n);workspace.style.setProperty('--slots',studioSlots);workspace.style.setProperty('--columns',studioSlots*5);workspace.style.setProperty('--entity-width',entity+'px');workspace.style.setProperty('--row-height',row+'px');workspace.style.setProperty('--card-width',cell+'px');workspace.style.setProperty('--card-height',Math.min(24,row)+'px');workspace.style.setProperty('--card-font',Math.max(6,Math.min(16,row*.8,cell/2.3))+'px');
})};
function studioShape(){return JSON.stringify([studioPeriod,studioAxis,studioDates,studioSlots,studioEntities.map(e=>e.id)])}
function studioCanReuseView(){const reuse=!!$('#studio-workspace')&&!!$('#studio-undo')&&studioPaintShape===studioShape();if(!reuse)studioPaintShape=null;return reuse}
function studioCellHTML(paint,td){const ls=E.sortProfileRows(paint.index.get([td.dataset.entity,td.dataset.date,td.dataset.slot].join('|'))||[],db);return ls.map(l=>card({...l,placementForced:l.placementForced||paint.problemIds.has(l.id)})).join('')}
function studioRememberCells(paint){
 studioConflictKeys=new Set(paint.problems.map(i=>i.kind+'|'+i.lessonIds.slice().sort().join('|')));
 studioPaintShape=studioShape();$$('[data-entity]').forEach(td=>td.__studioHTML=studioCellHTML(paint,td));
 for(const [area,rows]of [['side',paint.side],['bottom',paint.bottom]])$('#studio-'+area).__studioHTML=studioTray(area,rows);
}
function studioUpdateExisting(paint){
 if(!$('#studio-workspace')||studioPaintShape!==studioShape())return false;
 studioConflictKeys=new Set(paint.problems.map(i=>i.kind+'|'+i.lessonIds.slice().sort().join('|')));
 $$('[data-entity]').forEach(td=>{const html=studioCellHTML(paint,td);if(td.__studioHTML!==html){const stack=td.querySelector('.studio-stack');stack.innerHTML=html;stack.style.setProperty('--parts',Math.max(1,stack.children.length));td.__studioHTML=html}});
 for(const [area,rows]of [['side',paint.side],['bottom',paint.bottom]]){const el=$('#studio-'+area),html=studioTray(area,rows);if(el.__studioHTML!==html){el.innerHTML=html;el.__studioHTML=html}}
 $('#studio-undo').disabled=!db.history.length;$('#studio-warnings').textContent=paint.problems.length+' замечаний';
 if($('#date'))$('#date').value=date;
 $$('[data-tray-sort]').forEach(s=>s.onchange=()=>{studioFilters[s.dataset.traySort]=s.value;render()});
 bindCards();studioFit();return true;
}
const studioTakeIndexed=studioTake;
studioTake=function(id){
 studioTakeIndexed(id);if(!studioPick)return;
 studioPick.source=new Map(studioRows.map(l=>[l.id,l]));studioPick.byDay=new Map();
 for(const l of studioRows){if(!studioPick.byDay.has(l.date))studioPick.byDay.set(l.date,[]);studioPick.byDay.get(l.date).push(l)}
 studioPick.existing=studioConflictKeys;
};
studioAvailability=function(td){
 const cacheKey=td.dataset.entity+'|'+td.dataset.date+'|'+td.dataset.slot;if(studioPick.cache.has(cacheKey))return studioPick.cache.get(cacheKey);
 const notes=[],old=studioPick.source.get(studioPick.id),axis=studioAxis==='teachers'?'teacherId':studioAxis==='rooms'?'roomId':'classId';
 if(old[axis]!==td.dataset.entity){const r={blocked:true,notes:['Карточка относится к другой строке']};studioPick.cache.set(cacheKey,r);return r}
 const members=old.blockId?studioRows.filter(l=>l.blockId===old.blockId&&l.date===old.date):[old],ids=new Set(members.map(l=>l.id)),d=td.dataset.date;
 const patches=members.map(l=>({id:l.id,before:l,after:{...l,date:d,slot:+td.dataset.slot+(l.blockOffset||0)-(old.blockOffset||0),parked:false,suspended:false,parkingArea:null}}));
 if(members.some(l=>l.locked)){const result={blocked:true,notes:['Сначала снимите закрепление всех уроков спарки']};studioPick.cache.set(cacheKey,result);return result}
 if(patches.some(p=>p.after.slot<1||p.after.slot>studioSlots)){const r={blocked:true,notes:['Блок не помещается в этот день']};studioPick.cache.set(cacheKey,r);return r}
 const targetSlots=new Set(patches.map(p=>p.after.slot));for(const p of patches)p.after.absenceReturnFor=E.absenceFor(p.after,studioWork)?.id||null;
 const local={...studioWork,baseSchedule:null,lessons:(studioPick.byDay.get(d)||[]).filter(l=>targetSlots.has(l.slot)),overrides:{},extraLessons:[],calendar:studioWork.calendar.filter(c=>c.date===d)};
 const rows=local.preferences?.roomPolicy?.enabled?E.effective(E.patchedDB(local,patches)):[...local.lessons.filter(l=>!ids.has(l.id)),...patches.map(p=>p.after)],moved=rows.filter(l=>ids.has(l.id));
 for(const issue of E.conflicts(local,rows))if(!studioPick.existing.has(issue.kind+'|'+issue.lessonIds.slice().sort().join('|')))notes.push(issue.kind);
 for(const candidate of moved){
  for(const kind of SM.restrictions(candidate,local))notes.push(kind);
  if(E.absenceFor(candidate,local))notes.push('Учитель отмечен отсутствующим');
  if(local.calendar.some(c=>c.classId===candidate.classId&&c.isHoliday))notes.push('Неучебный день');
  if(local.preferences?.roomPolicy?.enabled&&candidate.roomMode==='auto'&&!candidate.roomId&&!studioPick.existing.has('Нет свободного кабинета|'+candidate.id))notes.push('Нет свободного кабинета');
 }
 const result={notes:[...new Set(notes)]};studioPick.cache.set(cacheKey,result);return result;
};
