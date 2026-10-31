// Build an offline demo from the shipped UI. This script is never imported by production.
import {access,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ExcelJS from 'exceljs';
import {build} from 'vite';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const frontend=resolve(root,'frontend');
const escapeScript=source=>source.replaceAll(/<\/script/gi,'<\\/script');
async function bundle(entry,name){
  const result=await build({configFile:false,root:frontend,logLevel:'silent',build:{write:false,minify:false,lib:{entry,name,formats:['iife']}}});
  const output=(Array.isArray(result)?result[0]:result).output;
  return {js:output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n'),css:output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>item.source).join('\n')};
}

export async function buildDemoHtml(){
  const runtime=await bundle(resolve(frontend,'src/studio-runtime.js'),'OpsDemoRuntime');
  const parser=await bundle(resolve(frontend,'prototypes/binlog-prototype-entry.js'),'OpsDemoParser');
  let html=await readFile(resolve(frontend,'index.html'),'utf8');
  for(const match of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]){
    const file=resolve(frontend,match[1].replace(/^\//,''));
    if(!file.startsWith(frontend+sep))throw Error('Demo stylesheet must be inside frontend');
    const css=await readFile(file,'utf8');
    html=html.replace(match[0],()=>'<style>'+css+'</style>');
  }
  const workbook=new ExcelJS.Workbook();
  workbook.addWorksheet('模拟报文').addRows([['字段','值','说明'],['cmdCode','0b18','模拟状态上报'],['status',1,'模拟在线状态']]);
  const xlsx=Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  const archive=await readFile(resolve(frontend,'prototypes/mock-package.base64'),'utf8');
  const api=await readFile(resolve(frontend,'prototypes/current-project-mock.js'),'utf8');
  const presentation=await readFile(resolve(frontend,'prototypes/demo-presentation.js'),'utf8');
  const mock=parser.js+'\nwindow.__mockXlsx='+JSON.stringify(xlsx)+';\nwindow.__mockPackage='+JSON.stringify(archive)+';\n'+api;
  // Applies even when double-clicked as file://, and also contains future unmocked transports.
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  html=html.replace('<head>',()=>'<head>\n<meta name="ops-studio-demo" content="offline-mock">\n<meta http-equiv="Content-Security-Policy" content="'+policy+'">\n');
  html=html.replace(/<title>[\s\S]*?<\/title>/,'<title>Ops Studio · 离线交互演示</title>');
  html=html.replace('<script>',()=>'<script>'+escapeScript(mock)+'</script>\n<script>');
  html=html.replace('</head>',()=>'<style>'+runtime.css+'</style>\n</head>');
  html=html.replace('</body>',()=>'<script>'+escapeScript(presentation+'\n'+runtime.js)+'</script>\n</body>');
  return '<!-- Offline mock and page approval draft. Edit this file first and obtain user approval before changing production UI. Regenerate only after the approved design is implemented; npm run demo -- --overwrite replaces this draft. -->\n'+html;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const destination=resolve(root,'mock-demo.html'),overwrite=process.argv.includes('--overwrite');
  if(!overwrite){
    let exists=false;
    try{await access(destination);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(exists)throw Error('mock-demo.html 已存在，已保留页面确认稿。仅在用户已确认且正式实现完成、没有待同步演示修改时，使用 npm run demo -- --overwrite。');
  }
  const html=await buildDemoHtml();
  await writeFile(destination,html,{flag:overwrite?'w':'wx'});
  if(process.argv.includes('--legacy'))await writeFile(resolve(frontend,'prototypes/ops-studio-prototype.html'),html);
  console.log('Generated root mock-demo.html: standalone offline demo and page approval draft. Open it directly in a browser; refresh resets mock data.');
}
