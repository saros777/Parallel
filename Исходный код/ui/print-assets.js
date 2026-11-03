/* Load the larger export libraries only when print/export is requested. */
let printAssetPromise=null;
function ensurePrintAssets(){
 if(!printAssetPromise)printAssetPromise=Promise.all(['html2canvas.min.js','jspdf.umd.min.js','docx.iife.js'].map(src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('Не удалось загрузить модуль печати'));document.head.append(script)}))).catch(e=>{printAssetPromise=null;throw e});
 return printAssetPromise;
}
const printWithAssets=showPrint;
showPrint=async function(...args){try{message('Подготавливаю печать…');await ensurePrintAssets();message('');return printWithAssets(...args)}catch(e){message(e.message)}};
