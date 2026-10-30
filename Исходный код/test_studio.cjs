const assert=require('node:assert/strict');
const S=require('./ui/studio-model.js'),E=require('./ui/engine.js');
require('./ui/room-engine.js');
const W=require('./ui/workbench-engine.js');
function fixture(){return {meta:{schemaVersion:'1.0'},classes:[{id:'c',name:'5а'}],teachers:[{id:'t',name:'Учитель',workDays:[1,2,3,4,5],allowedSlots:[2,3,4]}],subjects:[{id:'s',name:'Алгебра'}],rooms:[{id:'r',name:'1'}],groups:[],courses:[],calendar:[],lessons:[{id:'one',classId:'c',teacherId:'t',subjectId:'s',date:'2026-09-07',slot:2,time:'09:30 - 10:15'},{id:'two',classId:'c',teacherId:'t',subjectId:'s',date:'2026-09-14',slot:2,time:'09:30 - 10:15'}],extraLessons:[],overrides:{},absences:[]}}
let db=fixture(),base=S.template(db),source=base[0];
S.commitBase(db,[{id:source.id,before:source,after:{...source,slot:3,time:'10:30 - 11:15'}}]);
assert.deepEqual(E.effective(db).map(l=>l.slot),[3,3]);
assert.deepEqual(db.lessons.map(l=>l.slot),[2,2],'originals stay intact');
db.overrides.two={slot:4};assert.deepEqual(E.effective(db).map(l=>l.slot),[3,4],'dated exception wins');
const exported=JSON.parse(JSON.stringify(db));assert.deepEqual(E.effective(exported).map(l=>l.slot),[3,4],'template survives save/reopen');
S.commitBase(db,[{id:source.id,before:source,after:{...source,parked:true,parkingArea:'bottom'}}]);assert(E.effective(db).every(l=>l.parked),'base parking repeats');
assert.equal(E.conflicts(db).length,0,'parked lessons consume no teacher time');
db=fixture();assert.deepEqual(S.restrictions({...db.lessons[0],slot:1},db),['Урок вне разрешённого времени учителя']);
assert.deepEqual(S.restrictions({...db.lessons[0],date:'2026-09-12'},db),['Нерабочий день учителя']);
assert.deepEqual(S.restrictions({...db.lessons[0],slot:1,parked:true},db),[]);
db.absences=[{teacherId:'t',startDate:'2026-09-07',endDate:'2026-09-08',startSlot:2,endSlot:3}];assert(E.absenceFor(db.lessons[0],db));assert(!E.absenceFor({...db.lessons[0],slot:4},db));
db=fixture();db.courses=[{id:'course',teacherId:'t',classId:'c',subjectId:'s',studioEdited:true,groupId:'g',groupName:'Первая'}];db.lessons[0].courseId='course';db.groups=[{id:'g',classId:'c',subjectId:'s'},{id:'h',classId:'c',subjectId:'s'}];assert.equal(E.effective(db)[0].groupId,'g');assert(E.disjoint({...db.lessons[0],groupId:'g'},{...db.lessons[0],groupId:'h'},db));
const before=S.template(db);const added={...before[0],id:'new',courseId:null,slot:4,parked:true};S.commitBase(db,[{id:'new',before:added,after:added}]);assert.equal(E.effective(db).filter(l=>l.id.startsWith('new@')).length,2,'new weekly lessons generated on instructional dates');
// Room resolver must not return stale cached rows after changing the base schedule.
db=fixture();db.preferences={roomPolicy:{enabled:true,teacherRooms:{t:'r'},pool:['r']}};E.effective(db);source=S.template(db)[0];S.commitBase(db,[{id:source.id,before:source,after:{...source,slot:4}}]);assert.equal(E.effective(db)[0].slot,4);
console.log('Studio model: recurring edits, dated exceptions, reopen, reserve, availability, linked groups/courses and allocator cache passed');
db=fixture();db.preferences={studioSuspensions:true};db.absences=[{id:'abs',teacherId:'t',startDate:'2026-09-07',endDate:'2026-09-07',startSlot:2,endSlot:2}];
let suspended=E.effective(db)[0];assert(suspended.suspended);assert(!E.overlap(suspended,{...suspended,id:'other'}),'absent card frees its slot');
db.overrides.one={absenceReturnFor:'abs'};assert(!E.effective(db)[0].suspended,'explicit return can acknowledge absence');
db.absences[0].id='another';assert(E.effective(db)[0].suspended,'new absence cannot reuse an old acknowledgement');
db=fixture();db.calendar=[{classId:'c',date:'2026-09-08',isHoliday:true}];source=S.template(db)[0];S.commitBase(db,[{id:source.id,before:source,after:{...source,date:'2026-09-08'}}]);assert(E.effective(db)[0].cancelled,'base recurrence respects noninstructional days');
console.log('Studio model: absence trays, explicit return, subsequent absences and holiday calendar passed');

db=fixture();source=S.template(db)[0];S.commitBase(db,[{id:source.id,before:source,after:{...source,slot:3}}]);const sliced=W.slice(db,['2026-09-14']);assert.equal(E.effective(sliced).length,1);assert.equal(E.effective(sliced)[0].slot,3);
console.log('Studio model: slicing a later week preserves base projection without duplicate lessons');

// Occupancy follows the visible grid, never a stale or missing bell label.
db=fixture();const gridLesson=db.lessons[0];
assert(!E.overlap(gridLesson,{...gridLesson,id:'free',slot:5,time:gridLesson.time}),'different columns cannot collide because of copied bell text');
assert(E.overlap(gridLesson,{...gridLesson,id:'busy',time:''}),'same column remains occupied without bell text');
assert(E.overlap(gridLesson,{...gridLesson,id:'busy2',time:'23:00 - 23:45'}),'same column cannot look free because the clock text differs');
const emptyMove={id:gridLesson.id,before:gridLesson,after:{...gridLesson,slot:4,time:''}};
assert.deepEqual(W.assess(db,[emptyMove]).issues,[],'empty column is valid when bell time is unknown');
assert(S.targetAllowed(gridLesson,'classes','c'));assert(!S.targetAllowed(gridLesson,'classes','other'));
assert(S.targetAllowed(gridLesson,'teachers','t'));assert(!S.targetAllowed(gridLesson,'teachers','other-teacher'));
console.log('Regression: grid occupancy, stale/missing bell labels and strict row ownership passed');
