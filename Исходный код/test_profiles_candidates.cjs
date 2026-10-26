const assert=require('node:assert/strict'),fs=require('fs'),E=require('./ui/engine.js');
const real=JSON.parse(fs.readFileSync('seed.json'));
const c10=real.classes.find(c=>c.name==='10а').id,c11=real.classes.find(c=>c.name==='11').id,c10b=real.classes.find(c=>c.name==='10б').id;
const get=(classId,slot)=>real.lessons.filter(l=>l.classId===classId&&l.date==='2026-09-21'&&l.slot===slot);
assert.deepEqual(E.classProfiles({classId:c10},real),['social','chemical']);
assert.deepEqual(E.classProfiles({classId:c11},real),['social','chemical','physical']);
assert.deepEqual(E.classProfiles({classId:c10b},real),[]);
const a=E.profileLines(get(c10,1),real,c10);
assert.deepEqual(a.map(x=>x.profile),['social','chemical']);
assert.equal(a[0].lesson.groupName,'Социально-гуманитарный');
const b=E.profileLines(get(c11,3),real,c11);
assert.deepEqual(b.map(x=>x.profile),['social','chemical','physical']);
assert.equal(b[0].lesson.id,b[1].lesson.id); // visual repetition only, one shared lesson
assert.equal(new Set(b.map(x=>x.lesson.id)).size,2);
const empty=E.profileLines(get(c11,5),real,c11);
assert.equal(empty[0].profile,'social');assert.equal(empty[0].lesson,null);
assert(E.profileLines(get(c11,4),real,c11).every(x=>x.profile===null));
const old=get(c10,1)[0],changed={...old,profileAudience:['social']};
assert.deepEqual(E.profileAudience(changed,real),['social']);
assert.equal(E.roomOnlyChange(old,{...changed,roomId:'other'}),false);
const l={id:'a',classId:'c',subjectId:'alg',teacherId:'absent',date:'2026-09-21',slot:1,time:'08:00 - 08:45'};
const db={classes:[{id:'c',name:'5а'}],subjects:[{id:'alg',name:'Алгебра'},{id:'geom',name:'Геометрия'},{id:'bio',name:'Биология'},{id:'hist',name:'История России. Всеобщая история'},{id:'soc',name:'Обществознание'},{id:'prob',name:'Вероятность и статистика'},{id:'stat',name:'Медицинская статистика'}],
 teachers:['absent','same','related','unrelated','history','social','probability','medical'].map(id=>({id,name:id})),
 teacherSubjects:[['absent','alg'],['same','alg'],['related','geom'],['unrelated','bio'],['history','hist'],['social','soc'],['probability','prob'],['medical','stat']].map(([teacherId,subjectId])=>({teacherId,subjectId})),
 lessons:[l],absences:[{teacherId:'absent',startDate:l.date,endDate:l.date}],overrides:{},calendar:[]};
let cand=E.candidates(l,db);
assert.deepEqual(cand.map(x=>x.teacher.id),['same','probability','related']);
assert.equal(cand[0].subject,true);assert.equal(cand[1].related,true);
assert(cand[2].qualification.includes('Геометрия'));
assert.deepEqual(E.candidates({...l,subjectId:'hist'},db).map(x=>x.teacher.id),['history','social']);
assert.equal(E.optimize(db,l.date,{compact:false}).patches[0].after.teacherId,'same');
db.absences.push({teacherId:'same',startDate:l.date,endDate:l.date});
assert.equal(E.optimize(db,l.date,{compact:false}).patches[0].after.teacherId,'probability');
assert.equal(E.optimize(db,l.date,{compact:false,allowRelated:false}).unresolved.length,1);
db.absences.push(...['related','probability'].map(teacherId=>({teacherId,startDate:l.date,endDate:l.date})));
assert.equal(E.optimize(db,l.date,{compact:false,allowOther:true}).patches.length,0);
assert.equal(E.optimize(db,l.date,{compact:false,cancelUnresolved:true}).patches[0].after.cancelled,true);
db.absences=[];db.lessons.push({...l,id:'busy',teacherId:'same',classId:'other'});
assert.equal(E.candidates(l,db).find(x=>x.teacher.id==='same').busy,true);
assert.equal(E.subjectFamily('Медицинская статистика'),null);
console.log('Profile mapping, empty lanes, shared lessons, subject-only replacements, absences and optimizer: passed');
