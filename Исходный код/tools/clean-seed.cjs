const fs=require('node:fs');
const catalog=require('../ui/subject-catalog.js');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node tools/clean-seed.cjs input.json output.json');
const db=JSON.parse(fs.readFileSync(input,'utf8'));
catalog.clean(db);
fs.writeFileSync(output,JSON.stringify(db));
