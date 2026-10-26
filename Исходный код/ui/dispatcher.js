/* Dispatcher v2: server persistence, class-row weekly matrix and cover desk. */
const API='';
let revision=0,connected=false,saving=false,saveTimer=null,saveAgain=false,saveError='',lastSaved='',fingerprint='',loading=true;
let selectedLesson=null,coverLesson=null,coverTeacher='',coverShow='pending',axis='classes',compact=true,month='2026-09';
const nativeRender=render,nativeCard=card,nativeData=renderData;
mode='week';theme='light';document.documentElement.dataset.theme=theme;
titles.schedule=['Расписание','Классы сверху вниз · Понедельник–пятница слева направо'];
titles.absences=['Замены','Отсутствие → урок → свободный преподаватель'];
titles.data=['База и резервные копии','Автоматическое сохранение в приватной рабочей области'];
document.querySelector('.sidebar-bottom').innerHTML='<strong>Рабочая база школы</strong><p>Автосохранение включено после подключения. ВШ не изменяется.</p><button id="theme-v2" class="text-button">Светлая / темная</button>';
$('#theme-v2').onclick=()=>{theme=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme};
$('.brand small').textContent='ДИСПЕТЧЕР РАСПИСАНИЯ';
$('#save-file').textContent='Резервная копия';$('#open-file').textContent='Импорт';
$('.topbar').insertAdjacentHTML('beforeend','<button id="retry-save" hidden>Повторить сохранение</button>');
$('#retry-save').onclick=()=>persist();
$('footer').innerHTML='<span>Параллель 2 · Рабочая копия школы</span><span>Без записи в ВШ · Отсутствия и замены</span>';
function stateMark(){return JSON.stringify([db.overrides,db.extraLessons,db.absences,db.history.length,settings])}
render=function(){
 nativeRender();
 if(connected&&!loading){const now=stateMark();if(now!==fingerprint||(dirty&&!saving&&!saveError)){fingerprint=now;dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(persist,500);renderStatus()}}
};
renderStatus=function(){
 $('#school-label').textContent=loading?'Подключение к рабочей базе…':db.meta.school;
 $('#year-label').textContent=db.meta.academicYear+' · Рабочая версия';
 $('#save-state').textContent=loading?'Загрузка':saveError?'Не сохранено':saving?'Сохраняется…':dirty?'Ожидает сохранения':connected?'Сохранено '+lastSaved:'Без подключения';
 $('#save-state').classList.toggle('unsaved',!!saveError||dirty);
 $('#retry-save').hidden=!saveError;
 $('#import-notice').hidden=connected&&!saveError;
 $('#import-notice').innerHTML=saveError?'<strong>Не удалось сохранить.</strong> '+h(saveError)+' Скачайте резервную копию, не закрывайте вкладку.':loading?'Открываю базу школы. Импортировать файл не нужно.':'Нет подключения к рабочей базе. Повторите подключение или откройте сохраненный JSON.';
};
async function persist(){
 if(!connected)return;
 if(saving){saveAgain=true;return}
 saving=true;saveError='';renderStatus();db.preferences=settings;
 const snapshot=JSON.stringify(db),mark=stateMark();
 try{
  const response=await fetch(API+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,state:JSON.parse(snapshot)})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Ошибка сохранения');
  revision=result.revision;lastSaved=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  dirty=stateMark()!==mark;
 }catch(e){saveError=e.message;dirty=true}
 saving=false;renderStatus();
 if((saveAgain||dirty)&&!saveError){saveAgain=false;clearTimeout(saveTimer);saveTimer=setTimeout(persist,300)}
}
save=function(){
 db.preferences=settings;download('Расписание_'+date+'_резервная-копия.json',JSON.stringify(db,null,2));
 message('Резервная копия подготовлена к скачиванию. Рабочая база сохраняется автоматически.');
 if(connected&&dirty)persist();
};
$('#save-file').onclick=save;
transact=function(label,fn){
 const before=editable();fn();
 db.history.push({id:crypto.randomUUID?.()||String(Date.now()),at:new Date().toISOString(),label,before,after:editable()});
 dirty=true;render();message(label+'.');
};
undo=function(){
 const last=db.history.pop();if(!last)return;
 Object.assign(db,structuredClone(last.before));dirty=true;render();message('Отменено: '+last.label+'.');
};
function applyPatches(label,patches){
 const issues=E.newIssues(db,patches);
 if(issues.length){message('Изменения не применены: '+[...new Set(issues.map(x=>x.kind))].join('; '));return false}
 transact(label,()=>patches.forEach(p=>db.overrides[p.id]={...db.overrides[p.id],...p.after}));
 return true;
}
function subjectColor(id){
 const palette=['#dce9fa','#f2e6c9','#dcecdf','#e7dff1','#f3deda','#d6eaf0','#ebebd9','#e4e8ee'];
 return palette[[...id].reduce((a,c)=>a+c.charCodeAt(0),0)%palette.length];
}
const compactNames=[
 [/разговоры о важном/i,'РоВ'],[/горизонты/i,'РМГ'],[/функциональн/i,'ФГ'],[/финансов/i,'Фин.'],
 [/изобразительн/i,'ИЗО'],[/история россии|всеобщая история/i,'Ист.'],[/^основы психологии/i,'Псих.'],
 [/религиозных/i,'ОРКСЭ'],[/духовно-нравств/i,'ОДНКНР'],[/окружающий/i,'Окр.'],
 [/орлята/i,'Орл.'],[/литературное чтение на родном/i,'РЛЧ'],[/родной язык/i,'РЯ'],
 [/иностранный.*немецк/i,'Нем.'],[/иностранный/i,'Англ.'],[/алгоритмики|программирования/i,'ВДА'],
 [/информатика и икт/i,'ИКТ'],[/практическая информатика/i,'ПИКТ'],[/индивидуальный/i,'ИУП'],
 [/безопасности и защиты/i,'ОБЗР'],[/родная литература/i,'РЛ'],[/медицинская статистика/i,'МСт'],
 [/фармакологи/i,'Фарм.'],[/физическая химия/i,'ФХ'],[/биохимия/i,'БХ'],[/педагогики/i,'Пед.'],
 [/актуальные вопросы.*истор/i,'АВИ'],[/актуальные вопросы.*обществ/i,'АВО'],[/права человека/i,'Право'],
 [/дорожная грамотность/i,'ДГБ'],[/технология/i,'Труд'],[/семьеведение/i,'Сем.'],[/черчение/i,'Черч.'],
 [/твои друзья/i,'Друз.'],[/подготовка к огэ/i,'ОГЭ'],[/юный спасатель/i,'МЧС'],[/начальная военная/i,'НВП'],
 [/педагогический имидж/i,'ПИм'],[/педагогический конструктор/i,'ПК'],[/россия.*история/i,'Рос.']
];
const longSubjectName=subjectName;
subjectName=function(l){
 if(settings.labels[l.subjectId])return settings.labels[l.subjectId];
 const name=lookup('subjects',l.subjectId)?.name||'';
 return settings.abbreviate?(compactNames.find(([re])=>re.test(name))?.[1]||longSubjectName(l)):name;
};
card=function(l){
 return nativeCard(l).replace('class="lesson ',`style="--subject-color:${subjectColor(l.subjectId)}" class="lesson ${selectedLesson===l.id?'selected ':''}`).replace(/title="[^"]*"/,`title="${h(lookup('subjects',l.subjectId)?.name)} · ${h(teacherName(l.teacherId))} · ${h(l.groupName||'Весь класс')} · ${h(l.time||'')}"`);
};
function dateBar(){
 return `<div class="date-switch"><button id="prev-date" aria-label="Назад">‹</button><input id="date" aria-label="Дата" type="date" value="${date}"><button id="next-date" aria-label="Вперед">›</button></div>`;
}
function bindDateBar(step=1){
 $('#date').onchange=e=>{date=e.target.value||date;selectedLesson=null;render()};
 $('#prev-date').onclick=()=>{date=E.addDays(date,-step);render()};
 $('#next-date').onclick=()=>{date=E.addDays(date,step);render()};
}
renderSchedule=function(){
 $('#heading-actions').innerHTML='<button id="cover-open">Отсутствие учителя</button><button id="rebuild" class="primary">Пересчитать день</button><button id="print">Печать A4</button>';
 $('#cover-open').onclick=()=>showAbsence();$('#rebuild').onclick=showRebuild;$('#print').onclick=showPrint;
 $('#controls').innerHTML=`<div class="ribbon">${dateBar()}<div class="segmented"><button data-mode="week" class="${mode==='week'?'active':''}">Неделя</button><button data-mode="day" class="${mode==='day'?'active':''}">День</button></div><select id="axis" aria-label="Строки расписания"><option value="classes">Классы</option><option value="teachers">Учителя</option><option value="rooms">Кабинеты</option></select><select id="grade" aria-label="Ступень"><option value="all">Вся школа</option><option value="primary">1–4 классы</option><option value="middle">5–9 классы</option><option value="senior">10–11 классы</option></select><select id="class" aria-label="Класс">${options(db.classes,classFilter,'Все классы')}</select><button id="class-choice">Выбор классов</button><span class="spacer"></span><button id="display-settings">Вид карточки</button><button id="density">${compact?'Развернуть':'Компактно'}</button></div>`;
 bindDateBar(mode==='week'?7:1);
 $('#axis').value=axis;$('#axis').onchange=e=>{axis=e.target.value;render()};
 $('#grade').value=grade;$('#grade').onchange=e=>{grade=e.target.value;selectedClasses=null;render()};
 $('#class').onchange=e=>{classFilter=e.target.value;render()};
 $('#class-choice').onclick=showClassChoice;$('#display-settings').onclick=showSettings;
 $('#density').onclick=()=>{compact=!compact;render()};
 $$('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render()});
 const dates=mode==='week'?Array.from({length:5},(_,i)=>E.addDays(monday(date),i)):[date];
 const ids=new Set(selected().map(c=>c.id));
 const rows=E.sortProfileRows(E.effective(db).filter(l=>dates.includes(l.date)&&ids.has(l.classId)&&!l.cancelled&&!l.parked),db);
 const entities=axis==='classes'?selected():db[axis].filter(x=>rows.some(l=>l[axis==='teachers'?'teacherId':'roomId']===x.id));
 const key=axis==='classes'?'classId':axis==='teachers'?'teacherId':'roomId',max=Math.max(8,...rows.map(l=>l.slot));
 const warning=E.conflicts(db,rows).length,changed=rows.filter(x=>db.overrides[x.id]).length;
 $('#view').innerHTML=`<div class="board-meta"><span>${fmt(dates[0])}${dates.length>1?' – '+fmt(dates.at(-1)):''} · ${entities.length} ${axis==='classes'?'классов':axis==='teachers'?'учителей':'кабинетов'}</span><div><span class="legend-dot original"></span> Базовое <span class="legend-dot altered"></span> Изменено: ${changed} <span class="legend-dot absent"></span> Отсутствие <button id="open-warnings">${warning} замечаний</button></div></div><div class="matrix-scroll ${compact?'compact':''} ${mode==='week'?'weekly':'daily'}"><table class="matrix"><thead><tr><th class="entity-col" rowspan="2">${axis==='classes'?'Класс':axis==='teachers'?'Учитель':'Кабинет'}</th>${dates.map(d=>`<th colspan="${max}" class="day-header"><button data-day="${d}">${['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][new Date(d+'T12:00:00').getDay()]} <small>${fmt(d)}</small></button></th>`).join('')}</tr><tr>${dates.map(d=>Array.from({length:max},(_,i)=>`<th class="period-header ${i===0?'day-start':''}">${i+1}</th>`).join('')).join('')}</tr></thead><tbody>${entities.map(c=>`<tr><th class="entity-col">${h(axis==='teachers'?short(c.name):c.name)}</th>${dates.map(d=>Array.from({length:max},(_,i)=>{const ls=rows.filter(l=>l[key]===c.id&&l.date===d&&l.slot===i+1);return `<td class="${axis==='classes'?'drop-cell':''} ${i===0?'day-start':''}" ${axis==='classes'?`data-cell-class="${c.id}" data-cell-date="${d}" data-cell-slot="${i+1}"`:''}>${ls.map(l=>card(l)).join('')|| (axis==='classes'?`<button class="empty-slot" data-add="${c.id}|${d}|${i+1}" aria-label="Добавить ${h(c.name)} ${d} урок ${i+1}">+</button>`:'')}</td>`}).join('')).join('')}</tr>`).join('')}</tbody></table></div><div class="board-bottom"><span>Клик: карточка · Двойной клик: редактировать · Перетаскивание: перенос или обмен блоками подгрупп</span><button id="undo-board" ${db.history.length?'':'disabled'}>Отменить последнее действие</button></div><div id="lesson-inspector"></div>`;
 $('#open-warnings').onclick=()=>setRoute('conflicts');$('#undo-board').onclick=undo;
 $$('[data-day]').forEach(b=>b.onclick=()=>{date=b.dataset.day;mode='day';render()});
 bindCards();renderInspector();
};
bindCards=function(){
 $$('[data-lesson]').forEach(b=>{
  b.onclick=()=>{selectedLesson=b.dataset.lesson;$$('[data-lesson]').forEach(x=>x.classList.toggle('selected',x.dataset.lesson===selectedLesson));renderInspector()};
  b.ondblclick=()=>showLesson(b.dataset.lesson);
  b.oncontextmenu=e=>{e.preventDefault();showLesson(b.dataset.lesson)};
  b.ondragstart=e=>{dragId=b.dataset.lesson;e.dataTransfer.setData('text/plain',dragId)};
 });
 $$('[data-add]').forEach(b=>b.onclick=()=>{const [classId,d,slot]=b.dataset.add.split('|');showLesson(null,{classId,date:d,slot:+slot})});
 $$('.drop-cell').forEach(c=>{
  c.ondragover=e=>{e.preventDefault();c.classList.add('drag-over')};c.ondragleave=()=>c.classList.remove('drag-over');
  c.ondrop=e=>{
   e.preventDefault();c.classList.remove('drag-over');
   const l=E.effective(db).find(x=>x.id===(dragId||e.dataTransfer.getData('text/plain')));if(!l)return;
   if(l.classId!==c.dataset.cellClass){message('Перенос между разными классами запрещен.');return}
   if(l.date===c.dataset.cellDate&&l.slot===+c.dataset.cellSlot)return;
   try{const patches=E.transfer(db,l.id,c.dataset.cellDate,+c.dataset.cellSlot);previewPatches('Перенос / обмен уроков',patches,[])}
   catch(err){message(err.message)}
  };
 });
};
function renderInspector(){
 const el=$('#lesson-inspector');if(!el)return;
 const l=E.effective(db).find(x=>x.id===selectedLesson);
 if(!l){el.innerHTML='';return}
 el.innerHTML=`<div class="inspector"><div><span class="eyebrow">${h(lookup('classes',l.classId)?.name)} · ${fmt(l.date)} · ${l.slot}-й урок · ${h(l.time)}</span><h3>${h(lookup('subjects',l.subjectId)?.name)}</h3><p>${h(teacherName(l.teacherId))} · ${h(l.roomId?roomName(l.roomId):'Без кабинета')} · ${h(l.groupName||'Весь класс')}</p></div><div class="inspector-actions"><button id="inspect-edit">Редактировать</button><button id="inspect-cover" class="primary">Подобрать замену</button><button id="inspect-cancel" class="danger">${l.cancelled?'Восстановить':'Отменить урок'}</button><button id="inspect-close" aria-label="Закрыть карточку">×</button></div></div>`;
 $('#inspect-close').onclick=()=>{selectedLesson=null;renderInspector()};
 $('#inspect-edit').onclick=()=>showLesson(l.id);
 $('#inspect-cover').onclick=()=>{date=l.date;coverLesson=l.id;coverShow='all';setRoute('absences')};
 $('#inspect-cancel').onclick=()=>l.cancelled?showLesson(l.id):cancelLesson(l);
}
function coverRows(){
 return E.effective(db).filter(l=>!l.parked&&l.date===date&&(!coverTeacher||(db.lessons.find(b=>b.id===l.id)?.teacherId||l.teacherId)===coverTeacher)&&(coverShow==='all'||(!l.cancelled&&E.absenceFor(l,db))));
}
function teacherStrip(tid,d){
 const rows=E.effective(db).filter(l=>l.date===d&&l.teacherId===tid&&!l.cancelled&&!l.parked);
 return `<div class="teacher-strip">${Array.from({length:8},(_,i)=>{const ls=rows.filter(l=>l.slot===i+1),abs=E.absenceFor({teacherId:tid,date:d,slot:i+1},db);return `<span title="${h(abs?'Отсутствует':ls.map(x=>lookup('classes',x.classId)?.name+' '+subjectName(x)).join(', ')||'Свободен')}" class="${abs?'unavailable':ls.length?'occupied':'free'}"><small>${i+1}</small>${h(abs?'Нет':ls.map(x=>lookup('classes',x.classId)?.name).join('/')||'·')}</span>`}).join('')}</div>`;
}
renderAbsences=function(){
 $('#heading-actions').innerHTML='<button id="add-absence" class="primary">Добавить отсутствие</button><button id="rebuild">Рассчитать замены</button><button id="month-report">Отчет за месяц</button>';
 $('#add-absence').onclick=()=>showAbsence();$('#rebuild').onclick=showRebuild;$('#month-report').onclick=showMonthReport;
 $('#controls').innerHTML=`<div class="ribbon">${dateBar()}<select id="cover-filter" aria-label="Учитель">${options(db.teachers,coverTeacher,'Все учителя')}</select><div class="segmented"><button data-cover-show="pending" class="${coverShow==='pending'?'active':''}">Требуют решения</button><button data-cover-show="all" class="${coverShow==='all'?'active':''}">Все уроки дня</button></div><span class="spacer"></span><button id="print-cover">Печать замен</button></div>`;
 bindDateBar();$('#cover-filter').onchange=e=>{coverTeacher=e.target.value;coverLesson=null;render()};
 $$('[data-cover-show]').forEach(b=>b.onclick=()=>{coverShow=b.dataset.coverShow;coverLesson=null;render()});
 $('#print-cover').onclick=printCover;
 const absent=db.absences.filter(a=>a.startDate<=date&&a.endDate>=date);
 const lessons=coverRows().sort((a,b)=>a.slot-b.slot||lookup('classes',a.classId)?.name.localeCompare(lookup('classes',b.classId)?.name,'ru',{numeric:true}));
 let l=lessons.find(x=>x.id===coverLesson)||lessons[0];coverLesson=l?.id||null;
 const pending=E.effective(db).filter(x=>x.date===date&&!x.cancelled&&E.absenceFor(x,db));
 $('#view').innerHTML=`<div class="cover-summary"><strong>${absent.length}</strong> отсутствий <strong>${pending.length}</strong> уроков требуют решения <span>Выберите урок, затем преподавателя справа</span></div><div class="cover-workspace"><section class="cover-pane"><header><h2>Отсутствуют</h2><span>${absent.length}</span></header><div class="pane-content">${absent.map(a=>`<article class="absent-item"><strong>${h(short(teacherName(a.teacherId)))}</strong><small>${h(a.reason)} · уроки ${a.startSlot||1}–${a.endSlot||8}</small><small>${a.startDate} — ${a.endDate}</small><p>${h(a.note||'')}</p><button data-absence-filter="${a.teacherId}">Показать уроки</button><button data-remove-absence="${a.id}">Снять отметку</button></article>`).join('')||'<div class="empty-pane">Нет отсутствующих на эту дату.<br>Нажмите «Добавить отсутствие».</div>'}</div></section><section class="cover-pane"><header><h2>Уроки на замену</h2><span>${lessons.length}</span></header><div class="pane-content">${lessons.map(x=>`<button class="cover-lesson ${x.id===coverLesson?'selected':''}" data-cover-lesson="${x.id}"><span class="slot-badge">${x.slot}</span><span><strong>${h(lookup('classes',x.classId)?.name)} · ${h(subjectName(x))}</strong><small>${h(short(teacherName(x.teacherId)))}${x.groupName?' · '+h(x.groupName):''}</small></span><span class="tag">${x.cancelled?'Отменен':E.absenceFor(x,db)?'Нужна замена':db.overrides[x.id]?'Изменен':'По плану'}</span></button>`).join('')||'<div class="empty-pane">Нерешенных уроков нет.<br>Можно посмотреть все уроки дня.</div>'}</div></section><section class="cover-pane candidates-pane"><header><h2>Кто может заменить</h2></header><div class="pane-content" id="cover-candidates"></div></section></div>`;
 $$('[data-cover-lesson]').forEach(b=>b.onclick=()=>{coverLesson=b.dataset.coverLesson;render()});
 $$('[data-absence-filter]').forEach(b=>b.onclick=()=>{coverTeacher=b.dataset.absenceFilter;render()});
 $$('.absent-item').forEach((el,i)=>{
  const a=absent[i],button=document.createElement('button');button.textContent='Отменить без замены за день';button.className='danger';
  button.onclick=()=>{
   const patches=E.effective(db).filter(x=>x.date===date&&!x.cancelled&&E.absenceFor(x,db)?.id===a.id).map(x=>({id:x.id,before:x,after:{...x,cancelled:true,cancelReason:a.reason,absenceId:a.id}}));
   previewPatches('Отмена без замены · '+short(teacherName(a.teacherId)),patches,[]);
  };
  el.appendChild(button);
 });
 $$('[data-remove-absence]').forEach(b=>b.onclick=()=>dialog('Снять отсутствие','<p>Уже выполненные замены и отмены останутся. При необходимости отмените их через историю.</p>',[{text:'Снять отметку',class:'primary',action:()=>{$('#dialog').close();transact('Снятие отсутствия',()=>db.absences=db.absences.filter(a=>a.id!==b.dataset.removeAbsence))}}]));
 if(l)renderCandidates(l);else $('#cover-candidates').innerHTML='<div class="empty-pane">Выберите урок в средней колонке.</div>';
};
function renderCandidates(l){
 const list=E.candidates(l,db).filter(c=>c.teacher.id!==l.teacherId);
 $('#cover-candidates').innerHTML=`<div class="selected-cover"><strong>${h(lookup('classes',l.classId)?.name)} · ${l.slot}-й урок · ${h(subjectName(l))}</strong><p>${h(teacherName(l.teacherId))}</p>${teacherStrip(l.teacherId,date)}<div class="candidate-actions"><button id="cover-edit">Изменить урок</button><button id="cover-cancel" class="danger">${l.cancelled?'Восстановить':'Отменить без замены'}</button></div></div><p class="hint">Только этот или смежный предмет. Сначала точное совпадение, затем смежный.</p><label class="checkbox-line"><input type="checkbox" id="show-busy">Показать занятых</label><div id="ranked-candidates">${!list.some(c=>!c.busy)?'<p>Нет свободных учителей этого или смежного предмета.</p>':''}${list.map((c,i)=>`<article class="ranked-candidate ${c.busy?'busy hidden-busy':''}"><div class="candidate-title"><span><strong>${h(short(c.teacher.name))}</strong><small>${h(c.qualification)}${c.busy?' · занят или отсутствует':''}${c.known?' · знаком с классом':''}</small></span><button data-replace="${c.teacher.id}" ${c.busy?'disabled':''}>Заменить</button></div>${teacherStrip(c.teacher.id,date)}</article>`).join('')}</div>`;
 $('#cover-edit').onclick=()=>showLesson(l.id);
 $('#cover-cancel').onclick=()=>l.cancelled?showLesson(l.id):cancelLesson(l);
 $('#show-busy').onchange=e=>$$('.hidden-busy').forEach(x=>x.classList.toggle('show-busy',e.target.checked));
 $$('[data-replace]').forEach(b=>b.onclick=()=>{
  const after={...l,teacherId:b.dataset.replace,roomMode:'auto',cancelled:false,substitutionReason:E.absenceFor(l,db)?.reason||'Замена вручную'};
  const p={id:l.id,before:l,after,reason:'Замена учителя'};
  previewPatches('Подтвердить замену',[p],[]);
 });
}
const oldShowPrint=showPrint;
showPrint=function(){
 dialog('Печать расписания',`<p>${fmt(date)} · ${selected().length} выбранных классов</p><label class="field">Вариант печати<select id="print-layout"><option value="rows">Общая таблица: классы строками, уроки столбцами</option><option value="detail">Подробные карточки: несколько классов на странице</option></select></label><div class="form-grid"><label class="checkbox-line"><input type="checkbox" id="print-teachers">Печатать учителей</label><label class="checkbox-line"><input type="checkbox" id="print-rooms">Печатать кабинеты</label></div><p class="hint">A4, альбомная ориентация. В общей таблице печатается выбранный день. Чем больше подробностей в карточках, тем больше страниц. Проверьте предварительный просмотр.</p>`,[{text:'Печатать',class:'primary',action:()=>{
  if($('#print-layout').value==='detail'){oldShowPrint();return}
  const withTeachers=$('#print-teachers').checked,withRooms=$('#print-rooms').checked;
  const rows=E.effective(db).filter(l=>l.date===date),max=Math.max(8,...rows.map(l=>l.slot));
  $('#print-root').innerHTML=`<section class="print-class-rows"><h1>${h(db.meta.school)} · ${fmt(date)} · ${days[new Date(date+'T12:00:00').getDay()]}</h1><table><thead><tr><th>Класс</th>${Array.from({length:max},(_,i)=>`<th>${i+1}</th>`).join('')}</tr></thead><tbody>${selected().map(c=>`<tr><th>${h(c.name)}</th>${Array.from({length:max},(_,i)=>`<td>${rows.filter(l=>l.classId===c.id&&l.slot===i+1).map(l=>`<div class="print-row-card">${l.cancelled?'ОТМЕНА: ':''}<strong>${h(subjectName(l))}</strong>${l.groupName?` <span>(${h(l.groupName)})</span>`:''}${withTeachers?`<small>${h(short(teacherName(l.teacherId)))}</small>`:''}${withRooms&&l.roomId?`<small>${h(roomName(l.roomId))}</small>`:''}</div>`).join('')||'—'}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Рабочая копия · ${fmt(date)} · изменения включены</p></section>`;
  $$('.print-row-card span').forEach(span=>{
   const label=span.textContent.slice(1,-1).trim();
   if(db.subjects.some(s=>s.name===label)){span.remove();return}
   span.textContent='('+label.replace(/Социально-гуманитарный/gi,'СГ').replace(/Химико-биологический/gi,'ХБ').replace(/Физико-математический/gi,'ФМ').replace(/Углубленный/gi,'угл.').replace(/Базовый/gi,'баз.')+')';
  });
  $('#dialog').close();window.print();
 }}]);
};
showAbsence=function(){
 dialog('Добавить отсутствие',`<div class="form-grid"><label class="field full">Учитель<select id="absence-teacher">${options(db.teachers,coverTeacher)}</select></label><label class="field">С даты<input type="date" id="absence-start" value="${date}"></label><label class="field">По дату<input type="date" id="absence-end" value="${date}"></label><label class="field">С урока<input type="number" id="absence-from" min="1" max="20" value="1"></label><label class="field">По урок включительно<input type="number" id="absence-to" min="1" max="20" value="8"></label><label class="field full">Причина<select id="absence-reason"><option>Больничный</option><option>Отгул</option><option>Командировка</option><option>Мероприятие</option><option>Неявка (причина не установлена)</option><option>Прогул (подтвержденный)</option><option>Другое отсутствие</option></select></label><label class="field full">Основание / примечание<input id="absence-note" type="text"></label></div><p class="hint">Причину выбираете вы. Приложение не квалифицирует неявку как прогул автоматически. Отметка применяется к указанным урокам каждого дня диапазона.</p><p id="absence-error" role="alert"></p>`,[{text:'Добавить и подобрать замены',class:'primary',action:()=>{
  const a={id:'absence-'+Date.now(),teacherId:$('#absence-teacher').value,startDate:$('#absence-start').value,endDate:$('#absence-end').value,startSlot:+$('#absence-from').value,endSlot:+$('#absence-to').value,reason:$('#absence-reason').value,note:$('#absence-note').value.trim()};
  if(!a.startDate||a.endDate<a.startDate||!Number.isInteger(a.startSlot)||!Number.isInteger(a.endSlot)||a.startSlot<1||a.endSlot>20||a.endSlot<a.startSlot){$('#absence-error').textContent='Проверьте даты и номера уроков.';return}
  if(db.absences.some(x=>x.teacherId===a.teacherId&&x.startDate<=a.endDate&&x.endDate>=a.startDate&&(x.startSlot||1)<=a.endSlot&&(x.endSlot||20)>=a.startSlot)){$('#absence-error').textContent='В указанное время отсутствие уже зарегистрировано.';return}
  $('#dialog').close();date=a.startDate;coverTeacher=a.teacherId;coverLesson=null;coverShow='pending';route='absences';
  transact('Отсутствие: '+short(teacherName(a.teacherId)),()=>db.absences.push(a));
 }}]);
};
showRebuild=function(){
 dialog('Пересчет дня · '+fmt(date),`<p>Рассчитать замены отсутствующих учителей и заполнить освободившиеся окна для ${selected().length} выбранных классов.</p><div class="optimizer-options"><label class="checkbox-line"><input id="opt-related" type="checkbox" checked>Учитывать преподавателей смежных предметов</label><label class="checkbox-line"><input id="opt-cancel" type="checkbox">Отменять без замены, если подходящего учителя нет</label><label class="checkbox-line"><input id="opt-compact" type="checkbox" checked>Уплотнить день: перенести поздние уроки в окна</label></div><p class="hint">Сначала преподаватели этого предмета, затем смежного. Группы: математика / алгебра / геометрия / вероятность и статистика; история / обществознание / актуальные вопросы истории. Остальные предметы — только совпадающие. Занятые и отсутствующие исключаются. Посторонние предметы не допускаются. Подгруппы переносятся блоком, закрепленные уроки сохраняются. Перед применением вы увидите весь список изменений.</p>`,[{text:'Рассчитать предложения',class:'primary',action:()=>{
  const result=E.optimize(db,date,{classIds:selected().map(c=>c.id),allowRelated:$('#opt-related').checked,cancelUnresolved:$('#opt-cancel').checked,compact:$('#opt-compact').checked});
  previewPatches('Результат пересчета · '+fmt(date),result.patches,result.unresolved);
 }}]);
};
function previewPatches(title,patches,unresolved){
 patches=E.resolvePatches(db,patches);
 const issues=E.newIssues(db,patches);
 dialog(title,`<div class="plan-totals"><span><strong>${patches.filter(p=>p.before.teacherId!==p.after.teacherId).length}</strong> замен</span><span><strong>${patches.filter(p=>!p.before.cancelled&&p.after.cancelled).length}</strong> отмен</span><span><strong>${patches.filter(p=>p.before.slot!==p.after.slot||p.before.date!==p.after.date).length}</strong> переносов</span><span><strong>${unresolved.length}</strong> не решено</span></div>${patches.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Класс · предмет</th><th>Было</th><th>Будет</th></tr></thead><tbody>${patches.map(p=>`<tr><td>${h(lookup('classes',p.before.classId)?.name)} · ${h(subjectName(p.before))}<small>${h(p.before.groupName||'')}</small></td><td>${fmt(p.before.date)} · ${p.before.slot}<br>${h(short(teacherName(p.before.teacherId)))}</td><td>${p.after.cancelled?'<strong>Отмена без замены</strong>':`${fmt(p.after.date)} · ${p.after.slot}<br>${h(short(teacherName(p.after.teacherId)))}`}</td></tr>`).join('')}</tbody></table></div>`:'<p>Изменений не предложено.</p>'}${unresolved.length?`<h3>Требуют ручного решения</h3><ul>${unresolved.map(l=>`<li>${h(lookup('classes',l.classId)?.name)} · ${l.slot} · ${h(subjectName(l))}: ${h(l.reason)}</li>`).join('')}</ul>`:''}${issues.length?`<p class="error">Применение заблокировано: ${h([...new Set(issues.map(x=>x.kind))].join('; '))}</p>`:'<p class="hint">Новых пересечений учителей, кабинетов или подгрупп не обнаружено. Ранее существовавшие замечания не исправляются автоматически.</p>'}`,[{text:'Не применять',action:()=>$('#dialog').close()},...(patches.length&&!issues.length?[{text:'Применить '+patches.length+' изменений',class:'primary',action:()=>{$('#dialog').close();applyPatches(title,patches)}}]:[])]);
}
function monthRows(m){
 const lessons=E.effective(db).filter(l=>l.date.startsWith(m)&&!l.parked);
 const original=new Map(db.lessons.map(l=>[l.id,l]));
 return db.teachers.map(t=>{
  const absent=db.lessons.filter(l=>l.date.startsWith(m)&&l.teacherId===t.id&&E.absenceFor(l,db));
  return {teacher:t.name,absenceLessons:absent.length,cancelled:lessons.filter(l=>l.cancelled&&original.get(l.id)?.teacherId===t.id).length,received:lessons.filter(l=>!l.cancelled&&l.teacherId===t.id&&original.get(l.id)?.teacherId!==t.id&&original.has(l.id)).length,covered:lessons.filter(l=>!l.cancelled&&original.get(l.id)?.teacherId===t.id&&l.teacherId!==t.id).length,unresolved:lessons.filter(l=>!l.cancelled&&l.teacherId===t.id&&E.absenceFor(l,db)).length};
 }).filter(x=>x.absenceLessons||x.cancelled||x.received||x.covered||x.unresolved);
}
function reportTable(rows){return `<table class="data-table"><thead><tr><th>Учитель</th><th>Уроков отсутствия</th><th>Отменено</th><th>Заменил коллегу</th><th>Замещено у него</th><th>Не решено</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${h(x.teacher)}</td><td>${x.absenceLessons}</td><td>${x.cancelled}</td><td>${x.received}</td><td>${x.covered}</td><td>${x.unresolved}</td></tr>`).join('')}</tbody></table>`}
function showMonthReport(){
 month=date.slice(0,7);
 dialog('Учет отсутствий и замен',`<label class="field">Месяц<input type="month" id="report-month" value="${month}"></label><div id="monthly-table" class="table-wrap">${reportTable(monthRows(month))}</div><p class="hint">Количество записей уроков, не расчет оплаты и не кадровый табель. Объединенные группы могут давать несколько записей на один час. Отгулы и причины находятся в журнале.</p>`,[{text:'Скачать CSV',action:()=>csv('Замены_'+month+'.csv',monthRows(month))},{text:'Печатать',action:()=>{$('#print-root').innerHTML=`<section class="print-page"><h1>Учет замен · ${h(month)}</h1>${reportTable(monthRows(month))}</section>`;$('#dialog').close();window.print()}}]);
 $('#report-month').onchange=e=>{month=e.target.value;$('#monthly-table').innerHTML=reportTable(monthRows(month))};
}
function printCover(){
 const rows=E.sortProfileRows(E.effective(db).filter(l=>l.date===date&&db.overrides[l.id]),db);
 $('#print-root').innerHTML=`<section class="print-page"><h1>Изменения расписания · ${fmt(date)}</h1><table><thead><tr><th>Класс</th><th>Урок</th><th>Предмет</th><th>Было</th><th>Стало</th></tr></thead><tbody>${rows.map(l=>`<tr><td>${h(lookup('classes',l.classId)?.name)}</td><td>${l.slot}</td><td>${h(subjectName(l))}</td><td>${h(short(teacherName(db.lessons.find(x=>x.id===l.id)?.teacherId)))}</td><td>${l.cancelled?'Отмена без замены':h(short(teacherName(l.teacherId)))}</td></tr>`).join('')}</tbody></table></section>`;window.print();
}
renderData=function(){
 $('#view').innerHTML=`<div class="panel"><h2>Рабочая база открывается автоматически</h2><p>${db.classes.length} классов · ${db.teachers.length} учителя · ${db.lessons.length.toLocaleString('ru-RU')} исходных записей уроков.</p><p>Изменения сохраняются в SQLite на сервере приватного предпросмотра. Статус справа вверху подтверждает результат. После перезагрузки в том же браузере база и история восстанавливаются.</p><p>При потере связи не закрывайте вкладку: повторите сохранение или скачайте резервную копию. Рабочая область привязана к браузеру; для переноса на другое устройство используйте экспорт и импорт. Это не общий многопользовательский сервер.</p><button id="data-save" class="primary">Скачать резервную копию</button> <button id="data-open">Импортировать другую базу</button></div><div class="panel"><h2>Ежедневная работа</h2><ol class="help-list"><li>В «Расписании» строки обозначают классы, столбцы сгруппированы с понедельника по пятницу. Нажмите на день для подробного вида.</li><li>Добавьте отсутствие: учитель, даты, номера уроков, причина.</li><li>На экране «Замены» выберите урок и свободного преподавателя справа. Отмените урок, если замены не будет.</li><li>«Пересчитать день» предложит замены и переносы. Проверьте список до применения.</li><li>Отменяйте ошибочные операции в истории. Печатайте расписание и лист замен.</li></ol></div><div class="panel"><h2>Границы реализации</h2><p>Самостоятельный интерфейс по логике диспетчера aSc, не продукт aSc и не точная копия всех его возможностей. Пересчет работает в пределах выбранного дня. Годовой генератор по нагрузке, нормативы, кадровый учет и обратная синхронизация с ВШ не реализованы.</p><p>В рабочей базе нет ФИО учеников, СНИЛС, паспортов или адресов. База содержит учителей и расписание. Не публикуйте приложение вместе с рабочими данными без отдельного решения о доступе.</p><p>Сервер предпросмотра не заменяет постоянный школьный сервер. Для долговременной эксплуатации нужны собственное размещение и резервное копирование.</p></div>`;
 $('#data-save').onclick=save;$('#data-open').onclick=()=>$('#file').click();
 $('#data-save').insertAdjacentHTML('afterend',' <button id="appearance">Светлая / темная тема</button>');
 $('#appearance').onclick=()=>{theme=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme};
};
// Imports are explicit replacements, including when current data are already saved.
$('#file').onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 try{
  if(f.size>80*1024*1024)throw Error('Слишком большой файл');
  const next=normalize(JSON.parse(await f.text()));
  dialog('Заменить рабочую базу?',`<p>Файл «${h(f.name)}»: ${next.classes.length} классов, ${next.lessons.length} записей. Он заменит текущую рабочую базу в этой области. Перед заменой сохраните резервную копию.</p>`,[{text:'Резервная копия текущей базы',action:save},{text:'Импортировать',class:'primary',action:()=>{
   $('#dialog').close();db=next;settings={...settings,...db.preferences,labels:db.preferences?.labels||{}};
   selectedClasses=null;classFilter='';teacherFilter='';grade='all';coverLesson=null;coverTeacher='';selectedLesson=null;
   date=db.lessons.some(l=>l.date===date)?date:db.lessons[0]?.date||date;fingerprint='';dirty=true;render();
  }}]);
 }catch(e){message('Импорт не выполнен: '+e.message)}
 $('#file').value='';
};
async function boot(){
 $('#view').innerHTML='<div class="loading-screen"><span class="loading-spinner"></span><h2>Открываю расписание школы</h2><p>Рабочая база загружается автоматически.</p></div>';
 renderStatus();$('#controls').innerHTML='';$('#navigation').innerHTML='';
 try{
  const res=await fetch(API+'/api/state');const result=await res.json();if(!res.ok)throw Error(result.error);
  db=normalize(result.state);revision=result.revision;connected=true;
  settings={...settings,...db.preferences,labels:db.preferences?.labels||{}};
  fingerprint=stateMark();dirty=false;lastSaved=new Date(result.updated).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});loading=false;render();
 }catch(e){
  loading=false;saveError=e.message;renderStatus();
  $('#view').innerHTML='<div class="empty-state"><h2>Рабочая база временно недоступна</h2><p>Данные не заменены демонстрацией. Попробуйте подключиться снова.</p><button id="retry-boot" class="primary">Повторить подключение</button></div>';
  $('#retry-boot').onclick=boot;
 }
}
boot();
document.addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();connected?persist():save()}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!$('#dialog').open){e.preventDefault();undo()}
});
