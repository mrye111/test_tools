// ═══════════════════════════════════════════════════════════
// 图型片段 L12 · Type Colonnade 名录柱廊（重绘版 · 全出血）
// 数据契约：多对一归属 + 逐条名单（≤50 条）。viewBox 1080 宽。
// 形式依据：要「归属 + 逐条名单」→ 名录柱廊：左列逐条名录，右列归属中心，
//           发丝连线不丢明细。中心点面积 = 归属条数（sqrt 换算）。
// 色彩：连线与名录走灰阶明度；归属中心用墨色。文字一律穿墨色 token。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{items:[逐条名称,…], teams:[归属名,…], assign:[归属下标,…]}）。
(()=>{
const ITEMS=__DATA__.items,TEAM=__DATA__.teams,ASSIGN=__DATA__.assign;
obsReveal('colonnade',s=>{
  const N=ITEMS.length,LX=300,HX=790;
  const itemY=i=>34+i*(340/Math.max(1,N-1)),teamY=j=>52+j*36;
  const counts=Array(TEAM.length).fill(0);
  const owner=i=>ASSIGN[i];
  for(let i=0;i<N;i++)counts[owner(i)]++;
  for(let i=0;i<N;i++){
    const name=ITEMS[i];
    const yi=itemY(i),yj=teamY(owner(i));
    txt(s,{x:LX-16,y:yi+3,'font-size':11,fill:MUTED,'text-anchor':'end',
      class:'fade',style:`animation-delay:${i*.012}s`},name);
    el(s,'rect',{x:LX,y:yi-1,width:8,height:2,fill:'#B0AFA9',
      class:'fade',style:`animation-delay:${i*.012}s`});
    el(s,'path',{d:`M${LX+14} ${yi} C ${LX+230} ${yi} ${HX-230} ${yj} ${HX-18} ${yj}`,fill:'none',
      stroke:'#A8A7A0','stroke-width':1,opacity:.55,pathLength:1,
      class:'draw',style:`animation-delay:${.2+i*.015}s;animation-duration:.7s`});
  }
  TEAM.forEach((t,j)=>{
    const y=teamY(j),n=counts[j];
    // 中心点面积 = 归属条数
    el(s,'circle',{cx:HX,cy:y,r:5+Math.sqrt(n)*5,fill:n>=7?INK:n>=4?'#6A6963':'#B0AFA9',
      stroke:PAPER,'stroke-width':2,class:'pop',style:`animation-delay:${.6+j*.05}s`});
    txt(s,{x:HX+22+n*1.6,y:y-3,'font-size':15,'font-weight':600,fill:INK,
      class:'fade',style:`animation-delay:${.65+j*.05}s`},t);
    txt(s,{x:HX+22+n*1.6,y:y+16,'font-size':13,fill:MUTED,'font-variant-numeric':'tabular-nums',
      class:'fade',style:`animation-delay:${.7+j*.05}s`},n+' 条');
  });
  txt(s,{x:40,y:410,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:1s'},
    `左 = 逐条名录（共 ${N} 条）· 发丝 = 归属关系，不丢明细 · 右点面积 = 归属条数`);
});
})();
