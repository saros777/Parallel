const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

vm.runInThisContext(fs.readFileSync(require.resolve('./ui/docx.iife.js'),'utf8'),{filename:'docx.iife.js'});
globalThis.docx=docx;
globalThis.window={DESKTOP:{version:'test'}};
globalThis.PrintTools=require('./ui/print-tools.js');
const WordExport=require('./ui/word-export.js');

const prefs={orientation:'portrait',margin:5,font:10,view:'classes',layout:'sheet',banding:false,subject:true,className:true,room:true,teacher:false,group:false,abbreviate:true};
const classes=Array.from({length:20},(_,i)=>({id:'c'+i,name:String(i+1)+'а'}));
const lesson={id:'lesson',classId:'c0',slot:1,roomId:'r12',profileAudience:[]};
const doc=WordExport.build({
 school:'Тест',date:'2026-09-07',groups:[{name:'Все',classes}],rows:[lesson],prefs,
 subject:()=>'м',teacher:()=>'',className:()=>'',room:()=>'12',groupLabel:x=>x,
 profileLines:rows=>rows.map((row,start)=>({lesson:row,start,span:1,lanes:1}))
});

(async()=>{
 const zip=docx.Packer.compiler.compile(doc,'',[]);
 const xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:tab w:val="right"/,'room number needs a right tab stop');
 assert.match(xml,/<w:bdr w:val="single"[^>]*w:color="59636F"/,'room number needs its own visible badge border');
 assert.match(xml,/<w:tblW w:type="dxa" w:w="9071"/,'portrait class table should be a compact 160 mm wide');
 assert.match(xml,/<w:jc w:val="center"/,'compact table should be centered on the page');
 assert.match(xml,/<w:pgMar[^>]*w:right="510"[^>]*w:left="510"/,'left and right Word margins should be larger than the base 5 mm margin');
 assert((xml.match(/<w:trHeight /g)||[]).length>=classes.length+1,'a full timetable should use the available A4 height');
 assert(xml.includes('>12<'),'room number was lost from Word output');
 console.log('Word print layout passed: compact centered table, full-page rows and bordered right room badge.');
})().catch(error=>{console.error(error);process.exit(1)});
