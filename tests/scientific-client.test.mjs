import { operationLanguageScript } from "../dist/src/shared/operation-copy.js";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import test from "node:test";
import {csvFixture,csvContext} from "../dist/tests/csv-test-helpers.js";
import {SqliteScientificRepository} from "../dist/src/infrastructure/database/sqlite-scientific-repository.js";
import {APP_VERSION} from "../dist/src/config/constants.js";
const script=operationLanguageScript()+"\n"+readFileSync(new URL("../public/scientific-client.js",import.meta.url),"utf8");
const identity={algorithm_version:"echoclass.yield-analysis.v1",code_version:`sha256:${"a".repeat(64)}`,node_code_version:`sha256:${"b".repeat(64)}`,environment_fingerprint:`sha256:${"c".repeat(64)}`,environment:{synthetic:true},app_version:APP_VERSION};
class Element {
  children=[];handlers={};value="";textContent="";disabled=false;
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(){}
  addEventListener(name,handler){this.handlers[name]=handler;}
}
function storage(){const values=new Map();return {values,failRead:false,failWrite:false,getItem(key){if(this.failRead)throw Error("synthetic unavailable");return values.get(key)??null;},setItem(key,value){if(this.failWrite)throw Error("synthetic quota");values.set(key,value);}};}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function browser(f,store,language="zh-CN",search="?class_id=class-A"){
  const elements=new Map(), state={lose:false,available:true,user:"teacher",confirm:true,calls:[],timers:[]};
  const el=name=>{if(!elements.has(name))elements.set(name,new Element());return elements.get(name);};
  vm.runInNewContext(script,{document:{documentElement:{lang:language},getElementById:id=>el(id.replace(/^scientific-/,"")),createElement:()=>new Element()},localStorage:store,crypto:{randomUUID},location:{pathname:"/scientific-analysis",search},URLSearchParams,URL,confirm:()=>state.confirm,setTimeout:fn=>{state.timers.push(fn);return state.timers.length;},clearTimeout:()=>{},fetch:async(route,options={})=>{
    const url=new URL(route,"http://synthetic.example"),context=csvContext(state.user);let data;
    if(options.method==="POST"){
      const command=JSON.parse(options.body);state.calls.push(command);const result=f.repo.createScientificRun(context,command,state.available?identity:null);
      if(state.lose){state.lose=false;throw Error("synthetic lost response");}data={ok:true,...result};
    }else if(url.pathname==="/api/scientific-runs") data={ok:true,user_id:state.user,classes:f.repo.classes(context),available:state.available,runs:url.searchParams.get("class_id")?f.repo.listScientificRuns(context,url.searchParams.get("class_id")):[]};
    else data={ok:true,user_id:state.user,run:f.repo.getScientificRun(context,url.pathname.split("/").at(-1))};
    return {ok:true,status:200,json:async()=>data};
  }});
  await settle();return {el,state,click:async(name)=>{await el(name).handlers.click();await settle();}};
}
function fixture(){const f=csvFixture();f.submit();return {...f,repo:new SqliteScientificRepository(f.db,APP_VERSION)};}

test("lost response survives refresh and unavailable worker without creating another snapshot",async()=>{
  const f=fixture(),s=storage();try{let b=await browser(f,s);b.state.lose=true;await b.click("create");const token=b.state.calls[0].client_request_id;assert.equal(f.db.prepare("SELECT count(*) n FROM scientific_analysis_requests").get().n,1);b=await browser(f,s);b.state.available=false;await b.click("reload");assert.equal(b.el("create").disabled,false);await b.click("create");assert.equal(b.state.calls[0].client_request_id,token);assert.equal(f.db.prepare("SELECT count(*) n FROM scientific_analysis_requests").get().n,1);}finally{f.db.close();}
});
test("broken or unavailable token storage fails closed before POST",async()=>{
  for(const mode of ["read","write","corrupt"]){const f=fixture(),s=storage();try{if(mode==="read")s.failRead=true;if(mode==="write")s.failWrite=true;if(mode==="corrupt")s.values.set('echoclass.scientific.attempt.v1:["teacher","class-A"]',"broken");const b=await browser(f,s);await b.click("create");assert.equal(b.state.calls.length,0);assert.equal(f.db.prepare("SELECT count(*) n FROM scientific_analysis_requests").get().n,0);}finally{f.db.close();}}
});
test("only an explicit confirmed new intent replaces a previous token",async()=>{
  const f=fixture(),s=storage();try{const b=await browser(f,s);await b.click("create");const first=b.state.calls[0].client_request_id;b.state.confirm=false;await b.click("new");await b.click("create");assert.equal(b.state.calls[1].client_request_id,first);b.state.confirm=true;await b.click("new");await b.click("create");assert.notEqual(b.state.calls[2].client_request_id,first);assert.equal(f.db.prepare("SELECT count(*) n FROM scientific_analysis_requests").get().n,2);}finally{f.db.close();}
});
test("account changes clear visible reports and preserve the original user's intent",async()=>{
  const f=fixture(),s=storage();try{const b=await browser(f,s);await b.click("create");const saved=[...s.values.entries()];b.state.user="peer";await b.click("reload");assert.equal(b.el("create").disabled,true);assert.deepEqual([...s.values.entries()],saved);assert.equal(b.el("report").children.length,0);}finally{f.db.close();}
});

test("English analysis and a Chinese reload retain the same sealed request and token",async()=>{
 const f=fixture(),s=storage();try{
  const en=await browser(f,s,"en","?class_id=class-A&lang=en");
  assert.match(en.el("status").textContent,/Choose a class/);
  en.state.lose=true;await en.click("create");const token=en.state.calls[0].client_request_id;
  const zh=await browser(f,s,"zh-CN","?class_id=class-A&lang=zh");await zh.click("create");
  assert.equal(zh.state.calls[0].client_request_id,token);
  assert.equal(f.db.prepare("SELECT count(*) n FROM scientific_analysis_requests").get().n,1);
  assert.match(zh.el("status").textContent,/原分析任务/);
 }finally{f.db.close();}
});
