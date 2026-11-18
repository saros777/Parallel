/* Offline, editable DOCX export. The docx library is bundled beside this file. */
(function(root){
  function build({school,date,groups,rows,prefs,subject,teacher,className,room,groupLabel,profileLines}){
  const D=root.docx,mm=n=>Math.round(n*1440/25.4),land=prefs.orientation==='landscape';
  const pageWidth=land?297:210,pageHeight=land?210:297,horizontalMargin=Math.min(20,prefs.margin+4),max=Math.max(8,...rows.map(l=>l.slot));
  const firstMM=prefs.view==='teachers'?32:10,slotMM=land?22:19,printableWidth=pageWidth-2*horizontalMargin,width=mm(Math.min(printableWidth,firstMM+max*slotMM));
  const first=mm(firstMM),widths=[first,...Array(max).fill(Math.floor((width-first)/max))];widths[widths.length-1]+=width-widths.reduce((a,b)=>a+b,0);
  const font=Math.max(9,prefs.font),border={style:D.BorderStyle.SINGLE,size:4,color:'89939E'};
  let band=false,sectionFont=font,lineTwips=240,lineRule=D.LineRuleType.AUTO;
  const para=(text,opts={})=>new D.Paragraph({spacing:{before:0,after:0,line:lineTwips,lineRule},...opts,children:[new D.TextRun({text:String(text||''),size:Math.round((opts.fontSize||sectionFont)*2),...(opts.bold?{bold:true}:{})})]});
  const lessonPara=(left,right,cellWidth,opts={})=>new D.Paragraph({spacing:{before:0,after:0,line:lineTwips,lineRule},...opts,tabStops:right?[{type:D.TabStopType.RIGHT,position:Math.max(120,cellWidth-90)}]:undefined,children:[new D.TextRun({text:String(left||''),size:Math.round(sectionFont*2)}),...(right?[new D.TextRun({text:'\t',size:Math.round(sectionFont*2)}),new D.TextRun({text:String(right),size:Math.round(sectionFont*2),bold:true,border:{style:D.BorderStyle.SINGLE,size:3,color:'59636F',space:1}})]:[])]});
  const cell=(text,i,head=false)=>new D.TableCell({width:{size:widths[i],type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,shading:band?{fill:'F0F3F5'}:head?{fill:'EFF2F5'}:undefined,children:Array.isArray(text)?text:[para(text,{bold:head,fontSize:i===0&&prefs.view==='teachers'?Math.min(sectionFont,7.5):sectionFont})]});
  const sections=groups.map(g=>{
   band=false;
   // Reserve enough room for the title, Word's mandatory paragraph/table
   // spacing and borders. Exact rows then keep the whole selected day on one
   // physical sheet instead of pushing the final class to page two.
   const fill=prefs.layout==='sheet'&&g.classes.length>=18,rowHeightMM=fill?Math.max(5,(pageHeight-2*prefs.margin-25)/(g.classes.length+1)):null,rowHeight=rowHeightMM?Math.floor(mm(rowHeightMM)):null;
   sectionFont=fill?Math.min(font,Math.max(6.5,(rowHeightMM-.8)*72/25.4/3)):font;lineTwips=fill?Math.round(sectionFont*20):240;lineRule=fill?D.LineRuleType.EXACT:D.LineRuleType.AUTO;
   const rowSizing=rowHeight?{height:{value:rowHeight,rule:D.HeightRule.EXACT}}:{};
   const head=new D.TableRow({tableHeader:true,cantSplit:true,...rowSizing,children:[cell(prefs.view==='teachers'?'Учитель':'Кл.',0,true),...Array.from({length:max},(_,i)=>cell(String(i+1),i+1,true))]});
   const data=g.classes.map((c,index)=>{band=prefs.banding&&(prefs.view==='teachers'?index%2===1:parseInt(c.name)%2===0);return new D.TableRow({cantSplit:true,...rowSizing,children:[cell(c.name,0,true),...Array.from({length:max},(_,i)=>{
    const lessons=rows.filter(l=>l[prefs.view==='teachers'?'teacherId':'classId']===c.id&&l.slot===i+1&&!l.cancelled&&!l.parked);
    const paragraphs=profileLines(lessons,c.id).flatMap((entry,j)=>{
     const l=entry.lesson;if(!l)return [para(' ',{spacing:{before:j?20:0,after:0,line:lineTwips,lineRule},border:j?{top:{...border,color:'C7CDD4'}}:undefined})];
     const parts=[prefs.subject?subject(l,prefs.abbreviate):'',prefs.view==='teachers'&&prefs.className?className(l):''].filter(Boolean),roomText=prefs.room?room(l):'';
     const out=[lessonPara(parts.join('  '),roomText,widths[i+1],{spacing:{before:j?20:0,after:0,line:lineTwips,lineRule},border:j?{top:{...border,color:'C7CDD4'}}:undefined})];
     if(prefs.teacher&&prefs.view!=='teachers')out.push(para(teacher(l)));
     if(prefs.group&&l.groupName&&!l.profileAudience?.length)out.push(para(groupLabel(l.groupName)));
     for(let continuation=1;continuation<(entry.span||1);continuation++)out.push(para(' '));
     return out;
    });
    return cell(paragraphs.length?paragraphs:[para('·')],i+1);
   })]})});
   return {properties:{page:{size:{width:11906,height:16838,orientation:land?D.PageOrientation.LANDSCAPE:D.PageOrientation.PORTRAIT},margin:{top:mm(prefs.margin),right:mm(horizontalMargin),bottom:mm(prefs.margin),left:mm(horizontalMargin),header:0,footer:0}}},children:[
    new D.Paragraph({alignment:D.AlignmentType.CENTER,keepNext:true,spacing:{after:40},children:[new D.TextRun({text:'Расписание '+root.PrintTools.dateLabel(date),bold:true,size:24})]}),
    new D.Table({alignment:D.AlignmentType.CENTER,width:{size:width,type:D.WidthType.DXA},columnWidths:widths,layout:D.TableLayoutType.FIXED,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},margins:{top:20,bottom:20,left:35,right:35},rows:[head,...data]})
   ]};
  });
  return new D.Document({creator:'Параллель '+(window.DESKTOP?.version||'5.4.17'),title:'Расписание '+date,description:'Редактируемая таблица расписания',styles:{default:{document:{run:{font:'Calibri',size:font*2},paragraph:{spacing:{before:0,after:0}}}}},sections});
 }
 root.WordExport={build};
 if(typeof module!=='undefined')module.exports=root.WordExport;
})(globalThis);
