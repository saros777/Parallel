/* Project documents, workload and spreadsheet changes. No DOM or file access. */
(function(root){
 const SM=root.StudioModel||(typeof require!=='undefined'?require('./studio-model.js'):null);
 const clone=x=>structuredClone(x),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const fields=['classes','teachers','subjects','rooms','groups','courses','teacherSubjects','extraLessons','absences'];
 const uid=prefix=>prefix+'-'+crypto.randomUUID();
 const names={classes:'Классы',teachers:'Учителя',subjects:'Предметы',rooms:'Кабинеты',groups:'Подгруппы',courses:'Нагрузка учителей',base:'Основное расписание',dated:'Расписание по датам'};
 const short=name=>{const p=String(name||'').trim().split(/\s+/);return p[0]+p.slice(1,3).map((s,i)=>(i?'':' ')+s[0]+'.').join('')};
 const norm=s=>String(s??'').trim().toLowerCase().replace(/ё/g,'е').replace(/[\s._()\/\-]+/g,'');
 const by=(rows,value)=>rows.find(x=>x.id===value)||rows.find(x=>norm(x.name)===norm(value))||rows.find(x=>x.shortName&&norm(x.shortName)===norm(value));
 function slots(value,max=20){
  const out=new Set();for(const piece of String(value||'').replace(/[–—]/g,'-').split(/[,;\s]+/).filter(Boolean)){
   const m=piece.match(/^(\d+)(?:-(\d+))?$/);if(!m)throw Error('Номера уроков: используйте 1, 3 или 3-5');
   const a=+m[1],b=+(m[2]||m[1]);if(a<1||b<a||b>max)throw Error('Номера уроков от 1 до '+max);for(let n=a;n<=b;n++)out.add(n);
  }return [...out].sort((a,b)=>a-b);
 }
 const dayNames=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
 function weekday(value){const s=norm(value);const full=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];const en=['sun','mon','tue','wed','thu','fri','sat'];const n=dayNames.findIndex((x,i)=>norm(x)===s||norm(full[i])===s||en[i]===s);if(n>=0)return n;if(/^\d$/.test(s)&&+s<=6)return +s;throw Error('Неизвестный день недели: '+value)}
 function workDays(value){return String(value||'Пн, Вт, Ср, Чт, Пт').split(/[,;\s]+/).filter(Boolean).map(weekday)}
 function availability(value){if(!value)return null;const out={};for(const item of String(value).split(';').filter(Boolean)){const [day,...rest]=item.split(':');out[weekday(day)]=slots(rest.join(':'))}return out}
 function courseCount(c){return c.weeklyCount??(+c.weeklyHours||0)/(c.length||1)}
 function workingCopy(db){const out={...db,overrides:clone(db.overrides||{}),preferences:clone(db.preferences||{}),baseSchedule:clone(db.baseSchedule||null)};for(const key of fields)out[key]=clone(db[key]||[]);return out}
 function upsertCourse(db,input,{returnToReserve=false}={}){
  const next={...input},length=+next.length||1,count=next.weeklyCount==null?(+next.weeklyHours||0)/length:+next.weeklyCount;delete next.returnToReserve;
  if(!Number.isInteger(count*2)||count<0.5||!Number.isInteger(length)||length<1||length>8||count*length>40)throw Error('Занятий: от 0,5 с шагом 0,5; длительность 1–8; суммарно не более 40 часов в неделю');
  if(!db.classes.some(c=>c.id===next.classId)||!db.subjects.some(s=>s.id===next.subjectId))throw Error('Укажите класс и предмет');
  if(next.teacherId&&!db.teachers.some(t=>t.id===next.teacherId))throw Error('Учитель не найден');
  const group=next.groupId?db.groups.find(g=>g.id===next.groupId&&g.classId===next.classId):null;if(next.groupId&&!group)throw Error('Подгруппа относится к другому классу');
  Object.assign(next,{weeklyCount:count,weeklyHours:count*length,length,groupId:group?.id||null,groupName:group?.name||null,studioEdited:true});
  const template=SM.template(db),existing=template.filter(l=>l.courseId===next.id&&!l.cancelled),placed=existing.filter(l=>!l.parked);
  const old=db.courses.find(c=>c.id===next.id);
  const cards=Math.ceil(count)*length;
  if(!returnToReserve&&placed.length>cards)throw Error('Размещено '+placed.length+' часов. Сначала верните лишние карточки в резерв или отметьте «Снять размещённые уроки»');
  if(!returnToReserve&&placed.length&&old&&(old.length||1)!==length)throw Error('Для изменения длительности отметьте «Снять размещённые уроки»');
  for(const l of existing)Object.assign(l,{teacherId:next.teacherId||null,subjectId:next.subjectId,classId:next.classId,groupId:next.groupId,groupName:next.groupName,...(next.roomId?{roomId:next.roomId,roomMode:'manual'}:{}),...(returnToReserve?{parked:true,parkingArea:'bottom'}:{})});
  const active=[...existing.filter(l=>!l.parked),...existing.filter(l=>l.parked)];
  for(const excess of active.slice(cards)){excess.cancelled=true;excess.cancelReason='Уменьшение недельной нагрузки'}
  const kept=active.slice(0,cards);
  while(kept.length<cards){const l={id:uid('lesson'),courseId:next.id,classId:next.classId,subjectId:next.subjectId,teacherId:next.teacherId||null,groupId:next.groupId,groupName:next.groupName,date:SM.anchor(db),slot:1,time:'',roomId:next.roomId||null,roomMode:next.roomId?'manual':'auto',parked:true,parkingArea:'bottom'};template.push(l);kept.push(l)}
  if(returnToReserve||!placed.length||!old||(old.length||1)!==length||courseCount(old)!==count||(old.cyclePhase||0)!==(next.cyclePhase||0)||existing.length<cards){for(let i=0;i<kept.length;i+=length){const block=uid('block'),alternate=i/length>=Math.floor(count);for(let j=0;j<length;j++)Object.assign(kept[i+j],{blockId:length>1?block:null,blockOffset:j,blockLength:length,cycleWeeks:alternate?2:1,cyclePhase:alternate?(next.cyclePhase||0):0,slot:kept[i+j].parked?j+1:kept[i+j].slot})}}
  const i=db.courses.findIndex(c=>c.id===next.id);if(i<0)db.courses.push(next);else db.courses[i]=next;
  db.baseSchedule={...db.baseSchedule,week:SM.anchor(db),lessons:template};
  if(next.teacherId&&!db.teacherSubjects.some(x=>x.teacherId===next.teacherId&&x.subjectId===next.subjectId))db.teacherSubjects.push({teacherId:next.teacherId,subjectId:next.subjectId});
  return next;
 }
 function removeCourse(db,id){
  const template=SM.template(db);for(const l of template)if(l.courseId===id){l.cancelled=true;l.cancelReason='Удаление нагрузки'}
  for(const l of db.lessons)if(l.courseId===id)db.overrides[l.id]={...db.overrides[l.id],cancelled:true,cancelReason:'Удаление нагрузки'};
  for(const l of db.extraLessons||[])if(l.courseId===id)l.cancelled=true;
  db.courses=db.courses.filter(c=>c.id!==id);db.baseSchedule={...db.baseSchedule,week:SM.anchor(db),lessons:template};
 }
 function newProject(source,title,academicYear,copyDirectories=true){
  const year=academicYear.match(/\d{4}/)?.[0]||String(new Date().getFullYear()),sep=year+'-09-01',week=SM.monday(sep);
  const previousYear=+(source?.meta?.academicYear||year).match(/\d{4}/)?.[0]||+year,shift=d=>d?String(+d.slice(0,4)+(+year-previousYear))+d.slice(4):d;
  const out={meta:{schemaVersion:'1.0',school:source?.meta?.school||'Школа',academicYear,projectName:title},classes:[],teachers:[],subjects:[],rooms:[],lessons:[],courses:[],groups:[],periods:[],calendar:[],calls:[],teacherSubjects:[],overrides:{},extraLessons:[],absences:[],history:[],preferences:{studioSuspensions:true},baseSchedule:{week,lessons:[]}};
  if(copyDirectories&&source){for(const k of ['classes','teachers','subjects','rooms','groups','calls','teacherSubjects'])out[k]=clone(source[k]||[]);out.preferences=clone(source.preferences||{});for(const c of source.courses||[])if(c.teacherId&&c.weeklyHours>0)upsertCourse(out,{...clone(c),id:uid('course'),weeklyCount:courseCount(c),startDate:shift(c.startDate),endDate:shift(c.endDate),term:academicYear})}
  return out;
 }
 function historyEntry(label,before,after){
  const values={},changes=[];
  for(const key of Object.keys(before)){
   const a=before[key],b=after[key];if(equal(a,b))continue;
   if(key==='baseSchedule'&&a&&b){if(a.week!==b.week)values.baseWeek={before:a.week,after:b.week};diffArray('baseSchedule.lessons',a.lessons,b.lessons);continue}
   if(Array.isArray(a)&&Array.isArray(b)&&[...a,...b].every(x=>x?.id)){diffArray(key,a,b);continue}
   if(key==='overrides'){for(const id of new Set([...Object.keys(a||{}),...Object.keys(b||{})]))if(!equal(a?.[id],b?.[id]))changes.push({key,id,before:a?.[id]??null,after:b?.[id]??null});continue}
   values[key]={before:a,after:b};
  }
  function diffArray(key,a,b){const am=new Map(a.map((x,i)=>[x.id,{x,i}])),bm=new Map(b.map((x,i)=>[x.id,{x,i}]));for(const id of new Set([...am.keys(),...bm.keys()]))if(!equal(am.get(id)?.x,bm.get(id)?.x))changes.push({key,id,before:am.get(id)?.x??null,after:bm.get(id)?.x??null,beforeIndex:am.get(id)?.i,afterIndex:bm.get(id)?.i})}
  if(!changes.length&&!Object.keys(values).length)return null;
  return {id:uid('history'),at:new Date().toISOString(),label,format:2,changes,values};
 }
 function restoreHistory(db,entry,side='before'){
  if(entry.format!==2){Object.assign(db,clone(entry[side]));return}
  for(const [key,value]of Object.entries(entry.values||{})){if(key==='baseWeek')db.baseSchedule.week=value[side];else db[key]=clone(value[side])}
  const groups=new Map();for(const c of entry.changes||[]){if(!groups.has(c.key))groups.set(c.key,[]);groups.get(c.key).push(c)}
  for(const [key,cs]of groups){
   if(key==='overrides'){for(const c of cs){if(c[side]===null)delete db.overrides[c.id];else db.overrides[c.id]=clone(c[side])}continue}
   const target=key==='baseSchedule.lessons'?db.baseSchedule.lessons:db[key],ids=new Set(cs.map(c=>c.id)),rows=target.filter(x=>!ids.has(x.id));
   for(const c of cs.filter(c=>c[side]!==null).sort((a,b)=>(a[side+'Index']??1e9)-(b[side+'Index']??1e9)))rows.splice(Math.min(c[side+'Index']??rows.length,rows.length),0,clone(c[side]));
   if(key==='baseSchedule.lessons')db.baseSchedule.lessons=rows;else db[key]=rows;
  }
 }
 const columns={
  classes:['ID','Класс','Количество','Классный руководитель','Кабинет'],teachers:['ID','ФИО','Сокращение','Цвет','Рабочие дни','Разрешённые уроки','Доступность по дням'],subjects:['ID','Предмет','Сокращение'],rooms:['ID','Кабинет','Вместимость','Учитель'],groups:['ID','Класс','Подгруппа','Предмет','Уровень','Сокращение'],courses:['ID','Учитель','Класс','Предмет','Подгруппа','Занятий в неделю','Длительность','Кабинет','Неделя чередования'],base:['ID','Класс','День','Урок','Предмет','Учитель','Кабинет','Подгруппа','В резерве','Чередование','Выбор кабинета'],dated:['ID','Класс','Дата','Урок','Предмет','Учитель','Кабинет','Подгруппа','В резерве','Чередование','Выбор кабинета']
 };
 function exportBook(db,kinds,options={}){
  const label=(key,id)=>db[key].find(x=>x.id===id)?.name||'',room=id=>label('rooms',id),policy=db.preferences?.roomPolicy||{};
  const sheets=kinds.map(kind=>{
   let rows=[];
   if(kind==='classes')rows=db.classes.map(c=>[c.id,c.name,c.pupilCount??c.sourcePupilCount??0,label('teachers',c.classHeadId)||c.classHeadName||'',room(c.homeRoomId||policy.classRooms?.[c.id]?.[0])]);
   if(kind==='teachers')rows=db.teachers.map(t=>[t.id,t.name,t.shortName||short(t.name),t.color||'',(t.workDays||[1,2,3,4,5]).map(d=>dayNames[d]).join(', '),(t.allowedSlots||[]).join(', '),t.availability?Object.entries(t.availability).map(([d,s])=>dayNames[+d]+':'+s.join(',')).join(';'):'']);
   if(kind==='subjects')rows=db.subjects.map(s=>[s.id,s.name,db.preferences?.labels?.[s.id]||s.abbreviation||'']);
   if(kind==='rooms')rows=db.rooms.map(r=>[r.id,r.name,r.capacity??'',label('teachers',Object.keys(policy.teacherRooms||{}).find(t=>policy.teacherRooms[t]===r.id))]);
   if(kind==='groups')rows=db.groups.map(g=>[g.id,label('classes',g.classId),g.name,label('subjects',g.subjectId),g.level||'',g.shortName||'']);
   if(kind==='courses')rows=db.courses.map(c=>[c.id,label('teachers',c.teacherId),label('classes',c.classId),label('subjects',c.subjectId),c.groupName||label('groups',c.groupId),courseCount(c),c.length||1,room(c.roomId),Number.isInteger(courseCount(c))?'':c.cyclePhase?'II':'I']);
   if(kind==='base'||kind==='dated'){const E=root.ScheduleEngine||(typeof require!=='undefined'?require('./engine.js'):null),from=options.from||SM.anchor(db),to=options.to||SM.add(from,6);let ls=kind==='dated'?E.effectiveBetween(db,from,to):E.effective({...db,basePreview:true,baseSchedule:null,lessons:SM.template(db),extraLessons:[],overrides:{},calendar:[],absences:[]});rows=ls.filter(l=>!l.cancelled).map(l=>[l.id,label('classes',l.classId),kind==='base'?dayNames[SM.day(l.date)]:l.date,l.slot,label('subjects',l.subjectId),label('teachers',l.teacherId),room(l.roomId),l.groupName||label('groups',l.groupId),l.parked?'да':'нет',l.cycleWeeks===2?(l.cyclePhase?'II':'I'):'',l.roomMode||'auto'])}
   return {name:names[kind],rows:[columns[kind],...rows.map(r=>r.map(x=>String(x??'')))]};
  });return {sheets};
 }
 const aliases={id:['id','код','идентификатор'],name:['фио','название','наименование','name'],short:['сокращение','краткоеназвание','shortname','abbreviation'],count:['количество','количествоучеников','учеников','pupilcount'],teacher:['учитель','преподаватель','teacher','teacherid','фиоучителя'],class:['класс','class','classid'],subject:['предмет','subject','subjectid'],group:['подгруппа','профиль','group','groupname'],room:['кабинет','room','roomid'],color:['цвет','color'],days:['рабочиедни','дни','днинедели','workdays'],slots:['разрешенныеуроки','уроки','allowedslots'],availability:['доступностьподням','availability'],capacity:['вместимость','capacity'],level:['уровень','level'],head:['классныйруководитель','classhead'],weeklyCount:['занятийвнеделю','количествозанятий','количествовнеделю','weeklycount'],hours:['часоввнеделю','часов','внеделю','weeklyhours'],length:['длительность','длина','длинаблока','length'],day:['день','деньнедели','weekday'],date:['дата','date'],slot:['урок','номерурока','slot'],parked:['врезерве','parked'],phase:['чередование','неделячередования','cyclephase'],roomMode:['выборкабинета','roommode']};
 function importPlan(db,selections){
  const next=workingCopy(db),issues=[],counts={added:0,updated:0,unchanged:0},preview=[];
  const order=['teachers','rooms','classes','subjects','groups','courses','base','dated'];selections=[...selections].sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind));
  const ref=(key,value,required=false)=>{if(!value){if(required)throw Error('Не указано: '+(names[key]||key));return null}let found=by(next[key],value);if(!found){const original=by(db[key],value);if(original)found=next[key].find(x=>x.id===original.id)}if(!found&&key==='rooms'){const matches=next.rooms.filter(r=>String(r.name).match(/^\s*(?:каб(?:инет)?\.?\s*)?(\d+[а-яa-z]?)/i)?.[1]===value);if(matches.length===1)found=matches[0]}if(!found&&key==='teachers'){const matches=next.teachers.filter(t=>norm(short(t.name))===norm(value));if(matches.length===1)found=matches[0]}if(!found)throw Error('Не найдено в справочнике «'+names[key]+'»: '+value);return found};
  for(const {kind,sheet}of selections){
   if(!columns[kind]){issues.push('Не выбран раздел для листа '+sheet.name);continue}
   const rows=sheet.rows||[],header=rows[0]||[],map={};header.forEach((name,i)=>{for(const [key,variants]of Object.entries(aliases))if(variants.some(v=>norm(v)===norm(name)))map[key]=i});
   if(kind==='classes')map.name=map.class??map.name;if(kind==='teachers')map.name=map.name??map.teacher;if(kind==='subjects')map.name=map.subject??map.name;if(kind==='rooms')map.name=map.room??map.name;if(kind==='groups')map.name=map.group??map.name;
   if(!Object.keys(map).length){issues.push(sheet.name+': не распознаны заголовки первой строки');continue}
   const template=kind==='base'?SM.template(next):null,lessonIndex=new Map((template||(kind==='dated'?[...next.lessons,...next.extraLessons]:[])).map(l=>[l.id,l])),originalIds=kind==='dated'?new Set(next.lessons.map(l=>l.id)):null,baseIds=kind==='dated'?new Set(SM.template(next).map(l=>l.id)):null;
   for(let n=1;n<rows.length;n++){
    const row=rows[n];if(!row.some(x=>String(x).trim()))continue;
    const get=k=>map[k]===undefined?'':String(row[map[k]]??'').trim(),num=(key,fallback,min,max,step=1)=>{const value=get(key)===''?fallback:Number(get(key).replace(',','.'));if(!Number.isFinite(value)||!Number.isInteger(value/step)||value<min||value>max)throw Error('Неверное число: '+(header[map[key]]||key));return value};
    try{
     let old,record,result='';
     if(['classes','teachers','subjects','rooms','groups'].includes(kind)){
      const name=get('name');if(!name)throw Error('Нет названия / ФИО');
      const cl=kind==='groups'?ref('classes',get('class'),true):null;
      old=next[kind].find(x=>x.id===get('id'))||next[kind].find(x=>norm(x.name)===norm(name)&&(kind!=='groups'||x.classId===cl.id));record={...old,id:old?.id||get('id')||uid(kind),name,studioEdited:true};
      if(kind==='teachers'){Object.assign(record,{shortName:get('short')||old?.shortName||short(name),color:get('color')||old?.color,workDays:get('days')?workDays(get('days')):old?.workDays||[1,2,3,4,5],allowedSlots:get('slots')?slots(get('slots')):old?.allowedSlots||[1,2,3,4,5,6,7,8]});if(record.color&&!/^#[0-9a-f]{6}$/i.test(record.color))throw Error('Цвет должен иметь вид #91b4dd');if(get('availability'))record.availability=availability(get('availability'))}
      if(kind==='classes')Object.assign(record,{pupilCount:num('count',old?.pupilCount??old?.sourcePupilCount??0,0,100),grade:parseInt(name)||1,classHeadId:ref('teachers',get('head'))?.id||old?.classHeadId||null,homeRoomId:ref('rooms',get('room'))?.id||old?.homeRoomId||null});
      if(kind==='subjects'){record.abbreviation=get('short')||old?.abbreviation||name;next.preferences.labels??={};next.preferences.labels[record.id]=record.abbreviation}
      if(kind==='groups')Object.assign(record,{classId:cl.id,subjectId:ref('subjects',get('subject'),true).id,shortName:get('short')||old?.shortName||name,level:get('level')||old?.level||'Базовый'});
      if(kind==='rooms'){record.capacity=num('capacity',old?.capacity||0,0,1000);const t=ref('teachers',get('teacher'));if(t){next.preferences.roomPolicy??={schema:1,enabled:false};next.preferences.roomPolicy.teacherRooms??={};next.preferences.roomPolicy.teacherRooms[t.id]=record.id}}
      const index=next[kind].findIndex(x=>x.id===record.id);if(index<0)next[kind].push(record);else next[kind][index]=record;
      if(kind==='teachers'&&old)next.classes.forEach(c=>{if(c.classHeadId===record.id||c.classHeadName===old.name){c.classHeadId=record.id;c.classHeadName=record.name}});
      if(kind==='groups')next.courses.forEach(c=>{if(c.groupId===record.id)Object.assign(c,{classId:record.classId,subjectId:record.subjectId,groupName:record.name,studioEdited:true})});
      if(kind==='classes'&&record.homeRoomId){next.preferences.roomPolicy??={schema:1,enabled:false};next.preferences.roomPolicy.classRooms??={};next.preferences.roomPolicy.classRooms[record.id]=[record.homeRoomId]}
      result=old?(equal({...old,studioEdited:true},record)?'unchanged':'updated'):'added';
     }else if(kind==='courses'){
      const teacher=ref('teachers',get('teacher')),cl=ref('classes',get('class'),true),subject=ref('subjects',get('subject'),true),group=get('group')?next.groups.find(g=>g.classId===cl.id&&(g.id===get('group')||norm(g.name)===norm(get('group')))):null;
      if(get('group')&&!group)throw Error('Не найдена подгруппа класса '+cl.name+': '+get('group'));
      old=next.courses.find(c=>c.id===get('id'))||next.courses.find(c=>c.teacherId===(teacher?.id||null)&&c.classId===cl.id&&c.subjectId===subject.id&&(c.groupId||null)===(group?.id||null));
      const length=num('length',old?.length||1,1,8),count=map.weeklyCount!==undefined?num('weeklyCount',old?courseCount(old):1,0.5,40,0.5):num('hours',old?.weeklyHours||1,0.5,40,0.5)/length;
      record={...old,id:old?.id||get('id')||uid('course'),teacherId:teacher?.id||null,classId:cl.id,subjectId:subject.id,groupId:group?.id||null,groupName:group?.name||null,weeklyCount:count,length,weeklyHours:count*length,roomId:ref('rooms',get('room'))?.id||old?.roomId||null,cyclePhase:/^(II|2|вторая)$/i.test(get('phase'))?1:get('phase')?0:old?.cyclePhase||0};
      const unchanged=old&&old.teacherId===record.teacherId&&old.classId===record.classId&&old.subjectId===record.subjectId&&(old.groupId||null)===record.groupId&&+old.weeklyHours===record.weeklyHours&&(old.length||1)===length&&(old.roomId||null)===record.roomId&&(old.cyclePhase||0)===(record.cyclePhase||0);
      if(!unchanged)upsertCourse(next,record);result=old?(unchanged?'unchanged':'updated'):'added';
     }else {
      const cl=ref('classes',get('class'),true),subject=ref('subjects',get('subject'),true),teacher=ref('teachers',get('teacher')),room=ref('rooms',get('room')),group=get('group')?next.groups.find(g=>g.classId===cl.id&&(g.id===get('group')||norm(g.name)===norm(get('group')))):null;
      if(get('group')&&!group)throw Error('Не найдена подгруппа: '+get('group'));
      let date;if(kind==='base'){const d=weekday(get('day'));if(d<1||d>5)throw Error('Основное расписание: выберите Пн–Пт');date=SM.add(SM.anchor(next),d-1)}else{date=get('date');if(/^\d{5}(?:\.\d+)?$/.test(date))date=new Date(Date.UTC(1899,11,30)+Math.round(+date)*86400000).toISOString().slice(0,10);if(/^\d{2}\.\d{2}\.\d{4}$/.test(date))date=date.split('.').reverse().join('-');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('Дата: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ')}
      old=lessonIndex.get(get('id'));
      record={...old,id:old?.id||get('id')||uid('lesson'),classId:cl.id,subjectId:subject.id,teacherId:teacher?.id||null,roomId:room?.id||null,roomMode:room?'manual':'auto',groupId:group?.id||null,groupName:group?.name||null,date,slot:num('slot',old?.slot||1,1,20),parked:/^(да|yes|true|1)$/i.test(get('parked')),parkingArea:'bottom',time:old?.time||''};
      record.cycleWeeks=map.phase!==undefined?(get('phase')?2:1):old?.cycleWeeks||1;record.cyclePhase=/^(II|2|вторая)$/i.test(get('phase'))?1:get('phase')?0:old?.cyclePhase||0;if(map.roomMode!==undefined)record.roomMode=/^(auto|авто|автоматически)$/i.test(get('roomMode'))?'auto':'manual';
      if(kind==='base'){const i=old?template.indexOf(old):-1;if(i<0)template.push(record);else template[i]=record;lessonIndex.set(record.id,record)}
      else if(originalIds.has(record.id)||(record.id.endsWith('@'+date)&&baseIds.has(record.id.slice(0,-11))))next.overrides[record.id]={...next.overrides[record.id],...record};else{const i=next.extraLessons.findIndex(l=>l.id===record.id);if(i<0)next.extraLessons.push(record);else next.extraLessons[i]=record}
      result=old?(equal(old,record)?'unchanged':'updated'):'added';
     }
     counts[result]++;preview.push({sheet:sheet.name,row:n+1,name:record.name||[get('class'),get('subject')].join(' · '),result});
    }catch(e){issues.push(sheet.name+', строка '+(n+1)+': '+e.message)}
   }
   if(kind==='base')next.baseSchedule={...next.baseSchedule,week:SM.anchor(next),lessons:template};
  }
  return {next,issues,counts,preview};
 }
 const api={names,columns,slots,weekday,availability,courseCount,workingCopy,upsertCourse,removeCourse,newProject,historyEntry,restoreHistory,exportBook,importPlan,short,fields};
 root.ProjectModel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
