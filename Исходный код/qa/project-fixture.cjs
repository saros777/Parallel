// Full-size, clean saved document for native installation/startup verification.
const fs=require('fs'),path=require('path');
const rooms=require('../ui/room-engine.js');
const db=JSON.parse(fs.readFileSync(path.join(__dirname,'../seed.json'),'utf8'));
db.preferences={subject:true,teacher:true,room:true,group:true,abbreviate:true,showCancelled:true,labels:{},studioSuspensions:true};
rooms.install(db,db.preferences);
db.meta.projectName='Школьное расписание';
fs.writeFileSync(process.argv[2],JSON.stringify(db));
