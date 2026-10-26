const E=ScheduleEngine, $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const fmt=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
const monday=d=>E.addDays(d,-((new Date(d+'T12:00:00').getDay()+6)%7));
const short=n=>{const s=(n||'').split(' ');return s[0]+(s[1]?' '+s[1][0]+'.':'')+(s[2]?s[2][0]+'.':'')};
let db,dirty=false,route='schedule',mode='day',date='2026-09-21',grade='all',classFilter='',teacherFilter='',search='',settings={subject:true,teacher:true,room:true,group:true,abbreviate:true,showCancelled:true,labels:{}},dragId=null,selectedClasses=null,proposal=[];
const titles={schedule:['Расписание','Вся школа в одном расписании. Базовые уроки и изменения на выбранную дату.'],absences:['Замены и отсутствия','Отмечайте отсутствие, выбирайте замену или отменяйте урок только на нужную дату.'],conflicts:['Контроль расписания','Проверка учителей, кабинетов и пересечений учебных групп.'],directory:['Справочники','Классы, учителя, предметы и учебные планы из рабочего файла.'],history:['История изменений','Каждое действие сохраняет исходное состояние. Последнее действие можно отменить.'],data:['Файлы и помощь','Данные остаются в памяти вкладки. Рабочий JSON сохраняется на ваше устройство.']};
function makeDemo(){
 const cls=['1а','1б','2а','2б','3а','3б','4а','4б','5а','5б','6а','6б','6в','7а','7б','7в','8а','8б','8в','9а','9б','9в','10а','10б','11'].map((name,i)=>({id:'c'+i,name,grade:parseInt(name)}));
 const names=['Русский язык','Математика','История','Иностранный язык (английский)','Физическая культура','Биология','Разговоры о важном'];
 const subjects=names.map((name,i)=>({id:'s'+i,name,abbreviation:['Рус. яз.','Мат.','Ист.','Англ.','Физ-ра','Био.','РоВ'][i]}));
 const teachers=Array.from({length:40},(_,i)=>({id:'t'+i,name:'Учитель '+String(i+1).padStart(2,'0')+' · пример'}));
 const rooms=Array.from({length:25},(_,i)=>({id:'r'+i,name:'Кабинет '+(i+1)}));const lessons=[],teacherSubjects=[];
 for(let d=0;d<5;d++)for(let c=0;c<25;c++)for(let s=1;s<= (c<2?3:6);s++){
  let sub=d===0&&s===1?6:(d+s+c)%6;
  lessons.push({id:`demo-${d}-${c}-${s}`,classId:'c'+c,date:E.addDays('2026-09-21',d),slot:s,time:`${String(7+s).padStart(2,'0')}:30 - ${String(8+s).padStart(2,'0')}:15`,subjectId:'s'+sub,teacherId:'t'+((c+s+d)%40),roomId:'r'+c,groupName:null,locked:false});
 }
 for(let t=0;t<40;t++)for(let s=0;s<7;s++)if((t+s)%3===0)teacherSubjects.push({teacherId:'t'+t,subjectId:'s'+s});
 return {meta:{schemaVersion:'1.0',school:'Демонстрационная школа',academicYear:'2026-2027',demo:true},classes:cls,subjects,teachers,rooms,lessons,courses:[],groups:[],periods:[],calendar:[],calls:[],teacherSubjects,overrides:{},extraLessons:[],absences:[],history:[]};
}
function normalize(data){
 E.validate(data);
 // Student PII has no scheduling purpose in this workspace.
 const permitted=['meta','classes','subjects','teachers','rooms','lessons','courses','groups','periods','calendar','calls','teacherSubjects','overrides','extraLessons','absences','history','preferences'];
 const out=Object.fromEntries(permitted.filter(k=>k in data).map(k=>[k,data[k]]));
 for(const k of ['courses','groups','periods','calendar','calls','teacherSubjects','extraLessons','absences','history'])out[k]??=[];
 out.overrides??={};
 if(typeof out.overrides!=='object'||Array.isArray(out.overrides))throw Error('Неверный формат изменений');
 // Validate effective data as well, so imported patches cannot bypass schema checks.
 E.validate({...out,lessons:E.effective(out)});
 return out;
}
const lookup=(key,id)=>db[key].find(x=>x.id===id);
let subjectName=l=>{const s=lookup('subjects',l.subjectId);return settings.labels[l.subjectId]||(settings.abbreviate?s?.abbreviation||s?.name:s?.name)||'Неизвестный предмет'};
const teacherName=id=>lookup('teachers',id)?.name||'Учитель не назначен';
const roomName=id=>lookup('rooms',id)?.name||'Кабинет не указан';
function selected(){
 return db.classes.filter(c=>(grade==='all'||(grade==='primary'?c.grade<=4:grade==='middle'?c.grade>=5&&c.grade<=9:c.grade>=10))&&(!classFilter||classFilter===c.id)&&(!selectedClasses||selectedClasses.has(c.id)));
}
function filteredRows(d){
 const ids=new Set(selected().map(x=>x.id));const q=search.toLowerCase();
 return E.effective(db).filter(l=>l.date===d&&ids.has(l.classId)&&(!teacherFilter||l.teacherId===teacherFilter)&&(settings.showCancelled||!l.cancelled)&&(!q||[subjectName(l),teacherName(l.teacherId),l.groupName,roomName(l.roomId)].join(' ').toLowerCase().includes(q)));
}
function editable(){return structuredClone({overrides:db.overrides,extraLessons:db.extraLessons,absences:db.absences})}
function message(t){$('#message').textContent=t;$('#message').hidden=!t}
function transact(label,fn){
 const before=editable();fn();
 db.history.push({id:crypto.randomUUID?.()||String(Date.now()),at:new Date().toISOString(),label,before,after:editable()});
 dirty=true;render();message(label+'. Сохраните рабочий файл.');
}
function undo(){
 const last=db.history.pop();if(!last)return;
 Object.assign(db,structuredClone(last.before));dirty=true;render();message('Отменено: '+last.label+'. Сохраните файл для фиксации.');
}
function download(name,text,type='application/json'){
 const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function save(){
 db.preferences=settings;
 download('school_workspace_'+date+'.json',JSON.stringify(db,null,2));
 dirty=false;renderStatus();message('Файл подготовлен к скачиванию. Убедитесь, что браузер сохранил его на устройство.');
}
function renderStatus(){
 $('#school-label').textContent=db.meta.demo?'Демонстрационный режим':db.meta.school;
 $('#year-label').textContent=db.meta.academicYear;
 $('#save-state').textContent=dirty?'Есть несохраненные изменения':'В памяти вкладки';
 $('#save-state').classList.toggle('unsaved',dirty);
 $('#import-notice').innerHTML=db.meta.demo?'<strong>Демонстрационные данные.</strong> Откройте выданный файл <b>school_schedule.json</b>, чтобы работать с вашей школой. Реальные данные не встроены в приложение.':'<strong>Рабочая копия ВШ.</strong> Данные открыты только в этой вкладке. Сохраните JSON перед обновлением страницы. Изменения на сайт не отправляются.';
}
function setRoute(r){route=r;message('');render()}
function render(){
 renderStatus();$('#navigation').innerHTML=Object.entries(titles).map(([k,v],i)=>`<button class="nav-button ${route===k?'active':''}" data-route="${k}" data-testid="nav-${k}"><span>0${i+1}</span>${h(v[0])}</button>`).join('');
 $$('[data-route]').forEach(b=>b.onclick=()=>setRoute(b.dataset.route));
 $('#page-title').textContent=titles[route][0];$('#page-description').textContent=titles[route][1];$('#controls').innerHTML='';$('#heading-actions').innerHTML='';
 if(route==='schedule')renderSchedule();
 if(route==='absences')renderAbsences();
 if(route==='conflicts')renderConflicts();
 if(route==='directory')renderDirectory();
 if(route==='history')renderHistory();
 if(route==='data')renderData();
}
function options(arr,current,empty){return (empty!==undefined?`<option value="">${h(empty)}</option>`:'')+arr.map(x=>`<option value="${h(x.id)}" ${x.id===current?'selected':''}>${h(x.name)}</option>`).join('')}
function renderSchedule(){
 $('#heading-actions').innerHTML='<button id="rebuild" data-testid="button-rebuild">Перестроить день</button><button id="print" data-testid="button-print">Печать A4</button>';
 $('#rebuild').onclick=showRebuild;$('#print').onclick=showPrint;
 $('#controls').innerHTML=`<div class="toolbar"><div class="toolbar-group"><button id="prev-date" aria-label="Предыдущий день">‹</button><input aria-label="Дата расписания" id="date" type="date" value="${date}" data-testid="input-date"><button id="next-date" aria-label="Следующий день">›</button><button id="today">Сегодня</button></div><div class="toolbar-group"><select id="grade" aria-label="Ступень"><option value="all">Вся школа</option><option value="primary">1–4 классы</option><option value="middle">5–9 классы</option><option value="senior">10–11 классы</option></select><select id="class" aria-label="Класс">${options(db.classes,classFilter,'Все классы')}</select><div class="segmented"><button data-mode="day" class="${mode==='day'?'active':''}">День</button><button data-mode="week" class="${mode==='week'?'active':''}">Неделя</button></div></div></div>
 <div class="filter-row"><select id="teacher-filter" aria-label="Учитель">${options(db.teachers,teacherFilter,'Все учителя')}</select><button id="class-choice">Выбрать классы</button><span class="spacer"></span>${[['subject','Предмет'],['teacher','Учитель'],['room','Кабинет'],['group','Подгруппа']].map(([k,v])=>`<label><input type="checkbox" data-setting="${k}" ${settings[k]?'checked':''}>${v}</label>`).join('')}<button id="display-settings">Вид слота</button></div>
 <div class="tabs-date">${Array.from({length:6},(_,i)=>{const d=E.addDays(monday(date),i);return `<button class="date-tab ${d===date?'active':''}" data-date="${d}">${['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'][i]}<small>${fmt(d)}</small></button>`}).join('')}</div>`;
 $('#grade').value=grade;
 $('#date').onchange=e=>{date=e.target.value||date;render()};$('#prev-date').onclick=()=>{date=E.addDays(date,mode==='week'?-7:-1);render()};$('#next-date').onclick=()=>{date=E.addDays(date,mode==='week'?7:1);render()};
 $('#today').onclick=()=>{date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());render()};
 $('#grade').onchange=e=>{grade=e.target.value;selectedClasses=null;render()};$('#class').onchange=e=>{classFilter=e.target.value;render()};
 $('#teacher-filter').onchange=e=>{teacherFilter=e.target.value;render()};
 $('#class-choice').onclick=showClassChoice;$('#display-settings').onclick=showSettings;
 $$('[data-setting]').forEach(e=>e.onchange=()=>{settings[e.dataset.setting]=e.checked;render()});
 $$('[data-mode]').forEach(e=>e.onclick=()=>{mode=e.dataset.mode;render()});$$('[data-date]').forEach(e=>e.onclick=()=>{date=e.dataset.date;render()});
 const rows=filteredRows(date),conf=E.conflicts(db,E.effective(db).filter(x=>x.date===date));
 $('#view').innerHTML=`<div class="stat-line"><span><strong>${selected().length}</strong> классов</span><span><strong>${rows.filter(x=>!x.cancelled).length}</strong> занятий с учетом подгрупп</span><span><strong>${rows.filter(x=>db.overrides[x.id]).length}</strong> изменений</span><span><strong>${conf.length}</strong> замечаний за день</span></div>`+(mode==='day'?grid(date):Array.from({length:6},(_,i)=>{const d=E.addDays(monday(date),i);return `<section class="week-section"><div class="date-heading"><h2>${fmt(d)}</h2><span>${days[new Date(d+'T12:00:00').getDay()]}</span></div>${grid(d)}</section>`}).join(''))+'<p class="summary-note">Нажмите на урок для замены, отмены или редактирования. Перетащите карточку в другой слот того же класса. Пересечения исходных данных проверяются отдельно.</p>';
 bindCards();
}
function card(l){
 const changed=!!db.overrides[l.id],abs=E.absenceFor(l,db);
 return `<button class="lesson ${changed?'changed':''} ${l.cancelled?'cancelled':''}" draggable="${!l.locked&&!l.cancelled}" data-lesson="${h(l.id)}" data-testid="lesson-${h(l.id)}" title="${h(lookup('subjects',l.subjectId)?.name)}">
 ${settings.subject?`<strong>${h(subjectName(l))}</strong>`:''}
 ${settings.group&&l.groupName?`<small>${h(l.groupName)}</small>`:''}
 ${settings.teacher?`<small>${h(short(teacherName(l.teacherId)))}</small>`:''}
 <span class="lesson-bottom">${settings.room?`<span>${h(l.roomId?roomName(l.roomId).replace(/\s*\(.*/,''):'Каб. —')}</span>`:'<span></span>'}${l.cancelled?'<span class="tag">Отмена</span>':abs?'<span class="tag danger">Отсутствие</span>':changed?'<span class="tag blue">Изменено</span>':l.locked?'<span class="tag">Закреплен</span>':''}</span></button>`;
}
function grid(d){
 const cls=selected(),rows=filteredRows(d),max=Math.max(8,...rows.map(x=>x.slot));
 if(!cls.length)return '<div class="empty-state"><h2>Классы не выбраны</h2><p>Измените фильтр ступени или выберите классы.</p></div>';
 return `<div class="schedule-scroll"><table class="schedule" style="min-width:${Math.max(850,cls.length*150+58)}px"><thead><tr><th>Урок</th>${cls.map(c=>`<th>${h(c.name)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:max},(_,i)=>i+1).map(slot=>`<tr><td class="slot-label">${slot}<small>${h((rows.find(x=>x.slot===slot)?.time||'').split(' - ')[0])}</small></td>${cls.map(c=>`<td class="drop-cell" data-cell-class="${c.id}" data-cell-date="${d}" data-cell-slot="${slot}">${rows.filter(l=>l.classId===c.id&&l.slot===slot).map(card).join('')||`<button class="empty-slot" data-add="${c.id}|${d}|${slot}" aria-label="Добавить урок ${h(c.name)} ${d} ${slot}">+</button>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function bindCards(){
 $$('[data-lesson]').forEach(b=>{
  b.onclick=()=>showLesson(b.dataset.lesson);
  b.ondragstart=e=>{dragId=b.dataset.lesson;e.dataTransfer.setData('text/plain',dragId)};
 });
 $$('[data-add]').forEach(b=>b.onclick=()=>{const [classId,d,slot]=b.dataset.add.split('|');showLesson(null,{classId,date:d,slot:+slot})});
 $$('.drop-cell').forEach(c=>{
  c.ondragover=e=>{e.preventDefault();c.classList.add('drag-over')};c.ondragleave=()=>c.classList.remove('drag-over');
  c.ondrop=e=>{e.preventDefault();c.classList.remove('drag-over');const l=E.effective(db).find(x=>x.id===dragId);if(!l)return;
   if(l.locked||l.cancelled){message('Закрепленный или отмененный урок не переносится.');return}
   if(l.classId!==c.dataset.cellClass){message('Перенос между классами запрещен: измените урок через редактор, если это действительно нужно.');return}
   const patch={date:c.dataset.cellDate,slot:+c.dataset.cellSlot,...E.slotInfo(db,l.classId,c.dataset.cellDate,+c.dataset.cellSlot)};
   if(l.date===patch.date&&l.slot===patch.slot)return;
   proposeChange(l,patch,'Перенос урока',()=>transact('Перенос урока',()=>{db.overrides[l.id]={...db.overrides[l.id],...patch}}));
  };
 });
}
function dialog(title,body,buttons=[]){
 $('#dialog-content').innerHTML=`<div class="dialog-header"><h2>${h(title)}</h2><button id="close-dialog" aria-label="Закрыть">×</button></div><div class="dialog-body">${body}</div><div class="dialog-footer">${buttons.map((b,i)=>`<button id="dialog-action-${i}" class="${b.class||''}">${h(b.text)}</button>`).join('')}</div>`;
 $('#close-dialog').onclick=()=>$('#dialog').close();buttons.forEach((b,i)=>$('#dialog-action-'+i).onclick=b.action);
 if(!$('#dialog').open)$('#dialog').showModal();
}
function proposeChange(l,patch,title,commit){
 const next=E.resolvePatches(db,[{id:l.id,before:l,after:{...l,...patch}}])[0].after;
 Object.assign(patch,next);
 const issues=E.changeIssues(next,db,E.effective(E.patchedDB(db,[{id:l.id,before:l,after:next}])));
 if(issues.length){dialog('Изменение не применено',`<p>Нужно устранить пересечения до сохранения:</p><ul>${issues.map(x=>`<li>${h(x)}</li>`).join('')}</ul><p class="hint">Исходное расписание не изменилось. Сначала освободите слот, выберите другого учителя или уточните подгруппу.</p>`,[{text:'Понятно',action:()=>$('#dialog').close()}]);return}
 dialog(title,`<p>${h(lookup('classes',l.classId)?.name)} · ${h(lookup('subjects',next.subjectId)?.name)}<br>${fmt(next.date)}, урок ${next.slot}<br>${h(teacherName(next.teacherId))}<br>Кабинет: ${h(typeof RoomAllocator!=='undefined'?RoomAllocator.number(roomName(next.roomId))||'не указан':roomName(next.roomId))}</p><p class="hint">Изменится только рабочая копия на эту дату. Автоматические кабинеты учитывают новое назначение. ВШ останется без изменений.</p>`,[{text:'Назад',action:()=>$('#dialog').close()},{text:'Применить',class:'primary',action:()=>{$('#dialog').close();commit()}}]);
}
function showLesson(id,initial){
 const old=id?E.effective(db).find(l=>l.id===id):{id:'local-'+(crypto.randomUUID?.()||Date.now()),...initial,subjectId:db.subjects[0]?.id,teacherId:null,roomId:null,groupName:null,locked:false,...E.slotInfo(db,initial.classId,initial.date,initial.slot)};
 const baseline=db.lessons.find(x=>x.id===id);
 const cand=E.candidates(old,db),allowed=cand.filter(x=>!x.busy);
 const groups=db.groups.filter(x=>x.classId===old.classId);
 const body=`<p class="hint">${h(lookup('classes',old.classId)?.name)} · ${fmt(old.date)} · ${id?'Исходная запись сохраняется отдельно':'Новый урок в локальном файле'}</p><div class="form-grid">
 <label class="field full">Предмет<select id="edit-subject">${options(db.subjects,old.subjectId)}</select></label>
 <label class="field">Дата<input id="edit-date" type="date" value="${old.date}"></label><label class="field">Номер урока<input id="edit-slot" type="number" min="1" max="20" value="${old.slot}"></label>
 <label class="field">Начало<input id="edit-start" type="time" value="${h((old.time||'').split(' - ')[0])}"></label><label class="field">Окончание<input id="edit-end" type="time" value="${h((old.time||'').split(' - ')[1]||'')}"></label>
 <label class="field full">Учитель<select id="edit-teacher">${options(db.teachers,old.teacherId,'Не назначен')}</select></label>
 <label class="field">Кабинет<select id="edit-room">${options(db.rooms,old.roomId,'Не указан')}</select></label>
 <label class="field">Подгруппа / профиль<input id="edit-group" type="text" list="group-list" value="${h(old.groupName||'')}" placeholder="Весь класс"><datalist id="group-list">${[...new Set(groups.map(g=>g.name))].map(n=>`<option value="${h(n)}">`).join('')}</datalist></label>
 <label class="checkbox-line"><input type="checkbox" id="edit-locked" ${old.locked?'checked':''}>Закрепить урок</label>
 </div><p class="hint">Подгруппы «1» и «2» считаются непересекающимися. Для произвольных названий состав не угадывается. Разделение: задайте первую подгруппу и добавьте второй урок в тот же слот.</p>
 <h3>Кандидаты на замену</h3><p class="hint">Проверены по расписанию и введенным отсутствиям. Свободный слот не гарантирует согласие учителя. Приоритет: свой предмет, затем знакомый класс.</p>
 <div id="candidate-list">${allowed.slice(0,6).map(x=>`<div class="candidate"><div>${h(x.teacher.name)}<small>${h(x.qualification)}${x.known?' · знаком с классом':''}</small></div><button data-candidate="${x.teacher.id}">Выбрать</button></div>`).join('')||'<p>Нет свободных учителей этого или смежного предмета.</p>'}</div><p class="hint">Предлагаются только преподаватели этого или смежного предмета. При изменении даты, слота или предмета кандидаты пересчитываются.</p>`;
 const actions=[];
 if(id)actions.push({text:old.cancelled?'Восстановить':'Отменить урок',class:'danger',action:()=>{if(old.cancelled){proposeChange(old,{cancelled:false},'Восстановление урока',()=>transact('Восстановление урока',()=>{db.overrides[id]={...db.overrides[id],cancelled:false}}))}else cancelLesson(old)}});
 if(id)actions.push({text:'Добавить подгруппу',action:()=>showLesson(null,{classId:old.classId,date:old.date,slot:old.slot})});
 actions.push({text:'Сохранить изменение',class:'primary',action:()=>{
  const dt=$('#edit-date').value,slot=+$('#edit-slot').value;
  if(!dt||slot<1||slot>20||!Number.isInteger(slot)){message('Укажите корректную дату и номер урока.');return}
  const start=$('#edit-start').value,end=$('#edit-end').value;
  if(!start||!end||end<=start){message('Укажите время начала и окончания урока. Окончание должно быть позже начала.');return}
  const patch={subjectId:$('#edit-subject').value,teacherId:$('#edit-teacher').value||null,roomId:$('#edit-room').value||null,date:dt,slot,groupName:$('#edit-group').value.trim()||null,locked:$('#edit-locked').checked,...E.slotInfo(db,old.classId,dt,slot)};
  if(patch.time!==start+' - '+end)patch.callId=null;
  patch.time=start+' - '+end;
  patch.roomMode=$('#edit-room-auto')?.checked?'auto':'manual';
  if(patch.groupName!==old.groupName){patch.profileAudience=null;patch.profileManual=false}
  if(!id||patch.subjectId!==old.subjectId||patch.groupName!==old.groupName){
   const course=db.courses.find(c=>c.classId===old.classId&&c.subjectId===patch.subjectId&&(c.groupName||null)===patch.groupName);
   patch.courseId=course?.id||null;
  }
  if(id&&typeof saveRoomChange==='function'&&E.roomOnlyChange(old,{...old,...patch})){saveRoomChange(old,{...old,...patch});return}
  if(!patch.teacherId){dialog('Учитель не выбран','<p>Выберите учителя до добавления или редактирования урока. Импортированные незаполненные назначения остаются видны в контроле.</p>',[{text:'К уроку',action:()=>showLesson(id,initial)}]);return}
  proposeChange(old,patch,id?'Изменение урока':'Добавление урока',()=>transact(id?'Изменение урока':'Добавление урока',()=>{if(id)db.overrides[id]={...db.overrides[id],...patch};else db.extraLessons.push({...old,...patch})}));
 }});
 dialog(id?'Урок · '+(lookup('classes',old.classId)?.name||''):'Новый урок',body,actions);
 function updateCandidates(){
  const temp={...old,subjectId:$('#edit-subject').value,date:$('#edit-date').value,slot:+$('#edit-slot').value,time:$('#edit-start').value+' - '+$('#edit-end').value};
  const list=E.candidates(temp,db).filter(x=>!x.busy);
  $('#candidate-list').innerHTML=list.slice(0,8).map(x=>`<div class="candidate"><div>${h(x.teacher.name)}<small>${h(x.qualification)}${x.known?' · знаком с классом':''}</small></div><button data-candidate="${x.teacher.id}">Выбрать</button></div>`).join('')||'<p>Нет свободных учителей этого или смежного предмета.</p>';
  $$('[data-candidate]').forEach(b=>b.onclick=()=>{$('#edit-teacher').value=b.dataset.candidate;$('#edit-teacher').dispatchEvent(new Event('change'))});
 }
 $$('[data-candidate]').forEach(b=>b.onclick=()=>{$('#edit-teacher').value=b.dataset.candidate;$('#edit-teacher').dispatchEvent(new Event('change'))});
 ['#edit-start','#edit-end','#edit-subject'].forEach(s=>$(s).onchange=updateCandidates);
 ['#edit-date','#edit-slot'].forEach(s=>$(s).onchange=()=>{const info=E.slotInfo(db,old.classId,$('#edit-date').value,+$('#edit-slot').value);$('#edit-start').value=(info.time||'').split(' - ')[0];$('#edit-end').value=(info.time||'').split(' - ')[1]||'';updateCandidates()});
 if(typeof attachRoomEditor==='function')attachRoomEditor(old);
}
function cancelLesson(l){
 dialog('Отмена без замены',`<p>${h(subjectName(l))} · ${h(lookup('classes',l.classId)?.name)} · ${fmt(l.date)} · урок ${l.slot}</p><label class="field">Причина<input id="cancel-reason" type="text" value="Отсутствие учителя без замены"></label><p class="hint">Базовая запись сохранится. Отмена появится в журнале изменений; это не автоматическое оформление отгула.</p>`,[{text:'Отмена действия',action:()=>$('#dialog').close()},{text:'Отменить урок',class:'danger',action:()=>{const reason=$('#cancel-reason').value.trim();$('#dialog').close();transact('Отмена урока без замены',()=>{db.overrides[l.id]={...db.overrides[l.id],cancelled:true,cancelReason:reason}})}}]);
}
function showSettings(){
 dialog('Отображение слотов',`<div class="form-grid">${[['subject','Название предмета'],['teacher','Фамилия учителя'],['room','Кабинет'],['group','Подгруппа / профиль'],['abbreviate','Сокращения предметов'],['showCancelled','Показывать отмененные']].map(([k,v])=>`<label class="checkbox-line"><input type="checkbox" data-display="${k}" ${settings[k]?'checked':''}>${v}</label>`).join('')}</div><p class="hint">Настройки попадут в сохраняемый рабочий JSON. Сокращения можно изменить в справочнике предметов.</p>`,[{text:'Применить',class:'primary',action:()=>{$$('[data-display]').forEach(x=>settings[x.dataset.display]=x.checked);dirty=true;$('#dialog').close();render()}}]);
}
function showClassChoice(){
 dialog('Классы на экране',`<div class="class-choices">${db.classes.map(c=>`<label><input type="checkbox" value="${c.id}" data-class-choice ${!selectedClasses||selectedClasses.has(c.id)?'checked':''}>${h(c.name)}</label>`).join('')}</div>`,[{text:'Выбрать все',action:()=>$$('[data-class-choice]').forEach(x=>x.checked=true)},{text:'Применить',class:'primary',action:()=>{selectedClasses=new Set($$('[data-class-choice]:checked').map(x=>x.value));classFilter='';grade='all';$('#dialog').close();render()}}]);
}
function renderAbsences(){
 $('#heading-actions').innerHTML='<button class="primary" id="add-absence">Добавить отсутствие</button>';
 $('#add-absence').onclick=()=>showAbsence();
 const all=E.effective(db),affected=all.filter(l=>!l.cancelled&&E.absenceFor(l,db));
 $('#view').innerHTML=`<div class="stats-grid"><div class="stat-card"><strong>${db.absences.length}</strong><span>записей отсутствий</span></div><div class="stat-card"><strong>${affected.length}</strong><span>занятий требуют решения</span></div><div class="stat-card"><strong>${all.filter(l=>l.cancelled).length}</strong><span>отмен без замены</span></div><div class="stat-card"><strong>${all.filter(l=>db.overrides[l.id]?.teacherId&&db.lessons.find(b=>b.id===l.id)?.teacherId!==l.teacherId).length}</strong><span>замен учителя</span></div></div>
 <div class="panel"><h2>Журнал отсутствий</h2><p class="hint">Учет ведется по датам. Причина «отгул» является вашей пометкой, а не кадровым документом или расчетом оплаты.</p>${db.absences.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Учитель</th><th>Период</th><th>Причина</th><th>Не решено</th><th>Действия</th></tr></thead><tbody>${db.absences.map(a=>`<tr><td>${h(teacherName(a.teacherId))}</td><td>${a.startDate}<br>${a.endDate}</td><td>${h(a.reason)}<br>${h(a.note)}</td><td>${affected.filter(l=>l.teacherId===a.teacherId&&l.date>=a.startDate&&l.date<=a.endDate).length}</td><td><button data-cancel-all="${a.id}">Отменить без замены</button> <button data-remove-absence="${a.id}">Снять отметку</button></td></tr>`).join('')}</tbody></table></div>`:'<p>Отсутствия пока не внесены. Добавьте учителя и даты, чтобы увидеть уроки, для которых нужна замена.</p>'}</div>
 <div class="panel"><h2>Уроки, требующие решения</h2>${affected.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Дата / урок</th><th>Класс</th><th>Предмет</th><th>Учитель</th><th></th></tr></thead><tbody>${affected.slice(0,200).map(l=>`<tr><td>${l.date} · ${l.slot}</td><td>${h(lookup('classes',l.classId)?.name)}</td><td>${h(subjectName(l))} ${h(l.groupName)}</td><td>${h(teacherName(l.teacherId))}</td><td><button data-resolve="${h(l.id)}">Выбрать замену</button></td></tr>`).join('')}</tbody></table></div><p class="hint">Показано до 200 записей. Полные данные сохраняются в JSON.</p>`:'<p>Нет занятий с назначенным отсутствующим учителем.</p>'}</div>
 <div class="panel"><h2>Учет по учителям</h2><button id="absence-csv">Скачать CSV учета</button><p class="hint">Число записей отмен и замен. При объединенных группах это не равно автоматически оплачиваемым часам.</p></div>`;
 $$('[data-resolve]').forEach(b=>b.onclick=()=>showLesson(b.dataset.resolve));
 $$('[data-cancel-all]').forEach(b=>b.onclick=()=>{const a=db.absences.find(x=>x.id===b.dataset.cancelAll),ls=affected.filter(l=>l.teacherId===a.teacherId&&l.date>=a.startDate&&l.date<=a.endDate);dialog('Отмена занятий без замены',`<p>${h(teacherName(a.teacherId))}: ${ls.length} записей с ${a.startDate} по ${a.endDate}. Все они будут отменены только в рабочей копии.</p>`,[{text:'Назад',action:()=>$('#dialog').close()},{text:'Отменить '+ls.length+' занятий',class:'danger',action:()=>{$('#dialog').close();transact('Массовая отмена без замены',()=>ls.forEach(l=>db.overrides[l.id]={...db.overrides[l.id],cancelled:true,cancelReason:a.reason,absenceId:a.id}))}}])});
 $$('[data-remove-absence]').forEach(b=>b.onclick=()=>dialog('Снять отметку отсутствия','<p>Ранее сделанные замены и отмены автоматически не восстанавливаются. Их можно изменить в расписании или отменить через историю.</p>',[{text:'Снять отметку',class:'primary',action:()=>{$('#dialog').close();transact('Снятие отметки отсутствия',()=>db.absences=db.absences.filter(x=>x.id!==b.dataset.removeAbsence))}}]));
 $('#absence-csv').onclick=()=>{const rows=db.teachers.map(t=>({teacher:t.name,absences:db.absences.filter(a=>a.teacherId===t.id).length,cancelled:all.filter(l=>l.cancelled&&l.teacherId===t.id).length,replacements:all.filter(l=>l.teacherId===t.id&&db.overrides[l.id]?.teacherId&&db.lessons.find(x=>x.id===l.id)?.teacherId!==t.id).length}));csv('teacher_absence_account.csv',rows)};
}
function showAbsence(){
 dialog('Отсутствие учителя',`<div class="form-grid"><label class="field full">Учитель<select id="absence-teacher">${options(db.teachers,'')}</select></label><label class="field">С даты<input type="date" id="absence-start" value="${date}"></label><label class="field">По дату включительно<input type="date" id="absence-end" value="${date}"></label><label class="field full">Причина<select id="absence-reason"><option>Отсутствие</option><option>Больничный</option><option>Отгул</option><option>Командировка</option><option>Мероприятие</option></select></label><label class="field full">Примечание<input id="absence-note" type="text" placeholder="Основание или комментарий"></label></div><p class="hint">Уроки не будут отменены автоматически. После записи выберите замену или отмену без замены.</p><p id="absence-error" class="hint"></p>`,[{text:'Записать отсутствие',class:'primary',action:()=>{
  const startDate=$('#absence-start').value,endDate=$('#absence-end').value,teacherId=$('#absence-teacher').value;
  if(!startDate||!endDate||endDate<startDate){$('#absence-error').textContent='Проверьте диапазон дат.';return}
  if(db.absences.some(a=>a.teacherId===teacherId&&a.startDate<=endDate&&a.endDate>=startDate)){$('#absence-error').textContent='У этого учителя уже есть пересекающийся период отсутствия.';return}
  const a={id:'absence-'+Date.now(),teacherId,startDate,endDate,reason:$('#absence-reason').value,note:$('#absence-note').value};
  $('#dialog').close();transact('Регистрация отсутствия',()=>db.absences.push(a));
 }}]);
}
function showRebuild(){
 proposal=E.rebuild(db,date,selected().map(c=>c.id));
 dialog('Перестроение · '+fmt(date),`<p>Сдвиг более поздних занятий в свободные ранние слоты без изменения порядка. Блок подгрупп переносится вместе; закрепленные уроки не перемещаются.</p><p class="hint">Проверяются учителя, кабинеты и пересечения групп. Это локальное уплотнение одного дня, не генератор годового расписания.</p>${proposal.length?`<table class="data-table"><thead><tr><th>Класс / предмет</th><th>Было</th><th>Предложено</th></tr></thead><tbody>${proposal.map(p=>`<tr><td>${h(lookup('classes',p.after.classId)?.name)} · ${h(subjectName(p.after))}<br>${h(p.after.groupName)}</td><td>${p.before.slot}</td><td>${p.after.slot}</td></tr>`).join('')}</tbody></table>`:'<p><strong>Безопасных переносов не найдено.</strong> Возможные причины: нет окон, заняты учителя или кабинеты, уроки закреплены.</p>'}`,proposal.length?[{text:'Не применять',action:()=>$('#dialog').close()},{text:'Применить '+proposal.length+' переносов',class:'primary',action:()=>{$('#dialog').close();transact('Перестроение дня '+date,()=>proposal.forEach(p=>db.overrides[p.id]={...db.overrides[p.id],slot:p.after.slot,time:p.after.time,callId:p.after.callId}))}}]:[{text:'Закрыть',action:()=>$('#dialog').close()}]);
}
function renderConflicts(){
 $('#controls').innerHTML=`<div class="toolbar"><label>Дата <input id="conflict-date" type="date" value="${date}"></label><button id="conflict-export">Скачать замечания за день</button></div>`;
 $('#conflict-date').onchange=e=>{date=e.target.value||date;render()};
 const ls=E.effective(db).filter(x=>x.date===date),issues=E.conflicts(db,ls);
 const baseline=E.conflicts({...db,overrides:{},extraLessons:[],absences:[]},db.lessons.filter(x=>x.date===date));
 const key=i=>i.kind+'|'+i.lessonIds.slice().sort().join('|'),orig=new Set(baseline.map(key));
 const rows=issues.map(i=>({...i,status:orig.has(key(i))?'Уже в исходных данных':'В рабочей копии'}));
 $('#view').innerHTML=`<p class="summary-note">Найдено ${rows.length} замечаний. Общий кабинет для объединенных групп может быть допустим: программа помечает его для проверки, но не делает вывод о фактической ошибке.</p>${rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Проверка</th><th>Занятия</th><th>Происхождение</th><th></th></tr></thead><tbody>${rows.slice(0,500).map(i=>`<tr><td>${h(i.kind)}</td><td>${i.lessonIds.map(id=>{const l=ls.find(x=>x.id===id);return h(lookup('classes',l.classId)?.name+' · '+l.slot+' · '+subjectName(l))}).join('<br>')}</td><td><span class="tag ${i.status==='В рабочей копии'?'warning':''}">${i.status}</span></td><td><button data-resolve="${h(i.lessonIds[0])}">Открыть урок</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><h2>Пересечения не обнаружены</h2><p>По имеющимся данным за выбранную дату учителя, кабинеты и учебные группы не пересекаются. Это не проверка всех санитарных или кадровых требований.</p></div>'}`;
 $$('[data-resolve]').forEach(b=>b.onclick=()=>showLesson(b.dataset.resolve));$('#conflict-export').onclick=()=>csv('schedule_checks_'+date+'.csv',rows.map(x=>({...x,lessonIds:x.lessonIds.join(',')})));
}
let directoryTab='classes',directorySearch='';
function renderDirectory(){
 const tabs={classes:'Классы',teachers:'Учителя',subjects:'Предметы',courses:'Учебный план',groups:'Подгруппы',periods:'Периоды'};
 $('#controls').innerHTML=`<div class="toolbar"><div class="segmented">${Object.entries(tabs).map(([k,v])=>`<button data-directory="${k}" class="${directoryTab===k?'active':''}">${v}</button>`).join('')}</div><button id="directory-export">Скачать CSV</button></div>`;
 const rows=db[directoryTab].filter(r=>JSON.stringify(r).toLowerCase().includes(directorySearch.toLowerCase()));
 const columns={classes:[['name','Класс'],['activeEnrollments','Учеников'],['classHeadName','Классный руководитель']],teachers:[['name','ФИО'],['id','ID ВШ']],subjects:[['name','Предмет'],['abbreviation','Локальное сокращение'],['sourceSysname','Код ВШ']],courses:[['classId','Класс'],['subjectId','Предмет'],['groupName','Подгруппа'],['level','Уровень'],['weeklyHours','Часов'],['teacherId','Учитель']],groups:[['classId','Класс'],['name','Название'],['subjectId','Предмет'],['level','Уровень']],periods:[['templateId','Шаблон'],['name','Период'],['startDate','Начало'],['endDate','Конец']]}[directoryTab];
 function value(r,k){if(k==='classId')return lookup('classes',r[k])?.name;if(k==='subjectId')return lookup('subjects',r[k])?.name;if(k==='teacherId')return r[k]?teacherName(r[k]):'Не назначен';if(k==='abbreviation')return settings.labels[r.id]||r[k];return r[k]??'—'}
 $('#view').innerHTML=`<p class="summary-note">${rows.length} записей. Родительский курс и курс подгруппы могут иметь разные назначения учителя.</p><input id="directory-search" class="table-search" type="search" placeholder="Поиск по справочнику" aria-label="Поиск по справочнику" value="${h(directorySearch)}"><div class="table-wrap"><table class="data-table"><thead><tr>${columns.map(x=>`<th>${x[1]}</th>`).join('')}${directoryTab==='subjects'?'<th></th>':''}</tr></thead><tbody>${rows.slice(0,800).map(r=>`<tr>${columns.map(([k])=>`<td>${h(value(r,k))}</td>`).join('')}${directoryTab==='subjects'?`<td><button data-label="${r.id}">Сокращение</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
 $$('[data-directory]').forEach(b=>b.onclick=()=>{directoryTab=b.dataset.directory;directorySearch='';render()});
 $('#directory-search').oninput=e=>{const pos=e.target.selectionStart;directorySearch=e.target.value;renderDirectory();$('#directory-search').focus();$('#directory-search').setSelectionRange(pos,pos)};
 $('#directory-export').onclick=()=>csv(directoryTab+'.csv',rows);
 $$('[data-label]').forEach(b=>b.onclick=()=>{const sub=lookup('subjects',b.dataset.label);dialog('Сокращение предмета',`<p>${h(sub.name)}</p><label class="field">Отображаемое сокращение<input type="text" id="subject-label" value="${h(settings.labels[sub.id]||sub.abbreviation||sub.name)}"></label><p class="hint">Меняется только локальная подпись. Название в ВШ не меняется.</p>`,[{text:'Сохранить',class:'primary',action:()=>{settings.labels[sub.id]=$('#subject-label').value.trim()||sub.name;dirty=true;$('#dialog').close();render()}}])});
}
function renderHistory(){
 $('#heading-actions').innerHTML=`<button id="undo" ${db.history.length?'':'disabled'}>Отменить последнее действие</button>`;
 $('#undo').onclick=undo;
 $('#view').innerHTML=db.history.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Время</th><th>Действие</th><th>Изменений уроков после действия</th></tr></thead><tbody>${db.history.slice().reverse().map(x=>`<tr><td>${h(new Date(x.at).toLocaleString('ru-RU'))}</td><td>${h(x.label)}</td><td>${Object.keys(x.after?.overrides||{}).length}</td></tr>`).join('')}</tbody></table></div><p class="summary-note">История сохраняется внутри рабочего файла. Отмена применяется в обратном порядке; она не отправляется в ВШ.</p>`:'<div class="empty-state"><h2>Исходное расписание без изменений</h2><p>Здесь появятся замены, отмены, переносы и записи отсутствий, сделанные в рабочей копии.</p></div>';
}
function renderData(){
 $('#view').innerHTML=`<div class="stats-grid">${[['classes','Классы'],['teachers','Учителя'],['subjects','Предметы'],['lessons','Исходные записи уроков']].map(([k,v])=>`<div class="stat-card"><strong>${db[k].length.toLocaleString('ru-RU')}</strong><span>${v}</span></div>`).join('')}</div>
 <div class="panel"><h2>Рабочий файл</h2><p>Откройте <b>school_schedule.json</b> из выдачи. После работы нажмите «Сохранить файл», а при следующем запуске откройте последнюю сохраненную версию.</p><button id="data-open" class="primary">Открыть JSON</button> <button id="data-save">Сохранить рабочую копию</button> <button id="schedule-csv">Расписание в CSV</button>
 <p class="hint">Файл полностью обрабатывается в памяти браузера. Нет автоматического сохранения, общего сервера, входа пользователей или фоновой синхронизации. Закрытие и перезагрузка вкладки удаляют несохраненное состояние.</p></div>
 <div class="panel"><h2>Как работать</h2><ol class="help-list"><li>На экране расписания выберите дату, ступень или несколько классов. Режим «Неделя» показывает шесть дней для всех выбранных классов.</li><li>Нажмите на урок. Измените учителя, кабинет, дату или слот. Для замены выберите свободного кандидата; приоритет отдается преподавателю предмета.</li><li>В «Заменах и отсутствиях» внесите период. Затем решите каждый урок или отмените все занятия отсутствующего учителя без замены.</li><li>После отмены откройте «Перестроить день». Программа предложит безопасное уплотнение без изменения порядка уроков. Переносы применяются только после подтверждения.</li><li>Чтобы разделить слот, задайте первому уроку подгруппу «1», а затем добавьте в этот слот урок подгруппы «2». Для 11 класса поддержана проверка известных профилей и уровней. Неизвестный состав считается потенциально пересекающимся.</li><li>«Закрепить урок» исключает его из перетаскивания и автоматического уплотнения. Редактор остается доступным.</li><li>«Печать A4» разбивает выбранные классы на страницы. Не уменьшайте 25 классов до одного нечитаемого листа: используйте 3–6 колонок на странице.</li><li>Сохраните JSON. Он содержит базу расписания, изменения, отсутствия, историю и настройки подписей.</li></ol></div>
 <div class="panel"><h2>Границы первой версии</h2><p>Это самостоятельный диспетчер расписания, а не полный аналог aSc. Нет годовой генерации по нагрузке, многопользовательской синхронизации, кадрового расчета, уведомлений учителям или обратной записи в ВШ. Проверяются временные конфликты, но не весь набор санитарных требований и педагогических ограничений.</p><p>При импорте полной базы поля учеников, СНИЛС, адресов, документов и индивидуального состава групп не загружаются в диспетчер. Для них используйте отдельные читаемые файлы и SQLite. Сам файл расписания содержит ФИО учителей: не публикуйте его без необходимости.</p></div>
 <div class="panel"><h2>Резервная копия и очистка</h2><p>Для надежного хранения держите сохраненные версии в защищенной папке. Демонстрация не содержит настоящих данных школы.</p><button id="reset-demo" class="danger">Закрыть данные и открыть пример</button></div>`;
 $('#data-open').onclick=()=>$('#file').click();$('#data-save').onclick=save;$('#schedule-csv').onclick=()=>csv('timetable.csv',E.effective(db).map(l=>({...l,class:lookup('classes',l.classId)?.name,subject:lookup('subjects',l.subjectId)?.name,teacher:teacherName(l.teacherId),room:roomName(l.roomId)})));
 $('#reset-demo').onclick=()=>dialog('Закрыть рабочие данные','<p>Несохраненные изменения будут потеряны. Сначала сохраните JSON, если он нужен.</p>',[{text:'Сохранить файл',action:save},{text:'Закрыть без сохранения',class:'danger',action:()=>{$('#dialog').close();db=makeDemo();dirty=false;settings.labels={};selectedClasses=null;classFilter='';teacherFilter='';date='2026-09-21';render()}}]);
}
function csv(name,rows){
 const keys=[...new Set(rows.flatMap(Object.keys))];
 const cell=v=>{let s=typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
 download(name,'\ufeff'+keys.map(cell).join(';')+'\r\n'+rows.map(r=>keys.map(k=>cell(r[k])).join(';')).join('\r\n'),'text/csv;charset=utf-8');
}
function showPrint(){
 dialog('Печать на A4',`<div class="form-grid"><label class="field">Дата<input id="print-date" type="date" value="${date}"></label><label class="field">Классов на странице<select id="print-columns"><option value="3">3 · крупно</option><option value="4" selected>4 · оптимально</option><option value="5">5 · компактно</option><option value="6">6 · очень компактно</option></select></label></div><p class="hint">A4, альбомная ориентация. Все выбранные классы будут разбиты на отдельные страницы. Печатается предмет, учитель, кабинет и подгруппа; отмененные уроки помечаются.</p><div class="class-choices">${db.classes.map(c=>`<label><input type="checkbox" data-print-class value="${c.id}" ${selected().some(x=>x.id===c.id)?'checked':''}>${h(c.name)}</label>`).join('')}</div><p id="print-error" class="hint"></p>`,[{text:'Все классы',action:()=>$$('[data-print-class]').forEach(x=>x.checked=true)},{text:'Печатать / сохранить PDF',class:'primary',action:()=>{
  const ids=$$('[data-print-class]:checked').map(x=>x.value),dt=$('#print-date').value,n=+$('#print-columns').value;
  if(!ids.length||!dt){$('#print-error').textContent='Выберите дату и хотя бы один класс.';return}
  buildPrint(dt,ids,n);$('#dialog').close();window.print();
 }}]);
}
function buildPrint(dt,ids,n){
 const ls=E.effective(db).filter(x=>x.date===dt),max=Math.max(8,...ls.map(x=>x.slot));let out='';
 for(let i=0;i<ids.length;i+=n){
  const cls=ids.slice(i,i+n).map(id=>lookup('classes',id));
  out+=`<section class="print-page ${cls.length===1?'single':''}"><h1>${h(db.meta.school)} · ${fmt(dt)} · ${days[new Date(dt+'T12:00:00').getDay()]}</h1><table><thead><tr><th>№</th>${cls.map(c=>`<th>${h(c.name)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:max},(_,j)=>j+1).map(s=>`<tr><td>${s}</td>${cls.map(c=>`<td>${ls.filter(x=>x.classId===c.id&&x.slot===s).map(l=>`<div class="print-card"><strong>${l.cancelled?'ОТМЕНА · ':''}${h(subjectName(l))}</strong>${l.groupName?`<small>${h(l.groupName)}</small>`:''}<small>${h(short(teacherName(l.teacherId)))} · ${h(l.roomId?roomName(l.roomId).replace(/\s*\(.*/,''):'')}</small></div>`).join('')||'—'}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="print-footer">Рабочая копия · ${db.meta.demo?'Демонстрационные данные · ':''}Изменения включены · Группа страниц ${Math.floor(i/n)+1} из ${Math.ceil(ids.length/n)}</p></section>`;
 }
 $('#print-root').innerHTML=out;
}
$('#open-file').onclick=()=>$('#file').click();$('#save-file').onclick=save;
$('#file').onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 try{
  if(f.size>80*1024*1024)throw Error('Файл больше 80 МБ. Откройте компактный school_schedule.json.');
  const next=normalize(JSON.parse(await f.text()));
  const apply=()=>{db=next;settings={...settings,...db.preferences,labels:db.preferences?.labels||{}};dirty=false;selectedClasses=null;grade='all';classFilter='';teacherFilter='';date=db.lessons.some(l=>l.date==='2026-09-21')?'2026-09-21':db.lessons[0]?.date||date;render();message('Файл открыт: '+f.name+'. Персональные поля учеников не загружены в диспетчер.')};
  if(dirty)dialog('Открыть другой файл?','<p>Несохраненные изменения текущего файла будут потеряны.</p>',[{text:'Сначала сохранить',action:save},{text:'Заменить рабочие данные',class:'danger',action:()=>{$('#dialog').close();apply()}}]);else apply();
 }catch(err){message('Не удалось открыть файл: '+err.message)}
 e.target.value='';
};
let theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=theme;
$('#theme').onclick=()=>{theme=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
db=makeDemo();
