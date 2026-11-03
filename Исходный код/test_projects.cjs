const assert=require('node:assert/strict'),fs=require('node:fs');
global.StudioModel=require('./ui/studio-model.js');global.RoomAllocator=require('./ui/room-engine.js');global.ScheduleEngine=require('./ui/engine.js');
const P=require('./ui/project-model.js'),SM=StudioModel,E=ScheduleEngine;
function fixture(){return {meta:{schemaVersion:'1.0',school:'Тест',academicYear:'2026-2027'},classes:[{id:'c1',name:'5а'},{id:'c2',name:'5б'}],teachers:[{id:'t1',name:'Иванова Анна Ивановна'},{id:'t2',name:'Петров Пётр Петрович'}],subjects:[{id:'s1',name:'Математика',abbreviation:'м'},{id:'s2',name:'Русский язык',abbreviation:'р/я'}],rooms:[{id:'r1',name:'12'}],groups:[{id:'g1',classId:'c1',subjectId:'s1',name:'Группа 1'},{id:'g2',classId:'c2',subjectId:'s1',name:'Группа 2'}],lessons:[],courses:[],teacherSubjects:[],extraLessons:[],absences:[],overrides:{},history:[],preferences:{},baseSchedule:{week:'2026-09-07',lessons:[]}}}
{
 const d=fixture(),course={id:'q',teacherId:'t1',classId:'c1',subjectId:'s1',weeklyCount:2,length:2};P.upsertCourse(d,course);assert.equal(d.courses[0].weeklyHours,4);assert.equal(SM.template(d).length,4);assert.equal(new Set(SM.template(d).map(l=>l.blockId)).size,2);
 const before=structuredClone(d.baseSchedule);d.baseSchedule.lessons[0].parked=false;d.baseSchedule.lessons[1].parked=false;d.baseSchedule.lessons[0].slot=3;d.baseSchedule.lessons[1].slot=4;
 assert.throws(()=>P.upsertCourse(d,{...course,weeklyCount:1,length:1}),/резерв/);
 P.upsertCourse(d,{...course,weeklyCount:1,length:2});assert.equal(SM.template(d).filter(l=>!l.cancelled).length,2);assert.equal(SM.template(d).filter(l=>!l.cancelled&&!l.parked).length,2);
 assert.throws(()=>P.upsertCourse(d,{...course,weeklyCount:2,length:1}),/длительности/);
 P.upsertCourse(d,{...course,weeklyCount:2,length:1,classId:'c2',teacherId:'t2',groupId:'g2'},{returnToReserve:true});assert(SM.template(d).filter(l=>!l.cancelled).every(l=>l.parked&&l.classId==='c2'&&l.teacherId==='t2'&&l.groupId==='g2'));
}
{
 const d=fixture();P.upsertCourse(d,{id:'half',teacherId:'t1',classId:'c1',subjectId:'s1',weeklyCount:2.5,length:1});d.baseSchedule.lessons.forEach((l,i)=>{l.parked=false;l.slot=i+1});
 assert.equal(E.effectiveBetween(d,'2026-09-07','2026-09-11').length,3);assert.equal(E.effectiveBetween(d,'2026-09-14','2026-09-18').length,2);assert.equal(d.courses[0].weeklyHours,2.5);
 const newer=P.newProject(d,'Другой вариант','2027-2028',true);assert.equal(newer.lessons.length,0);assert.equal(newer.courses[0].weeklyHours,2.5);assert.equal(newer.baseSchedule.lessons.length,3);assert(newer.baseSchedule.lessons.every(l=>l.parked));assert.equal(d.meta.academicYear,'2026-2027');
}
{
 const d=fixture();for(let i=0;i<600;i++)d.baseSchedule.lessons.push({id:'l'+i,classId:'c1',subjectId:'s1',teacherId:'t1',date:'2026-09-07',slot:1,parked:true});
 const before={baseSchedule:structuredClone(d.baseSchedule),teachers:structuredClone(d.teachers),overrides:{},preferences:{}},after=structuredClone(before);after.baseSchedule.lessons[17].slot=5;
 const entry=P.historyEntry('Перенос',before,after);assert(JSON.stringify(entry).length<2000,'one move must not duplicate 600 cards');d.baseSchedule=structuredClone(after.baseSchedule);P.restoreHistory(d,entry);assert.deepEqual(d.baseSchedule,before.baseSchedule);P.restoreHistory(d,entry,'after');assert.deepEqual(d.baseSchedule,after.baseSchedule);
}
{
 const d=fixture(),book=P.exportBook(d,['teachers','classes','subjects','rooms','groups']),selections=book.sheets.map((sheet,i)=>({sheet,kind:['teachers','classes','subjects','rooms','groups'][i]})),plan=P.importPlan(d,selections);assert.equal(plan.issues.length,0);assert.equal(plan.counts.added,0);assert.equal(plan.next.teachers[0].id,'t1');
 const input={name:'Учителя',rows:[['ФИО','Сокращение','Рабочие дни','Разрешённые уроки'],['Новая Анна Петровна','Новая А.П.','Пн, Ср','3-5']]},old=JSON.stringify(d),preview=P.importPlan(d,[{kind:'teachers',sheet:input}]);assert.equal(preview.counts.added,1);assert.equal(JSON.stringify(d),old,'preview mutated the active document');assert.deepEqual(preview.next.teachers.at(-1).allowedSlots,[3,4,5]);
 const bad=P.importPlan(d,[{kind:'courses',sheet:{name:'Уроки',rows:[['Учитель','Класс','Предмет','Занятий в неделю'],['Нет такого','5а','Математика','2']]}}]);assert.equal(bad.issues.length,1);assert.equal(JSON.stringify(d),old);
}
{
 const d=JSON.parse(fs.readFileSync('seed.json'));d.preferences={};const out=P.exportBook(d,['teachers','courses']),plan=P.importPlan(d,out.sheets.map((sheet,i)=>({sheet,kind:['teachers','courses'][i]})));assert.equal(plan.issues.length,0);assert.equal(plan.counts.added,0);assert.deepEqual(plan.next.courses.map(c=>c.weeklyHours),d.courses.map(c=>c.weeklyHours));
 const week=SM.anchor(d),full=E.effective(d).filter(l=>l.date>=week&&l.date<=SM.add(week,4)),range=E.effectiveBetween(d,week,SM.add(week,4));assert.deepEqual(range,full);
 const n=P.newProject(d,'План','2026-2027',true);assert.equal(n.courses.length,d.courses.filter(c=>c.teacherId&&c.weeklyHours>0).length);assert(n.courses.some(c=>c.weeklyHours===0.5));
}
console.log('Projects: paired workload, fractional weeks, stable linked IDs, compact undo, non-mutating import preview, original workload round trip and range/full equivalence passed');
