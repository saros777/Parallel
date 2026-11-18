const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

vm.runInThisContext(fs.readFileSync(require.resolve('./ui/docx.iife.js'),'utf8'),{filename:'docx.iife.js'});
globalThis.docx=docx;
globalThis.window={DESKTOP:{version:'test'}};
globalThis.PrintTools=require('./ui/print-tools.js');
const WordExport=require('./ui/word-export.js');

const prefs={orientation:'portrait',margin:5,font:10,view:'classes',layout:'sheet',banding:false,subject:true,className:true,room:true,teacher:false,group:false,abbreviate:true};
const classes=Array.from({length:25},(_,i)=>({id:'c'+i,name:String(i+1)+'а'}));
const lesson={id:'lesson',classId:'c0',slot:1,roomId:'r12',profileAudience:[]};
const doc=WordExport.build({
 school:'Тест',date:'2026-09-07',groups:[{name:'Все',classes}],rows:[lesson],prefs,
 subject:()=>'м',teacher:()=>'',className:()=>'',room:()=>'12',groupLabel:x=>x,
 profileLines:rows=>rows.length?[{lesson:rows[0],start:0,span:1,lanes:3},{lesson:null,start:1,span:1,lanes:3},{lesson:null,start:2,span:1,lanes:3}]:[]
});

(async()=>{
 if(process.env.WORD_TEST_OUTPUT)fs.writeFileSync(process.env.WORD_TEST_OUTPUT,await docx.Packer.toBuffer(doc));
 const zip=docx.Packer.compiler.compile(doc,'',[]);
 const xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:tab w:val="right"/,'room number needs a right tab stop');
 assert.match(xml,/<w:bdr w:val="single"[^>]*w:color="59636F"/,'room number needs its own visible badge border');
 assert.match(xml,/<w:tblW w:type="dxa" w:w="9184"/,'portrait class table should leave enough room for one-line class names');
 assert.match(xml,/<w:jc w:val="center"/,'compact table should be centered on the page');
 assert.match(xml,/<w:pgMar[^>]*w:right="510"[^>]*w:left="510"/,'left and right Word margins should be larger than the base 5 mm margin');
 assert((xml.match(/<w:trHeight /g)||[]).length>=classes.length+1,'a full timetable should use the available A4 height');
 assert((xml.match(/w:hRule="exact"/g)||[]).length>=classes.length+1,'one-day Word rows must have exact heights so the table cannot spill to a second page');
 assert.equal((xml.match(/<w:sectPr>/g)||[]).length,1,'the selected day must be emitted as one Word section');
 assert(xml.includes('>12<'),'room number was lost from Word output');
 console.log('Word print layout passed: one exact-height A4 sheet, compact centered table and bordered right room badge.');
})().catch(error=>{console.error(error);process.exit(1)});
