const assert=require('node:assert/strict'),fs=require('node:fs'),Catalog=require('./ui/subject-catalog.js');
const db=JSON.parse(fs.readFileSync('seed.json','utf8')),before=db.subjects.length,beforeLessons=db.lessons.length,report=Catalog.clean(db);
assert.equal(report.merged,20);assert.equal(report.deleted,18);assert.equal(db.subjects.length,before-report.merged-report.deleted);assert.equal(new Set(db.subjects.map(s=>Catalog.duplicateKey(s.name))).size,db.subjects.length);assert(db.subjects.every(s=>Catalog.rules.some(([re])=>re.test(s.name))));assert.equal(db.lessons.length,beforeLessons);
const expected={'Английский язык':'а/я','Разговоры о важном':'РОВ','Русский язык':'р/я','Математика':'м','Литературное чтение':'лч','Окружающий мир':'ом','Основы психологии':'ОПс','Педагогический имидж':'П-И'};
for(const [name,short]of Object.entries(expected)){const s=db.subjects.find(x=>x.name===name);assert(s,name);assert.equal(s.abbreviation,short);assert.equal(db.preferences.labels[s.id],short)}
const ids=new Set(db.subjects.map(s=>s.id));for(const rows of [db.lessons,db.extraLessons,db.baseSchedule?.lessons,db.courses,db.groups,db.teacherSubjects])for(const row of rows||[]){assert(row.subjectId,'missing subject');assert(ids.has(row.subjectId),'dangling subject '+row.subjectId)}
assert(Object.values(db.overrides||{}).every(x=>!x.subjectId||ids.has(x.subjectId)));assert.equal(db.history.length,0);assert.equal(db.meta.subjectCatalogRevision,Catalog.revision);
console.log('Subject catalog: XLSX abbreviations, duplicate merge and all references passed');
