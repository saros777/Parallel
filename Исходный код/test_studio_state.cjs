const assert=require('node:assert/strict'),State=require('./ui/studio-state.js');
const restored=State.normalize({period:'weeks',axis:'teachers',teacherSpan:'day',teacherDay:4,date:'2026-11-19',selectedClassIds:['a','missing'],filters:{bottom:{mode:'teacher',value:'t'},side:{mode:'subject',value:'s'}}},['a','b'],'2026-09-07');
assert.deepEqual(restored,{period:'weeks',axis:'teachers',teacherSpan:'day',teacherDay:4,date:'2026-11-19',selectedClassIds:['a'],filters:{bottom:{mode:'teacher',value:'t'},side:{mode:'subject',value:'s'}}});
const defaults=State.normalize({period:'bad',axis:'bad',teacherSpan:'bad',teacherDay:9,date:'bad',selectedClassIds:null,filters:{bottom:{mode:'bad'}}},['a'],'2026-09-07');
assert.deepEqual(defaults,{period:'base',axis:'classes',teacherSpan:'week',teacherDay:1,date:'2026-09-07',selectedClassIds:null,filters:{bottom:{mode:'all',value:''},side:{mode:'all',value:''}}});
console.log('Studio view state: modes, date, selected classes and tray filters survive save/reopen');
