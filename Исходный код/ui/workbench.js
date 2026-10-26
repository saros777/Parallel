/* Dense teacher-coloured board, reversible parking tray and explicit conflict overrides. */
const W=WorkbenchEngine;
let wbDrag=null,wbActive=null,wbMode='single';
function wbNumber(l){return String(PrintTools.roomNumber(l.roomId?roomName(l.roomId):'')).match(/^\d+/)?.[0]||'—'}
function wbBrief(l){return `${displaySubject(l,true)} · ${lookup('classes',l.classId)?.name||''} · ${short(teacherName(l.teacherId))} · ${wbNumber(l)}`}
function wbLabel(l){
 if(settings.labels?.[l.subjectId])return settings.labels[l.subjectId];
 const name=lookup('subjects',l.subjectId)?.name||'';
 const labels=[[/^Русский язык$/,'р/я'],[/Иностранный язык.*английский/i,'а/я'],[/Иностранный язык.*немецкий/i,'н/я'],[/^Литературное чтение$/,'л/ч'],[/^Литература$/,'л'],[/^Математика$/,'м'],[/^Алгебра/,'А'],[/^Геометрия$/,'Г'],[/^Вероятность/,'ВиС'],[/^Физическая культура$/,'ФК'],[/^Физика$/,'ф'],[/^Химия$/,'х'],[/^Биология$/,'б'],[/^История/,'и'],[/^Обществознание$/,'общ'],[/^Изобразительное/,'ИЗО'],[/^Окружающий/,'ОМ'],[/^Музыка$/,'муз'],[/^(Труд|Технология)/,'Т']];
 return labels.find(([re])=>re.test(name))?.[1]||displaySubject(l,true);
}
const wbCardBefore=card;
card=function(l){
 const el=document.createElement('template');el.innerHTML=wbCardBefore(l);
 const card=el.content.firstElementChild;if(!card)return '';
 card.style.setProperty('--subject-color',W.teacherColor(l.teacherId,db));
 if(compact&&settings.abbreviate&&(Number(settings.boardWidth)||58)<=58){const strong=card.querySelector('.compact-line strong');if(strong)strong.textContent=wbLabel(l)}
 card.title=wbBrief(l);card.setAttribute('aria-label',wbBrief(l));card.dataset.teacher=l.teacherId||'';
 card.querySelectorAll('.compact-status,.tag').forEach(x=>x.remove());
 return card.outerHTML;
};
function wbCommit(title,patches,forced=false){
 $('#dialog').close();
 transact((forced?'С предупреждениями: ':'')+title,()=>patches.forEach(p=>db.overrides[p.id]={...db.overrides[p.id],...p.after,placementForced:forced}));
}
function wbConfirm(title,raw){
 const {patches,issues}=W.assess(db,raw);
 const names=[...new Set(issues.map(i=>i.kind))];
 dialog(title,`<ul>${patches.map(p=>`<li>${h(wbBrief(p.before))}: ${p.before.parked?'резерв':h(p.before.date)+' / '+p.before.slot} → <strong>${p.after.parked?'резерв':h(p.after.date)+' / '+p.after.slot}</strong></li>`).join('')}</ul>${names.length?`<div class="wb-warning"><strong>Обнаружены несоответствия</strong><ul>${names.map(n=>`<li>${h(n)}</li>`).join('')}</ul><p>Можно игнорировать их и разместить карточку. Пересечения останутся видны в контроле и отмечены рамкой.</p></div>`:'<p>Новых пересечений не обнаружено.</p>'}`,
 [{text:'Отменить действие',action:()=>$('#dialog').close()},{text:names.length?'Игнорировать и разместить':'Применить',class:'primary',action:()=>wbCommit(title,patches,!!names.length)}]);
}
function wbDrop(id,td,targetId,action='swap'){
 const old=E.effective(db).find(l=>l.id===id);
 if(!old||old.classId!==td.dataset.cellClass){message('Карточка остаётся в своём классе. Выберите слот этой строки.');return}
 if(!old.parked&&old.date===td.dataset.cellDate&&old.slot===+td.dataset.cellSlot)return;
 try{
  const build=chosen=>W.plan(db,id,td.dataset.cellDate,+td.dataset.cellSlot,{targetId,action:chosen,block:wbMode==='block'});
  if(targetId){
   const target=E.effective(db).find(l=>l.id===targetId);
   dialog('Слот занят',`<p><strong>${h(wbBrief(old))}</strong></p><p>На выбранной карточке: ${h(wbBrief(target))}.</p><p>Обмен меняет позиции карточек. «Вытеснить в резерв» оставит прежний урок в нижней панели, не удаляя его. «Поместить вместе» сохранит обе записи и проверит пересечения.</p>`,
   [{text:'Отмена',action:()=>$('#dialog').close()},{text:old.parked?'Вытеснить в резерв':'Поменять местами',class:'primary',action:()=>{try{wbConfirm('Обмен карточками',build('swap'))}catch(e){message(e.message);$('#dialog').close()}}},...(!old.parked?[{text:'Вытеснить в резерв',action:()=>{try{wbConfirm('Размещение и резерв',build('stash'))}catch(e){message(e.message);$('#dialog').close()}}}]:[]),{text:'Поместить вместе',action:()=>{try{wbConfirm('Совместное размещение',build('together'))}catch(e){message(e.message);$('#dialog').close()}}}]);
  }else wbConfirm('Перенос карточки',build(action));
 }catch(e){message(e.message)}
}
function wbCross(td){
 $$('.wb-cross,.wb-active-cell').forEach(x=>x.classList.remove('wb-cross','wb-active-cell'));
 if(!td)return;
 const table=td.closest('table'),index=td.cellIndex;td.classList.add('wb-active-cell');
 [...td.parentElement.children].forEach(x=>x.classList.add('wb-cross'));
 table.querySelectorAll('tbody tr').forEach(tr=>tr.children[index]?.classList.add('wb-cross'));
 table.querySelectorAll('.period-header')[index-1]?.classList.add('wb-cross');
}
function wbClearDrag(){
 wbDrag=null;dragId=null;$$('.wb-drop-ok,.wb-drop-warn,.wb-drop-block,.wb-drop-hover').forEach(x=>x.classList.remove('wb-drop-ok','wb-drop-warn','wb-drop-block','wb-drop-hover'));
 $('#wb-drag-note')?.replaceChildren(document.createTextNode('Перетащите урок в слот или в резерв. Несоответствия можно подтвердить вручную.'));
 $('#wb-tooltip')?.remove();$('#wb-tray')?.classList.remove('wb-drop-hover');
}
function wbBind(){
 const rows=E.effective(db),byId=new Map(rows.map(l=>[l.id,l]));
 $$('.matrix [data-lesson],#wb-tray [data-lesson]').forEach(el=>{
  const l=byId.get(el.dataset.lesson);if(!l)return;
  el.ondragstart=e=>{
   if(l.locked||l.cancelled){e.preventDefault();message('Сначала снимите закрепление урока.');return}
   wbDrag={id:l.id,profile:el.dataset.profileOrigin||null,cache:new Map()};dragId=l.id;e.dataTransfer.setData('text/plain',l.id);e.dataTransfer.effectAllowed='move';
   $('#wb-tooltip')?.remove();const dates=mode==='week'?Array.from({length:5},(_,i)=>E.addDays(monday(date),i)):[date];
   const local=W.slice(db,[l.date,...dates]);wbDrag.local=local;
   $$('.drop-cell').forEach(td=>{
    if(td.dataset.cellClass!==l.classId){td.classList.add('wb-drop-block');return}
    const target=td.querySelector('[data-lesson]')?.dataset.lesson;
    try{const result=W.assess(local,W.plan(local,l.id,td.dataset.cellDate,+td.dataset.cellSlot,{targetId:target,block:wbMode==='block',timingDB:db}));td.classList.add(result.issues.length?'wb-drop-warn':'wb-drop-ok')}
    catch{td.classList.add('wb-drop-block')}
   });
   $('#wb-drag-note').textContent='Зелёная рамка: без новых пересечений. Штриховка: требуется подтверждение. Серый фон: другой класс или закрепление.';
  };
  el.ondragend=wbClearDrag;
  el.addEventListener('pointerenter',()=>{
   if(wbDrag)return;
   $('#wb-tooltip')?.remove();const box=document.createElement('div');box.id='wb-tooltip';box.role='tooltip';box.textContent=wbBrief(l);document.body.append(box);
   const r=el.getBoundingClientRect();box.style.left=Math.max(8,Math.min(r.left,innerWidth-box.offsetWidth-8))+'px';box.style.top=(r.bottom+box.offsetHeight+8<innerHeight?r.bottom+5:Math.max(5,r.top-box.offsetHeight-5))+'px';
  });
  el.addEventListener('pointerleave',()=>$('#wb-tooltip')?.remove());
  const click=el.onclick;el.onclick=e=>{wbActive=el.closest('td');wbCross(wbActive);click?.(e)};
 });
 $$('.drop-cell').forEach(td=>{
  td.onpointerenter=()=>{if(!wbDrag)wbCross(td)};
  td.onpointerleave=()=>{if(!wbDrag)wbCross(wbActive?.isConnected?wbActive:null)};
  td.ondragover=e=>{
   e.preventDefault();td.classList.add('wb-drop-hover');const l=byId.get(wbDrag?.id);e.dataTransfer.dropEffect=l?.classId===td.dataset.cellClass?'move':'none';
   if(!l||l.classId!==td.dataset.cellClass)return;
   const target=e.target.closest('[data-lesson]')?.dataset.lesson,key=[td.dataset.cellDate,td.dataset.cellSlot,target||''].join('|');
   if(!wbDrag.cache.has(key)){
    try{const result=W.assess(wbDrag.local,W.plan(wbDrag.local,l.id,td.dataset.cellDate,+td.dataset.cellSlot,{targetId:target,block:wbMode==='block',timingDB:db}));wbDrag.cache.set(key,{blocked:false,notes:[...new Set(result.issues.map(i=>i.kind))]})}
    catch(error){wbDrag.cache.set(key,{blocked:true,notes:[error.message]})}
   }
   const result=wbDrag.cache.get(key);td.classList.remove('wb-drop-ok','wb-drop-warn','wb-drop-block');td.classList.add(result.blocked?'wb-drop-block':result.notes.length?'wb-drop-warn':'wb-drop-ok');
   $('#wb-drag-note').textContent=result.notes.length?result.notes.join('; ')+(result.blocked?'':'. При размещении можно подтвердить игнорирование.'):'Для выбранной карточки новых пересечений не обнаружено.';
  };
  td.ondragleave=()=>td.classList.remove('wb-drop-hover');
  td.ondrop=e=>{
   e.preventDefault();e.stopPropagation();const id=wbDrag?.id||e.dataTransfer.getData('text/plain'),old=byId.get(id),origin=wbDrag?.profile;
   const lane=e.target.closest('[data-profile-target]'),target=e.target.closest('[data-lesson]')?.dataset.lesson;
   if(old&&lane&&origin&&old.date===td.dataset.cellDate&&old.slot===+td.dataset.cellSlot&&old.classId===td.dataset.cellClass&&origin!==lane.dataset.profileTarget){
    const profile=lane.dataset.profileTarget,occupant=target?byId.get(target):null;wbClearDrag();
    if(old.locked||occupant?.locked){message('Сначала снимите закрепление урока.');return}
    if(E.profileAudience(old,db).length===1&&occupant&&occupant.id!==old.id&&E.profileAudience(occupant,db).length===1)confirmProfilePatches([profilePatch(old,[profile]),profilePatch(occupant,[origin])],'Обмен профилями');
    else showProfiles(id,E.classProfiles(old,db).filter(p=>p===profile||(E.profileAudience(old,db).includes(p)&&p!==origin)));
    return;
   }
   wbClearDrag();wbDrop(id,td,target&&target!==id?target:null);
  };
 });
 const tray=$('#wb-tray');
 tray.ondragover=e=>{e.preventDefault();tray.classList.add('wb-drop-hover')};
 tray.ondragleave=()=>tray.classList.remove('wb-drop-hover');
 tray.ondrop=e=>{e.preventDefault();const id=wbDrag?.id||e.dataTransfer.getData('text/plain');wbClearDrag();try{wbConfirm('Убрать в резерв',W.park(db,id,wbMode==='block'))}catch(err){message(err.message)}};
}
// The workbench owns drop dispatch; profile editing itself is reused.
bindProfileDrops=function(){};
const wbSchedule=renderSchedule;
renderSchedule=function(){
 $('#wb-tooltip')?.remove();wbActive=null;wbSchedule();
 const table=$('.matrix'),daysCount=mode==='week'?5:1,slots=$$('.period-header').length;
 const width=Number(settings.boardWidth)||58,entityWidth=axis==='classes'?46:148;
 table.style.width=(entityWidth+slots*width)+'px';table.style.minWidth='0';table.style.maxWidth='none';
 const cols=document.createElement('colgroup');cols.innerHTML=`<col style="width:${entityWidth}px">${Array.from({length:slots},()=>`<col style="width:${width}px">`).join('')}`;table.prepend(cols);
 $('.matrix-scroll').classList.add('wb-board');
 $('#controls .ribbon').insertAdjacentHTML('beforeend',`<label class="wb-size">Ячейка <select id="wb-size"><option value="48">48</option><option value="58">58</option><option value="72">72</option><option value="92">92</option></select></label><select id="wb-drag-mode" aria-label="Режим перетаскивания"><option value="single">Одна карточка</option><option value="block">Весь слот</option></select>`);
 $('#wb-size').value=String(width);$('#wb-size').onchange=e=>{settings.boardWidth=+e.target.value;dirty=true;render()};
 $('#wb-drag-mode').value=wbMode;$('#wb-drag-mode').onchange=e=>wbMode=e.target.value;
 const parked=E.effective(db).filter(l=>l.parked&&!l.cancelled);
 $('#view').insertAdjacentHTML('beforeend',`<section id="wb-tray" aria-label="Временный резерв уроков"><header><strong>Неразмещённые карточки <span>${parked.length}</span></strong><small>Не занимают учителя и кабинет. Сохраняются в базе.</small></header><div class="wb-tray-cards">${parked.map(l=>`<div class="wb-parked"><small>${h(lookup('classes',l.classId)?.name)} · ${h(l.date)} · ${l.slot}</small>${card(l)}</div>`).join('')||'<p>Перетащите сюда карточку, чтобы временно убрать её из сетки.</p>'}</div></section><p id="wb-drag-note" role="status">Перетащите урок в слот или в резерв. Несоответствия можно подтвердить вручную.</p>`);
 $('.board-bottom>span').textContent='Цвет = учитель · Клик: карточка · Двойной клик: редактирование · Перетаскивание: перенос / обмен';
 const warningButton=$('#open-warnings');$('.board-meta>div').replaceChildren(document.createTextNode('Цвет карточки: учитель '),warningButton);
 const currentDates=new Set([...document.querySelectorAll('[data-cell-date]')].map(x=>x.dataset.cellDate));
 const conflicts=E.conflicts(db,E.effective(db).filter(l=>currentDates.has(l.date)));
 const problemIds=new Set(conflicts.flatMap(i=>i.lessonIds));
 $$('.matrix [data-lesson]').forEach(el=>{if(problemIds.has(el.dataset.lesson)){el.classList.add('wb-conflict');el.title+=' · Есть несоответствие'}});
 bindCards();wbBind();
 $('#heading-actions').insertAdjacentHTML('beforeend','<button id="print-teachers">Печать по учителям</button>');
 $('#print-teachers').onclick=()=>showPrint('teachers');
 $('#print').onclick=()=>showPrint('classes');
};
const wbInspector=renderInspector;
renderInspector=function(){
 wbInspector();const l=E.effective(db).find(l=>l.id===selectedLesson);if(!l||!$('#inspect-edit'))return;
 $('#inspect-edit').insertAdjacentHTML('afterend','<button id="inspect-park">В резерв</button>');
 $('#inspect-park').onclick=()=>{try{wbConfirm('Убрать в резерв',W.park(db,l.id))}catch(e){message(e.message)}};
};
const wbLesson=showLesson;
showLesson=function(id,initial){
 wbLesson(id,initial);if(id||!initial)return;
 const available=db.courses.filter(c=>c.classId===initial.classId).map(c=>c.subjectId);
 const subs=db.subjects.filter(s=>available.includes(s.id));
 if(subs.length)$('#edit-subject').innerHTML=options(subs,initial.subjectId||subs[0].id);
 $('#edit-teacher').closest('label').insertAdjacentHTML('afterend','<p id="assignment-hint" class="hint full" role="status"></p>');
 function assign(){
  const lesson={...initial,date:$('#edit-date').value,subjectId:$('#edit-subject').value,groupName:$('#edit-group').value.trim()||null};
  const found=W.assignment(db,lesson);
  $('#edit-teacher').value=found.teacherId||'';
  $('#assignment-hint').textContent=found.teacherId?(found.teachers.length>1?'Есть несколько назначений. Выбрано ближайшее к дате; проверьте подгруппу и учителя.':'Учитель подставлен по назначению для этого класса и предмета.'):'Для этого класса и предмета назначение не найдено. Выберите учителя вручную.';
  $('#edit-teacher').dispatchEvent(new Event('change'));
 }
 ['#edit-subject','#edit-group','#edit-date'].forEach(s=>$(s).addEventListener('change',assign));$('#edit-subject').dispatchEvent(new Event('change'));
};
const wbSettings=showSettings;
showSettings=function(){wbSettings();for(const el of [$('#compact-cancelled'),$('[data-display="showCancelled"]')])if(el){el.checked=false;el.closest('label').hidden=true}};
