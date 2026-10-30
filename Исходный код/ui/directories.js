/* Editable linked school directories; IDs remain stable across all views. */
const directoryNames={classes:'Классы',groups:'Подгруппы / профили',teachers:'Учителя',rooms:'Кабинеты',subjects:'Предметы'};
let studioDirectory='classes',studioSearch='';
function directoryHead(c){return db.teachers.find(t=>t.id===c.classHeadId)?.name||c.classHeadName||'—'}
function directoryHours(subjectId,teacherId){return db.courses.filter(c=>(!subjectId||c.subjectId===subjectId)&&(!teacherId||c.teacherId===teacherId)&&(!subjectId||c.teacherId||!db.courses.some(x=>x.classId===c.classId&&x.subjectId===c.subjectId&&x.teacherId))).reduce((n,c)=>n+(+c.weeklyHours||0),0)}
function directorySlots(t){return t.allowedSlots?.join(', ')||'Любые'}
function directoryRoom(c){const id=c.homeRoomId||settings.roomPolicy?.classRooms?.[c.id]?.[0];return id?PrintTools.roomNumber(roomName(id)):'—'}
renderDirectory=function(){
 $('#heading-actions').innerHTML=`<button id="directory-add" class="primary">Добавить</button>`;
 $('#controls').innerHTML=`<div class="directory-tabs">${Object.entries(directoryNames).map(([k,n])=>`<button data-dir-tab="${k}" class="${studioDirectory===k?'primary':''}">${n}</button>`).join('')}</div>`;
 const rows=db[studioDirectory].filter(x=>!studioSearch||[x.name,x.shortName,lookup('classes',x.classId)?.name].join(' ').toLowerCase().includes(studioSearch.toLowerCase()));
 const columns={classes:['Класс','Количество','Классный руководитель','Закреплённый кабинет'],groups:['Класс','Название подгруппы / профиля','Предмет деления','Уровень'],teachers:['ФИО','Сокращение','Цвет','Нагрузка, ч/нед.','Рабочие дни','Разрешённые уроки'],rooms:['Название','Вместимость','Закреплённый учитель'],subjects:['Название','Сокращение','Всего часов в неделю']}[studioDirectory];
 function cells(x){
  if(studioDirectory==='classes')return [x.name,x.pupilCount??x.sourcePupilCount??0,directoryHead(x),directoryRoom(x)];
  if(studioDirectory==='groups')return [lookup('classes',x.classId)?.name||'—',x.name,lookup('subjects',x.subjectId)?.name||'—',x.level||'Базовый'];
  if(studioDirectory==='teachers')return [x.name,studioTeacher(x.id),{color:x.color||W.teacherColor(x.id,db)},directoryHours(null,x.id),(x.workDays||[1,2,3,4,5]).map(d=>days[d]).join(', '),directorySlots(x)];
  if(studioDirectory==='rooms')return [x.name,x.capacity??'—',db.teachers.filter(t=>settings.roomPolicy?.teacherRooms?.[t.id]===x.id).map(t=>studioTeacher(t.id)).join(', ')||'—'];
  return [x.name,settings.labels[x.id]||x.abbreviation||'—',directoryHours(x.id)];
 }
 $('#view').innerHTML=`<div class="directory-tools"><input id="studio-directory-search" type="search" placeholder="Поиск" aria-label="Поиск по справочнику" value="${h(studioSearch)}"><span class="hint">${rows.length} записей · изменения сохраняются автоматически</span></div><div class="table-wrap"><table class="data-table directory-editor-table"><thead><tr>${columns.map(c=>`<th>${c}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map(x=>`<tr>${cells(x).map(v=>`<td>${v&&typeof v==='object'?`<span class="color-chip" style="background:${h(v.color)}" aria-label="Цвет учителя"></span>`:h(v)}</td>`).join('')}<td><button data-dir-edit="${h(x.id)}">Изменить</button></td></tr>`).join('')}</tbody></table></div>`;
 $$('[data-dir-tab]').forEach(b=>b.onclick=()=>{studioDirectory=b.dataset.dirTab;studioSearch='';render()});
 $('#directory-add').onclick=()=>editDirectory(studioDirectory);
 $$('[data-dir-edit]').forEach(b=>b.onclick=()=>editDirectory(studioDirectory,b.dataset.dirEdit));
 $('#studio-directory-search').oninput=e=>{studioSearch=e.target.value;const pos=e.target.selectionStart;renderDirectory();$('#studio-directory-search').focus();$('#studio-directory-search').setSelectionRange(pos,pos)};
};
function dirInput(key,title,value='',type='text',extra=''){return `<label>${title}<input id="dir-${key}" type="${type}" value="${h(value)}" ${extra}></label>`}
function dirSelect(key,title,rows,current,empty){return `<label>${title}<select id="dir-${key}">${options(rows,current,empty)}</select></label>`}
function editDirectory(kind,id=null,initial={},back=null){
 const old=id?db[kind].find(x=>x.id===id):{id:'local-'+crypto.randomUUID(),...initial};if(!old)return;
 const val=k=>$('#dir-'+k).value.trim();let body='';
 if(kind==='classes')body=dirInput('name','Название класса',old.name)+dirInput('count','Количество учеников',old.pupilCount??old.sourcePupilCount??0,'number','min="0" max="100"')+dirSelect('head','Классный руководитель',db.teachers,old.classHeadId||db.teachers.find(t=>t.name===old.classHeadName)?.id,'Не назначен')+dirSelect('room','Закреплённый кабинет',db.rooms,old.homeRoomId||settings.roomPolicy?.classRooms?.[old.id]?.[0],'Не закреплён');
 if(kind==='groups')body=dirSelect('class','Класс',db.classes,old.classId)+dirInput('name','Название подгруппы / профиля',old.name)+dirInput('short','Краткое название',old.shortName)+dirSelect('subject','Предмет деления',db.subjects,old.subjectId)+dirInput('level','Уровень',old.level||'Базовый');
 if(kind==='teachers')body=dirInput('name','ФИО',old.name)+dirInput('short','Фамилия и инициалы',old.shortName||short(old.name||''))+dirInput('color','Цвет карточек',old.color||'#91b4dd','color')+dirInput('slots','Разрешённые уроки (например, 3-5 или 1, 3, 5)',old.allowedSlots?.join(', ')||'1-8')+`<div class="full"><p>Рабочие дни</p><div class="week-days">${[1,2,3,4,5,6,0].map(d=>`<label><input type="checkbox" data-work-day="${d}" ${(old.workDays||[1,2,3,4,5]).includes(d)?'checked':''}>${days[d]}</label>`).join('')}</div></div>`;
 if(kind==='rooms')body=dirInput('name','Название',old.name)+dirInput('capacity','Вместимость',old.capacity??0,'number','min="0" max="1000"')+dirSelect('teacher','Закреплённый учитель',db.teachers,db.teachers.find(t=>settings.roomPolicy?.teacherRooms?.[t.id]===old.id)?.id,'Не закреплён');
 if(kind==='subjects')body=dirInput('name','Название предмета',old.name)+dirInput('short','Сокращение',settings.labels[old.id]||old.abbreviation);
 let extra='';
 if(kind==='classes'&&id){const gs=db.groups.filter(g=>g.classId===id);extra=`<div class="inline-tools"><h3>Подгруппы / профили</h3><button id="dir-add-group">Добавить подгруппу</button></div><table class="teacher-courses">${gs.map(g=>`<tr><td>${h(g.name)}</td><td>${h(lookup('subjects',g.subjectId)?.name)}</td><td><button data-edit-group="${g.id}">Изменить</button></td></tr>`).join('')}</table>`}
 if(kind==='teachers'&&id){const cs=db.courses.filter(c=>c.teacherId===id);extra=`<div class="inline-tools"><h3>Уроки / нагрузка: ${directoryHours(null,id)} ч/нед.</h3><button id="dir-add-course">Добавить урок</button></div><p class="hint">Новый урок появится в нижней области основного расписания. Длина 2 — блок из двух последовательных уроков.</p><table class="teacher-courses"><thead><tr><th>Предмет</th><th>Класс / подгруппа</th><th>В неделю</th><th>Длина</th><th></th></tr></thead>${cs.map(c=>`<tr><td>${h(lookup('subjects',c.subjectId)?.name)}</td><td>${h(lookup('classes',c.classId)?.name)} ${h(c.groupName||'Весь класс')}</td><td>${+c.weeklyHours||0}</td><td>${c.length||1}</td><td><button data-edit-course="${c.id}">Изменить</button></td></tr>`).join('')}</table>`}
 dialog((id?'Изменить: ':'Добавить: ')+(directoryNames[kind]||kind),`<div class="directory-form">${body}</div>${extra}<p id="dir-error" class="error" role="alert"></p>`,[{text:'Отмена',action:()=>back?back():$('#dialog').close()},{text:'Сохранить',class:'primary',action:()=>{
  try{
   const next={...old,studioEdited:true,name:val('name')};if(!next.name)throw Error('Укажите название / ФИО');
   if(db[kind].some(x=>x.id!==old.id&&x.name.toLowerCase()===next.name.toLowerCase()&&(kind!=='groups'||x.classId===val('class'))))throw Error('Такая запись уже существует');
   if(kind==='classes'){const n=+val('count');if(!Number.isInteger(n)||n<0||n>100)throw Error('Количество от 0 до 100');Object.assign(next,{pupilCount:n,sourcePupilCount:n,grade:parseInt(next.name)||1,classHeadId:val('head')||null,classHeadName:lookup('teachers',val('head'))?.name||'',homeRoomId:val('room')||null})}
   if(kind==='groups')Object.assign(next,{classId:val('class'),subjectId:val('subject'),level:val('level'),shortName:val('short')});
   if(kind==='teachers'){
    const slots=new Set();for(const part of val('slots').split(/[,;\s]+/).filter(Boolean)){const m=part.match(/^(\d+)(?:-(\d+))?$/);if(!m)throw Error('Уроки: используйте номера или диапазон 3-5');const a=+m[1],b=+(m[2]||m[1]);if(a<1||b>20||b<a)throw Error('Номера уроков от 1 до 20');for(let n=a;n<=b;n++)slots.add(n)}
    const workDays=$$('[data-work-day]:checked').map(e=>+e.dataset.workDay);if(!workDays.length||!slots.size)throw Error('Выберите рабочие дни и разрешённые уроки');Object.assign(next,{shortName:val('short')||short(next.name),color:val('color'),allowedSlots:[...slots].sort((a,b)=>a-b),workDays});
   }
   if(kind==='rooms'){const n=+val('capacity');if(!Number.isInteger(n)||n<0||n>1000)throw Error('Вместимость от 0 до 1000');next.capacity=n}
   if(kind==='subjects'){if(!val('short'))throw Error('Укажите сокращение');next.abbreviation=val('short')}
   const selectedRoomTeacher=kind==='rooms'?val('teacher'):null;
   transact('Справочник: '+next.name,()=>{
    settings.roomPolicy??={schema:1,assignmentRevision:2,enabled:false,teacherRooms:{},teacherRules:{},classRooms:{},pool:[]};
    const i=db[kind].findIndex(x=>x.id===next.id);if(i<0)db[kind].push(next);else db[kind][i]=next;
    if(kind==='classes'){settings.roomPolicy.classRooms??={};settings.roomPolicy.classRooms[next.id]=next.homeRoomId?[next.homeRoomId]:[]}
    if(kind==='subjects')settings.labels[next.id]=next.abbreviation;
    if(kind==='teachers')db.classes.forEach(c=>{if(c.classHeadId===next.id||c.classHeadName===old.name){c.classHeadId=next.id;c.classHeadName=next.name}});
    if(kind==='groups')db.courses.forEach(c=>{if(c.groupId===next.id){Object.assign(c,{classId:next.classId,subjectId:next.subjectId,groupName:next.name,level:next.level,studioEdited:true})}});
    if(kind==='rooms'){
     const p=settings.roomPolicy;p.teacherRooms??={};p.teacherRules??={};
     for(const [t,r]of Object.entries(p.teacherRooms))if(r===next.id){delete p.teacherRooms[t];delete p.teacherRules[t]}
     if(selectedRoomTeacher){p.teacherRooms[selectedRoomTeacher]=next.id;p.teacherRules[selectedRoomTeacher]={mode:'fixed',rooms:[next.id]}}
    }
   });
   $('#dialog').close();if(back)back();
  }catch(e){$('#dir-error').textContent=e.message}
 }}]);
 if($('#dir-add-group'))$('#dir-add-group').onclick=()=>editDirectory('groups',null,{classId:id},()=>editDirectory(kind,id));
 $$('[data-edit-group]').forEach(b=>b.onclick=()=>editDirectory('groups',b.dataset.editGroup,{},()=>editDirectory(kind,id)));
 if($('#dir-add-course'))$('#dir-add-course').onclick=()=>editCourse(null,id);
 $$('[data-edit-course]').forEach(b=>b.onclick=()=>editCourse(b.dataset.editCourse,id));
}
function editCourse(id,teacherId){
 const old=id?db.courses.find(c=>c.id===id):{id:'course-'+crypto.randomUUID(),teacherId,weeklyHours:1,length:1,classId:db.classes[0]?.id,subjectId:db.subjects[0]?.id};
 const cl=()=>$('#course-class').value;
 dialog('Урок учителя · '+studioTeacher(teacherId),`<div class="directory-form">${dirSelect('course-subject','Предмет',db.subjects,old.subjectId).replace('dir-course-subject','course-subject')}${dirInput('course-hours','Количество часов в неделю',old.weeklyHours,'number','min="1" max="40"').replace('dir-course-hours','course-hours')}${dirInput('course-length','Длина блока (уроков подряд)',old.length||1,'number','min="1" max="8"').replace('dir-course-length','course-length')}${dirSelect('course-class','Класс',db.classes,old.classId).replace('dir-course-class','course-class')}<label>Подгруппа<select id="course-group"></select></label></div><p class="hint">Количество часов должно делиться на длину блока. Изменение назначения отразится в связанных карточках. Уже размещённые уроки не удаляются при уменьшении нагрузки.</p><p id="course-error" class="error" role="alert"></p>`,[{text:'Назад',action:()=>editDirectory('teachers',teacherId)},{text:'Сохранить урок',class:'primary',action:()=>{
  const hours=+$('#course-hours').value,length=+$('#course-length').value;
  if(!Number.isInteger(hours)||!Number.isInteger(length)||hours<1||hours>40||length<1||length>8||hours%length){$('#course-error').textContent='Укажите 1–40 часов; длину 1–8, на которую делится количество часов.';return}
  const g=db.groups.find(g=>g.id===$('#course-group').value);
  const next={...old,teacherId,subjectId:$('#course-subject').value,classId:cl(),groupId:g?.id||null,groupName:g?.name||null,weeklyHours:hours,length,studioEdited:true};
  transact('Нагрузка: '+studioTeacher(teacherId),()=>{
   const i=db.courses.findIndex(c=>c.id===next.id);if(i<0)db.courses.push(next);else db.courses[i]=next;
   if(!db.teacherSubjects.some(x=>x.teacherId===teacherId&&x.subjectId===next.subjectId))db.teacherSubjects.push({teacherId,subjectId:next.subjectId});
   const template=SM.template(db),existing=template.filter(l=>l.courseId===next.id&&!l.cancelled);
   existing.forEach(l=>Object.assign(l,{teacherId,subjectId:next.subjectId,classId:next.classId,groupId:next.groupId,groupName:next.groupName}));
   let missing=Math.max(0,hours-existing.length);
   while(missing>0){const blockId='block-'+crypto.randomUUID(),n=Math.min(length,missing);for(let j=0;j<n;j++)template.push({id:'lesson-'+crypto.randomUUID(),classId:next.classId,subjectId:next.subjectId,teacherId,courseId:next.id,groupId:next.groupId,groupName:next.groupName,date:SM.anchor(db),slot:j+1,roomId:null,roomMode:'auto',parked:true,parkingArea:'bottom',blockId,blockOffset:j,blockLength:n,...E.slotInfo(db,next.classId,SM.anchor(db),j+1)});missing-=n}
   db.baseSchedule={week:SM.anchor(db),lessons:template};
  });editDirectory('teachers',teacherId);
 }}]);
 function fill(){const gs=db.groups.filter(g=>g.classId===cl());$('#course-group').innerHTML=options(gs,old.groupId,'Весь класс')}
 $('#course-class').onchange=fill;fill();
}
