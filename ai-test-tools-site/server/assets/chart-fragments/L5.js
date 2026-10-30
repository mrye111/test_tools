// ═══════════════════════════════════════════════════════════
// 图型片段 L5 · Radial Convergence 辐射汇聚（重绘版 · 全出血）
// 数据契约：多对一归属，不丢明细（≤60 条）。viewBox 1080 宽、580 高。
// 形式依据：多对一归属且**要保留逐条明细** → 辐射汇聚：外圈每条一根丝，
//           内圈汇到归属中心。这是 graph 形式，中心点面积 = 归属条数（sqrt 换算）。
// 色彩：丝与点走灰阶明度；中心（主角）用墨色。文字一律穿墨色 token。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{hubs:[[名称, 条数, 角度], …]}，≤5 个归属中心）。
(()=>{
const CX=540,CY=285,R=212;
const THEME=__DATA__.hubs;
const N=THEME.reduce((a,t)=>a+t[1],0);
obsReveal('converge',s=>{
  const blocks=THEME.flatMap(([,n],h)=>Array(n).fill(h));
  const hubOf=i=>rnd(i+1,11)>.92?(blocks[i]+2)%5:blocks[i];   // 少量自然溢出
  const hubPt=h=>pol(CX,CY,72,THEME[h][2]);
  const counts=[0,0,0,0,0];
  for(let i=0;i<N;i++)counts[hubOf(i)]++;
  for(let i=0;i<N;i++){
    const deg=i/N*360-90,[px,py]=pol(CX,CY,R,deg);
    const h=hubOf(i),[hx,hy]=hubPt(h);
    const c1x=CX+(px-CX)*.42,c1y=CY+(py-CY)*.42;
    const c2x=CX+(hx-CX)*.3,c2y=CY+(hy-CY)*.3;
    el(s,'path',{d:`M${px} ${py} C${c1x} ${c1y} ${c2x} ${c2y} ${hx} ${hy}`,
      fill:'none',stroke:'#A8A7A0','stroke-width':1,opacity:.55,pathLength:1,
      class:'draw',style:`animation-delay:${i*.018}s`});
    el(s,'circle',{cx:px,cy:py,r:3,fill:'#6A6963',stroke:PAPER,'stroke-width':2,
      class:'pop',style:`animation-delay:${i*.018}s`});
    // 外圈编号：左半翻转保证可读
    const flip=deg>90&&deg<270,[lx,ly]=pol(CX,CY,R+14,deg);
    txt(s,{x:lx,y:ly,'font-size':10,fill:MUTED,
      'text-anchor':flip?'end':'start','dominant-baseline':'middle',
      transform:`rotate(${flip?deg+180:deg} ${lx} ${ly})`,
      class:'fade',style:`animation-delay:${.2+i*.01}s`},'#'+String(i+1).padStart(2,'0'));
  }
  THEME.forEach(([name,,deg],h)=>{
    const [hx,hy]=hubPt(h);
    // 中心点面积 = 归属条数（sqrt 换算半径，数值与视觉严格成正比）
    const hub=el(s,'circle',{cx:hx,cy:hy,r:6+Math.sqrt(counts[h])*7,fill:INK,
      stroke:PAPER,'stroke-width':2,class:'pop',style:`animation-delay:${.5+h*.08}s`});
    tip(hub,`${name} — ${counts[h]} 个缺陷`);
    // 标签外置，与中心用发丝虚线牵连
    const [tx,ty]=pol(CX,CY,R+52,deg);
    txt(s,{x:tx,y:ty-6,'font-size':16,'font-weight':700,fill:INK,'text-anchor':'middle',
      'dominant-baseline':'middle',
      class:'fade',style:`animation-delay:${.6+h*.08}s`},name);
    txt(s,{x:tx,y:ty+16,'font-size':14,fill:MUTED,'text-anchor':'middle',
      'dominant-baseline':'middle','font-variant-numeric':'tabular-nums',
      class:'fade',style:`animation-delay:${.65+h*.08}s`},counts[h]+' 个');
    const [gx,gy]=pol(CX,CY,R+30,deg);
    el(s,'line',{x1:hx,y1:hy,x2:gx,y2:gy,stroke:FAINT,'stroke-width':1,
      'stroke-dasharray':'2 4',class:'fade',style:`animation-delay:${.7+h*.08}s`});
  });
  txt(s,{x:40,y:566,'font-size':11,'font-weight':500,fill:FAINT,'letter-spacing':'.12em',
    class:'fade',style:'animation-delay:1.1s'},
    `外圈 1 点 = 1 个缺陷（共 ${N} 条，逐条可点）· 中心点面积 = 归属条数 · 编号即明细 ID`);
});
})();
