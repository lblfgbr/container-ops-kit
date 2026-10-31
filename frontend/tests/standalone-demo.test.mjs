import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole,requestInterceptor} from 'jsdom';

const demoUrl=new URL('../../mock-demo.html',import.meta.url);
const html=await readFile(demoUrl,'utf8');
const pkg=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
const wait=(ms=70)=>new Promise(resolve=>setTimeout(resolve,ms));
async function openDemo(route='home/tools'){
  const errors=[],requests=[],alerts=[],vc=new VirtualConsole();
  vc.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message)});
  // Styles are checked separately; these tests exercise scripts and interaction, not browser layout.
  const dom=new JSDOM(html.replace(/<style>[\s\S]*?<\/style>/g,''),{
    url:demoUrl.href+'#/'+route,runScripts:'dangerously',resources:{interceptors:[requestInterceptor(request=>{requests.push(request.url);return new Response('',{status:403})})]},virtualConsole:vc,pretendToBeVisual:true,
    beforeParse(w){
      w.Response=Response;w.Request=Request;w.Headers=Headers;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
      w.fetch=url=>{requests.push(String(url));throw Error('Unexpected live fetch')};
      w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
      w.HTMLElement.prototype.scrollIntoView=function(){};
      w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
      w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
      w.URL.createObjectURL=()=> 'blob:demo-export';w.URL.revokeObjectURL=()=>{};
      w.confirm=()=>true;w.alert=message=>alerts.push(message);
    }
  });
  await wait(150);
  return {dom,w:dom.window,d:dom.window.document,errors,requests,alerts,close:()=>dom.window.close(),route:async route=>{dom.window.location.hash='#/'+route;await wait(100)}};
}

test('root demo is one self-contained offline HTML artifact with the current product version',()=>{
  const dom=new JSDOM(html),d=dom.window.document;
  try{
    assert.equal(d.querySelector('meta[name="ops-studio-demo"]').content,'offline-mock');
    assert.equal(d.querySelectorAll('script[src],link[rel="stylesheet"],script[type="module"],base').length,0);
    assert.ok(d.querySelectorAll('style').length>0);
    assert.match(d.querySelector('meta[http-equiv="Content-Security-Policy"]').content,/connect-src 'none'; frame-src 'none'; form-action 'none'/);
    assert.ok(html.includes('V'+pkg.version),'Regenerate the demo after changing the product version');
    assert.ok(html.includes('prototype-mode-note'));
  }finally{dom.window.close()}
});

test('file URL demo renders production routes, edits mock state and isolates external transports',async t=>{
  const s=await openDemo();t.after(s.close);
  assert.match(s.d.querySelector('#prototype-mode-note').textContent,/离线交互演示.*刷新重置/);
  for(const route of ['home/tools','home/overview','container/dashboard','container/build','container/deploy','container/resources','container/operations','automation','automation/tools','automation/group-mr','automation/auto-ut','automation/quality','automation/tasks','automation/schedules','automation/settings','automation/knowledge','applications','tools','tools/json','tools/binlog']){
    await s.route(route);assert.ok(s.d.querySelector('#app').textContent.trim(),'Page is populated: '+route);
  }
  await s.route('automation/group-mr');
  assert.equal(s.d.querySelectorAll('[data-group-mr-record]').length,10);
  s.d.querySelector('[data-mrw-page="1"]').click();await wait();
  assert.equal(s.d.querySelector('[data-group-mr-record]').dataset.groupMrRecord,'11');
  const post=(path,body)=>s.w.fetch(path,{method:'POST',body:JSON.stringify(body)});
  const accepted=await (await post('/api/automation/group-mr/submit',{url:'https://codehub-y.huawei.com/Demo/Manual/merge_requests/101'})).json();
  assert.equal(accepted.duplicate,false);
  const approval=await post('/api/automation/group-mr/records/'+accepted.entryId+'/review-jobs',{sha:'a'.repeat(40),decision:'pass'});
  assert.equal(approval.status,202);await wait(450);
  const status=await(await s.w.fetch('/api/automation/group-mr/status')).json();
  assert.ok(status.history.some(record=>record.id===accepted.entryId&&record.phase==='DONE'));
  const build=await(await post('/api/build-tasks',{mode:'SINGLE',module:'gateway-service',environmentId:1,baseline:{archDesignBranch:'main'}})).json();
  const event=await new Promise(resolve=>{const stream=new s.w.EventSource('/api/build-tasks/'+build.id+'/events');stream.onmessage=e=>{stream.close();resolve(JSON.parse(e.data))}});
  assert.match(event.message,/构建/);
  assert.equal((await s.w.fetch('https://example.test/api/environments')).status,403);
  assert.throws(()=>new s.w.XMLHttpRequest().open('GET','https://example.test'),/离线演示/);
  assert.throws(()=>new s.w.WebSocket('wss://example.test'),/禁用/);
  assert.equal(s.w.navigator.sendBeacon('https://example.test','data'),false);
  assert.equal(s.w.open('https://example.test'),null);
  await s.route('applications');s.d.querySelector('[data-pr-app="10000000-0000-4000-8000-000000000001"]').click();await wait(100);
  assert.ok(s.d.querySelector('[aria-label="模拟外部应用"]'),JSON.stringify({route:s.w.location.hash,errors:s.errors,content:s.d.querySelector('main')?.textContent.slice(0,300)}));assert.equal(s.d.querySelector('iframe'),null);
  assert.deepEqual(s.requests,[]);assert.deepEqual(s.errors,[]);
});

test('reopening the demo restores seed data and resets browser-only demo changes',async()=>{
  const first=await openDemo();
  try{
    await first.w.fetch('/api/environments/1',{method:'DELETE'});
    first.w.localStorage.setItem('demo-session-check','changed');
    assert.equal((await(await first.w.fetch('/api/environments')).json()).length,5);
  }finally{first.close()}
  const second=await openDemo();
  try{
    assert.equal((await(await second.w.fetch('/api/environments')).json()).length,6);
    assert.equal(second.w.localStorage.getItem('demo-session-check'),null);
    assert.deepEqual(second.errors,[]);
  }finally{second.close()}
});
