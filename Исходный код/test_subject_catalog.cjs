const assert=require('node:assert/strict'),fs=require('node:fs'),Catalog=require('./ui/subject-catalog.js');
const db=JSON.parse(fs.readFileSync('seed.json','utf8')),before=db.subjects.length,report=Catalog.clean(db);
assert.equal(report.merged,7);assert.equal(db.subjects.length,before-7);assert.equal(new Set(db.subjects.map(s=>Catalog.duplicateKey(s.name))).size,db.subjects.length);
const expected={'Разговоры о важном':'РОВ','Русский язык':'р/я','Математика':'м','Литературное чтение':'лч','Окружающий мир':'ом','Основы психологии':'ОПс','Педагогический имидж':'П-И'};
for(const [name,short]of Object.entries(expected)){const s=db.subjects.find(x=>x.name===name);assert(s,name);assert.equal(s.abbreviation,short);assert.equal(db.preferences.labels[s.id],short)}
const ids=new Set(db.subjects.map(s=>s.id));for(const rows of [db.lessons,db.extraLessons,db.baseSchedule?.lessons,db.courses,db.groups,db.teacherSubjects])for(const row of rows||[])if(row.subjectId)assert(ids.has(row.subjectId),'dangling subject '+row.subjectId);
assert(Object.values(db.overrides||{}).every(x=>!x.subjectId||ids.has(x.subjectId)));assert.equal(db.history.length,0);assert.equal(db.meta.subjectCatalogRevision,Catalog.revision);
console.log('Subject catalog: XLSX abbreviations, duplicate merge and all references passed');
