import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import {DEFAULT_APPEARANCE,resolveAppearance,adaptColor,adaptItem} from "../src/appearance.ts";
import {expression,renderTemplate} from "../src/template.ts";
import {parseXNote} from "../src/parser.ts";

test("adaptive contrast, original colors, and mobile neon defaults",()=>{
 const dark=resolveAppearance(DEFAULT_APPEARANCE,true,true);
 const light=resolveAppearance(DEFAULT_APPEARANCE,false,false);
 assert.equal(dark.simpleNeon,true);
 assert.equal(light.simpleNeon,false);
 assert.deepEqual(adaptColor([0,0,0,255],dark),[229,229,232,255]);
 assert.deepEqual(adaptColor([255,255,255,255],light),[35,35,38,255]);
 assert.deepEqual(adaptColor([255,92,92,255],dark),[255,92,92,255]);
 assert.deepEqual(adaptColor([0,0,0,255],resolveAppearance({...DEFAULT_APPEARANCE,appearanceMode:"original"},true,true)),[0,0,0,255]);
 const source={kind:"stroke",tool:"pen",samples:[[10,20,1]],config:{base_width:4,neon:true,rgba:[0,0,0,255]},cuts:[[1,2,3,4]]};
 const shown=adaptItem(source,dark);
 assert.equal(shown.config.neon,false);assert.equal(source.config.neon,true);
 assert.deepEqual(shown.cuts,source.cuts);assert.deepEqual(source.config.rgba,[0,0,0,255]);
});
test("bounded template expression evaluation",()=>{
 const box={w:210,h:297};
 assert.equal(expression("100% - 22mm - summary",box,"y",{summary:50}),225);
 assert.equal(expression("W * cue",box,"x",{cue:.3}),63);
 assert.equal(expression("2cm + 5mm",box,"x",{}),25);
 assert.equal(expression("pow(2,3)",box,"unit",{}),8);
 assert.ok(Number.isNaN(expression("constructor(1)",box,"unit",{})));
 assert.ok(Number.isNaN(expression("1/0",box,"unit",{})));
});
test("Cornell-like embedded template geometry and text draw without changing page data",()=>{
 const commands=[];
 const ctx=new Proxy({globalAlpha:1},{get(t,p){if(p in t)return t[p];return (...args)=>commands.push([p,...args]);},set(t,p,v){t[p]=v;return true;}});
 const page={width:1240,height:1754,pdf_page:null,items:[]};
 const template={xtemplate:1,params:{cue:{type:"number",default:.3},summary:{type:"length",default:"50mm"}},items:[
  {type:"group",stroke:"accent",children:[{type:"hline",y:"22mm"},{type:"vline",x:"W * cue",y1:"22mm",y2:"100% - summary"}]},
  {type:"group",x:"W * cue",y:"22mm",w:"100% - W * cue",h:"100% - 22mm - summary",children:[{type:"repeat",axis:"y",period:"8mm",children:[{type:"hline",y:"100%"}]}]},
  {type:"text",text:"Cues",x:"4mm",y:"28mm",fill:"accent"}]};
 const before=JSON.stringify(template);
 renderTemplate(ctx,page,{page_color:[24,25,28,255]},template,150);
 assert.ok(commands.filter(c=>c[0]==="stroke").length>10);
 assert.ok(commands.some(c=>c[0]==="fillText"&&c[1]==="Cues"));
 assert.equal(JSON.stringify(template),before);
});
test("parse synthetic embedded template and AAC recording",()=>{
 const manifest={format:"xnote",version:1,writer:67,dpi:150,style:{template:"local"},pages:[{width:1275,height:2100,pdf_page:null,items:[{kind:"audio",asset:"assets/audio-000.m4a",rect:[10,20,100,40],rid:1}]}]};
 const template={xtemplate:1,name:"test",items:[{type:"hline",y:"10mm"}]};
 const zip=zipSync({"manifest.json":strToU8(JSON.stringify(manifest)),"templates/local.xtemplate":strToU8(JSON.stringify(template)),"assets/audio-000.m4a":new Uint8Array([1,2,3])});
 const parsed=parseXNote(zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength));
 assert.deepEqual(parsed.templates.get("local"),template);
 assert.equal(parsed.assets.get("assets/audio-000.m4a").type,"audio/mp4");
 assert.equal(parsed.manifest.pages[0].items[0].rid,1);
});
