// Partial, bounded implementation of embedded xtemplate v1. No eval, scripts, or external fetches.
// Original xtemplate format: https://github.com/shardulvs/xnotes-android
import type {Page,PageStyle} from "./types.ts";
import {rgbaCss} from "./text.ts";

type Box={w:number;h:number};
type Vars=Record<string,number|string>;
type Axis="x"|"y"|"short"|"unit";
type Node=Record<string,unknown>;
type Style=Record<string,unknown>;
const isNode=(v:unknown):v is Node => v!==null && typeof v==="object"&&!Array.isArray(v);
const own=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
const units:Record<string,number>={mm:1,cm:10,in:25.4,pt:25.4/72,deg:1};
const funcs:Record<string,(...a:number[])=>number>={
 min:Math.min,max:Math.max,abs:Math.abs,floor:Math.floor,ceil:Math.ceil,
 round:x=>Math.sign(x)*Math.floor(Math.abs(x)+.5),
 mod:(a,b)=>((a%b)+b)%b,sqrt:Math.sqrt,pow:Math.pow,
 sin:x=>Math.sin(x*Math.PI/180),cos:x=>Math.cos(x*Math.PI/180),tan:x=>Math.tan(x*Math.PI/180),log10:Math.log10,
};
export function expression(value:unknown,box:Box,axis:Axis,vars:Vars,fallback=NaN):number{
 if(typeof value==="number")return Number.isFinite(value)?value:fallback;
 if(typeof value!=="string"||value.length>1000)return fallback;
 const raw=value.trim();
 const tokens=raw.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:mm|cm|in|pt|%|deg)?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/,]/g);
 if(!tokens||tokens.join("")!==raw.replace(/\s+/g,"")||tokens.length>200)return fallback;
 let pos=0,ops=0;
 const ref=axis==="x"?box.w:axis==="y"?box.h:axis==="unit"?1:Math.min(box.w,box.h);
 const names:Vars={...vars,W:box.w,H:box.h,pi:Math.PI};
 const expr=():number=>{let a=product();while(tokens[pos]==="+"||tokens[pos]==="-"){const op=tokens[pos++],b=product();a=op==="+"?a+b:a-b;}return a;};
 const product=():number=>{let a=unary();while(tokens[pos]==="*"||tokens[pos]==="/"){const op=tokens[pos++],b=unary();a=op==="*"?a*b:a/b;}return a;};
 const unary=():number=>{if(++ops>200)throw Error("expression limit");if(tokens[pos]==="+"){pos++;return unary();}if(tokens[pos]==="-"){pos++;return -unary();}return atom();};
 const atom=():number=>{
  const token=tokens[pos++];if(!token)throw Error("missing token");
  if(token==="("){const a=expr();if(tokens[pos++]!==")")throw Error("bracket");return a;}
  const m=/^((?:\d+(?:\.\d*)?|\.\d+))(mm|cm|in|pt|%|deg)?$/.exec(token);
  if(m)return Number(m[1])*(m[2]==="%"?ref/100:units[m[2]]??1);
  if(tokens[pos]==="("){
   if(!own(funcs,token))throw Error("unknown function");pos++;const args:number[]=[];
   if(tokens[pos]!==")"){for(;;){args.push(expr());if(tokens[pos]!==",")break;pos++;if(args.length>=12)throw Error("arity");}}
   if(tokens[pos++]!==")")throw Error("bracket");return funcs[token](...args);
  }
  const v=own(names,token)?names[token]:undefined;if(typeof v!=="number")throw Error("unknown name");return v;
 };
 try{const a=expr();return pos===tokens.length&&Number.isFinite(a)?a:fallback;}catch{return fallback;}
}
const defaults:Style={stroke:"ink",strokeWidth:"0.25mm",fill:"none",opacity:1,size:"3.5mm",font:"sans",weight:"normal",italic:false,align:"start",baseline:"alphabetic",rotate:0,dash:"none"};
function inherit(base:Style,node:Node):Style{
 const s={...base};for(const k of Object.keys(defaults))if(own(node,k))s[k]=node[k];return s;
}
function cells(total:number,period:number,count:number,fit:unknown){
 if(!(total>0))return null;
 const limit=Number.isFinite(count)?Math.max(0,Math.floor(count)):Infinity;
 if(limit===0)return null;
 if(!(period>=.1)){
  if(!Number.isFinite(limit)||limit===0)return null;
  const n=Math.min(1000,limit),p=total/limit;return {p,n,offset:0,step:p};
 }
 let n=Math.min(limit,fit==="repeat"?Math.ceil(total/period):Math.floor(total/period));
 let p=period,offset=0,step=p;
 if(fit==="round"){n=Number.isFinite(limit)?limit:Math.max(1,Math.round(total/p));p=total/n;step=p;}
 if(!(n>0))return null;
 if(fit==="center")offset=(total-n*p)/2;
 if(fit==="space"){if(n===1)offset=(total-p)/2;else step=(total-p)/(n-1);}
 return {p,n:Math.min(1000,n),offset,step};
}
export function renderTemplate(ctx:CanvasRenderingContext2D,page:Page,style:PageStyle,template:unknown,dpi:number):void{
 if(!isNode(template)||template.xtemplate!==1||!Array.isArray(template.items))return;
 const pxmm=(Number.isFinite(dpi)&&dpi>30&&dpi<1000?dpi:150)/25.4;
 const box={w:page.width/pxmm,h:page.height/pxmm};
 const paper=style.page_color??[255,255,255,255];
 const dark=paper[0]*.2126+paper[1]*.7152+paper[2]*.0722<120;
 const ink=rgbaCss(style.pattern_color??(dark?[165,165,175,190]:[110,110,120,160]));
 const accent=rgbaCss(style.accent_color??(dark?[240,105,115,200]:[200,58,68,195]));
 const params:Vars=Object.create(null);
 if(isNode(template.params))for(const [name,d] of Object.entries(template.params)){
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)||!isNode(d)||["W","H","i","j","pi"].includes(name)||own(funcs,name))continue;
  if(d.type==="color"&&typeof d.default==="string")params[name]=d.default;
  if(["length","number","integer"].includes(String(d.type))){
   let v=expression(d.default,box,"unit",{},NaN);
   if(d.role==="spacing"&&d.type==="length"&&typeof style.spacing==="number")v=style.spacing/pxmm;
   if(!Number.isFinite(v))continue;
   v=Math.min(expression(d.max,box,"unit",{},Infinity),Math.max(expression(d.min,box,"unit",{},-Infinity),v));
   params[name]=d.type==="integer"?Math.round(v):v;
  }
 }
 function color(value:unknown):string|null{
  if(value==="none"||value==null)return null;
  if(value==="ink")return ink;if(value==="accent")return accent;
  if(typeof value!=="string")return null;
  const resolved=own(params,value)&&typeof params[value]==="string"?String(params[value]):value;
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(resolved)||/^[a-z]+$/i.test(resolved)?resolved:null;
 }
 let budget=30000;
 function draw(items:unknown,b:Box,base:Style,idx:Vars,depth:number,parentOpacity:number):void{
  if(depth>25||!Array.isArray(items)||budget<=0)return;
  const vars={...params,...idx};
  for(const node of items){
   if(--budget<0)break;if(!isNode(node))continue;
   const s=inherit(base,node);
   const E=(v:unknown,a:Axis,f=NaN)=>expression(v,b,a,vars,f);
   const X=(v:unknown)=>E(v,"x"),Y=(v:unknown)=>E(v,"y"),Z=(v:unknown)=>E(v,"short");
   const opacity=parentOpacity*(own(node,"opacity")?Math.max(0,Math.min(1,E(node.opacity,"unit",1))):1);
   if(node.type==="group"){
    let x=X(node.x??0),y=Y(node.y??0),w=X(node.w??"100%"),h=Y(node.h??"100%");
    if(![x,y,w,h].every(Number.isFinite)||!(w>0&&h>0))continue;
    const a=Array.isArray(node.inset)?node.inset:[node.inset??0];
    const inset=[a[0],a[1]??a[0],a[2]??a[0],a[3]??a[1]??a[0]];
    const ib={w,h};const [t,r,bt,l]=inset.map((v,k)=>expression(v,ib,k%2?"x":"y",vars,0));
    x+=l;y+=t;w-=l+r;h-=t+bt;if(!(w>0&&h>0))continue;
    ctx.save();try{if(node.clip){ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();}ctx.translate(x,y);draw(node.children,{w,h},s,idx,depth+1,opacity);}finally{ctx.restore();}continue;
   }
   if(node.type==="repeat"){
    const axis=node.axis??"y",fit=node.fit??"repeat",name=node.index;
    if(axis==="none"){
     const count=Math.min(1000,Math.max(0,Math.floor(E(node.count,"unit",0))));
     for(let i=0;i<count&&budget>0;i++){const next:Vars={...idx,i};if(typeof name==="string")next[name]=i;draw(node.children,b,s,next,depth+1,opacity);}continue;
    }
    if(!["x","y","xy"].includes(String(axis)))continue;
    const period=Array.isArray(node.period)?node.period:[node.period,node.period];
    const count=Array.isArray(node.count)?node.count:[node.count,node.count];
    const fits=Array.isArray(fit)?fit:[fit,fit];
    const ax=axis==="x"||axis==="xy"?cells(b.w,X(period[0]),E(count[0],"unit"),fits[0]):{p:b.w,n:1,offset:0,step:b.w};
    const ay=axis==="y"||axis==="xy"?cells(b.h,Y(period[axis==="xy"?1:0]),E(count[axis==="xy"?1:0],"unit"),fits[axis==="xy"?1:0]):{p:b.h,n:1,offset:0,step:b.h};
    if(!ax||!ay)continue;
    ctx.save();try{ctx.beginPath();ctx.rect(0,0,b.w,b.h);ctx.clip();
     for(let j=0;j<ay.n&&budget>0;j++)for(let i=0;i<ax.n&&budget>0;i++){
      const next:Vars={...idx,i:axis==="y"?j:i,j:axis==="xy"?j:0};
      if(typeof name==="string")next[name]=next.i;else if(Array.isArray(name)){if(typeof name[0]==="string")next[name[0]]=i;if(typeof name[1]==="string")next[name[1]]=j;}
      const shift=axis==="xy"&&j%2===1?X(node.stagger??0):0;
      ctx.save();try{ctx.translate(ax.offset+i*ax.step+shift,ay.offset+j*ay.step);draw(node.children,{w:ax.p,h:ay.p},s,next,depth+1,opacity);}finally{ctx.restore();}
     }
    }finally{ctx.restore();}continue;
   }
   ctx.save();
   try{
    ctx.globalAlpha*=opacity;
    const stroke=color(s.stroke),fill=color(s.fill);
    ctx.strokeStyle=stroke??"transparent";ctx.fillStyle=fill??"transparent";
    ctx.lineWidth=Math.max(.02,Math.min(20,E(s.strokeWidth,"short",.25)));ctx.lineCap="round";ctx.lineJoin="round";
    if(Array.isArray(s.dash)&&s.dash.length>=2){const dash=s.dash.slice(0,2).map(v=>E(v,"short",0));if(dash.every(v=>v>=0))ctx.setLineDash(dash);}
    const line=(x1:number,y1:number,x2:number,y2:number)=>{ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);};
    ctx.beginPath();
    switch(node.type){
     case "hline":line(X(node.x1??0),Y(node.y??0),X(node.x2??"100%"),Y(node.y??0));break;
     case "vline":line(X(node.x??0),Y(node.y1??0),X(node.x??0),Y(node.y2??"100%"));break;
     case "line":line(X(node.x1??0),Y(node.y1??0),X(node.x2??0),Y(node.y2??0));break;
     case "rect":{const x=X(node.x??0),y=Y(node.y??0),w=X(node.w??"100%"),h=Y(node.h??"100%"),r=Math.max(0,Z(node.rx??0));if(w<0||h<0)continue;if(r&&typeof ctx.roundRect==="function")ctx.roundRect(x,y,w,h,Math.min(r,w/2,h/2));else ctx.rect(x,y,w,h);break;}
     case "circle":case "dot":case "ellipse":{const x=X(node.cx??0),y=Y(node.cy??0);const rx=node.type==="ellipse"?X(node.rx):Z(node.r??.35),ry=node.type==="ellipse"?Y(node.ry):rx;if(!(rx>0&&ry>0))continue;ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(node.type==="dot"){ctx.fillStyle=fill??stroke??"transparent";ctx.fill();continue;}break;}
     case "polyline":case "polygon":{
      const pts=typeof node.points==="string"?node.points.trim().split(/\s+/).map(p=>p.split(",")):node.points;
      if(!Array.isArray(pts)||pts.length>10000)continue;let started=false;
      for(const p of pts){if(!Array.isArray(p)||p.length<2)continue;const x=X(p[0]),y=Y(p[1]);if(!Number.isFinite(x+y))continue;if(started)ctx.lineTo(x,y);else{ctx.moveTo(x,y);started=true;}}
      if(node.type==="polygon")ctx.closePath();break;
     }
     case "text":{
      const array=node.text;let text=typeof array==="string"?array:Array.isArray(array)&&array.length?String(array[((Math.floor(E(node.select??"i","unit",0))%array.length)+array.length)%array.length]):"";
      if(!text||text.length>10000)continue;
      text=text.replace(/\{([^{}]+)\}/g,(_m,expr:string)=>{const parts=expr.split(":");const num=E(parts[0],"unit",0);return /^0\d$/.test(parts[1]??"")?String(Math.round(num)).padStart(Number(parts[1].slice(1)),"0"):String(Math.round(num*1000)/1000);});
      const size=E(s.size,"short",3.5),font=s.font==="mono"?"monospace":s.font==="serif"?"serif":"sans-serif";
      ctx.font=`${s.italic?"italic ":""}${s.weight==="bold"?"bold ":""}${size}px ${font}`;
      ctx.textAlign=s.align==="middle"?"center":s.align==="end"?"right":"left";
      ctx.textBaseline=s.baseline==="middle"?"middle":s.baseline==="top"?"top":"alphabetic";
      ctx.translate(X(node.x??0),Y(node.y??0));ctx.rotate(Math.round(E(s.rotate,"unit",0)/90)*Math.PI/2);ctx.fillStyle=fill??stroke??"transparent";ctx.fillText(text,0,0);continue;
     }
     case "path":{
      if(typeof node.d!=="string"||node.d.length>100000)continue;
      const path=new Path2D(node.d);
      const vb=Array.isArray(node.viewBox)?node.viewBox.map(Number):typeof node.viewBox==="string"?node.viewBox.trim().split(/[ ,]+/).map(Number):null;
      if(vb&&vb.length===4&&vb.every(Number.isFinite)&&vb[2]>0&&vb[3]>0){
       const x=X(node.x??0),y=Y(node.y??0),w=X(node.w??"100%"),h=Y(node.h??"100%");
       let sx=w/vb[2],sy=h/vb[3];if(node.aspect!=="stretch"){sx=sy=Math.min(sx,sy);}
       ctx.translate(x+(w-vb[2]*sx)/2,y+(h-vb[3]*sy)/2);ctx.scale(sx,sy);ctx.translate(-vb[0],-vb[1]);
      }
      if(fill)ctx.fill(path);if(stroke)ctx.stroke(path);continue;
     }
     default:continue;
    }
    if(fill&&node.type!=="line"&&node.type!=="hline"&&node.type!=="vline"&&node.type!=="polyline")ctx.fill();
    if(stroke)ctx.stroke();
   }catch{/* malformed individual node: skip it without aborting the note */}finally{ctx.restore();}
  }
 }
 ctx.save();try{ctx.beginPath();ctx.rect(0,0,page.width,page.height);ctx.clip();ctx.scale(pxmm,pxmm);
 const rootOpacity=expression(template.opacity??1,box,"unit",params,1);
 draw(template.items,box,inherit(defaults,template),{i:0,j:0},0,Math.max(0,Math.min(1,rootOpacity)));
 }finally{ctx.restore();}
}
