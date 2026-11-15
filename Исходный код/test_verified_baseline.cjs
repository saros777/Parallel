const assert=require('node:assert/strict'),db=require('./seed.json');
const rows=db.baseSchedule.lessons,subject=id=>db.subjects.find(s=>s.id===id)?.abbreviation,classId=name=>db.classes.find(c=>c.name.toLowerCase()===name).id;
assert.equal(db.meta.scheduleBaselineRevision,1);assert.equal(db.meta.scheduleSource,'raspisanie_s_podgruppami_utochnennoe.xlsx');
assert.equal(rows.length,862);assert.equal(new Set(rows.map(l=>l.classId)).size,25);
assert.equal(db.lessons.length,0);assert.equal(Object.keys(db.overrides).length,0);assert.equal(db.extraLessons.length,0);assert.equal(db.absences.length,0);assert.equal(db.history.length,0);
const c2=rows.filter(l=>l.classId===classId('2б')),c9=rows.filter(l=>l.classId===classId('9б'));
assert.equal(c2.length,25);assert.equal(c2.filter(l=>subject(l.subjectId)==='Т').length,1);
assert.equal(c9.length,42);assert(c9.some(l=>l.date==='2026-09-07'&&l.slot===1&&subject(l.subjectId)==='РОВ'));
for(const l of rows){assert(db.classes.some(x=>x.id===l.classId));assert(db.subjects.some(x=>x.id===l.subjectId));assert(db.teachers.some(x=>x.id===l.teacherId))}
const unplaced=rows.filter(l=>l.parked);assert.equal(unplaced.length,4);assert(unplaced.every(l=>l.parkingArea==='bottom'&&l.placementIssue));
assert.equal(db.courses.reduce((n,c)=>n+(+c.weeklyHours||0),0),rows.length);
console.log('Verified workbook baseline: 862 cards, all 25 classes, 9б present, 2б has one technology lesson, dated changes reset');
