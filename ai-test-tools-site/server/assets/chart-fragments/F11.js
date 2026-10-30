// ═══════════════════════════════════════════════════════════
// 图型片段 F11 · Meter Rails 进度轨（重绘版 · 全出血）
// 数据契约：单值进度 0–100%，1–6 条并排（各模块通过率 / 各质量门禁）；
//           每条带阈值刻度。viewBox 1080 宽，字号即最终渲染字号。
// 形式依据：单一比率对目标 → meter（不是饼图、不是单柱柱状图）。
// 色彩：fill 承载状态（STATUS 三色），track 用同色相浅步，让状态跨整条可读。
// 文字一律穿墨色 token，绝不穿数据色。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{rows:[[名称, 值0-100, 阈值, 状态键],…]}，1–6 行）。
(()=>{
const FILL={good:STATUS.good,warn:STATUS.warn,crit:STATUS.crit};
const TRACK={good:'rgba(11,122,11,.15)',warn:'rgba(201,133,0,.15)',crit:'rgba(192,57,43,.12)'};
const D=__DATA__.rows.map(([n,v,t,st])=>[n,v,t,FILL[st]?st:'crit']);
obsReveal('gauge',s=>{
  const X0=250,X1=930,W=X1-X0,BAR=20,ROW=62,Y0=34;
  D.forEach(([name,v,target,st],i)=>{
    const y=Y0+i*ROW;
    // 名称（左栏，墨色）
    txt(s,{x:X0-24,y:y+BAR/2,'font-size':15,'font-weight':600,fill:INK,
      'text-anchor':'end','dominant-baseline':'middle',class:'fade',style:`animation-delay:${i*.08}s`},name);
    // track（同色相浅步）+ fill（状态色）
    el(s,'rect',{x:X0,y,width:W,height:BAR,rx:BAR/2,fill:TRACK[st],
      class:'fade',style:`animation-delay:${i*.08}s`});
    const fw=W*v/100;
    const fill=el(s,'rect',{x:X0,y,width:fw,height:BAR,rx:BAR/2,fill:FILL[st],
      class:'fade',style:`animation-delay:${.15+i*.08}s`});
    tip(fill,`${name} — ${v}%（阈值 ${target}%）`);
    // 阈值刻度：虚线只留给阈值
    const tx=X0+W*target/100;
    el(s,'line',{x1:tx,y1:y-7,x2:tx,y2:y+BAR+7,stroke:MUTED,'stroke-width':1.5,
      'stroke-dasharray':'3 3',class:'fade',style:`animation-delay:${.35+i*.08}s`});
    // 数值（墨色，不穿数据色）
    const num=txt(s,{x:X1+26,y:y+BAR/2,'font-size':22,'font-weight':700,fill:INK,
      'dominant-baseline':'middle',class:'fade',style:`animation-delay:${.3+i*.08}s`},v+'%');
    tip(num,`${name} — 通过 ${v}%，距阈值 ${v-target>0?'+':''}${v-target} 个百分点`);
  });
  // 阈值刻度只在首条标注一次，避免每行重复
  txt(s,{x:X0+W*.95,y:Y0-14,'font-size':11,'font-weight':600,fill:MUTED,
    'text-anchor':'middle','letter-spacing':'.08em',class:'fade',style:'animation-delay:.5s'},'发版线 95%');
  // 单位说明（发丝线之下）
  el(s,'line',{x1:0,y1:Y0+D.length*ROW-14,x2:1080,y2:Y0+D.length*ROW-14,
    stroke:GRID,'stroke-width':1,class:'fade',style:'animation-delay:.6s'});
  txt(s,{x:0,y:Y0+D.length*ROW+8,'font-size':11,'font-weight':500,fill:FAINT,
    'letter-spacing':'.12em',class:'fade',style:'animation-delay:.7s'},
    '轨长 = 0–100% · 虚线 = 阈值 · 色相 = 达标状态（绿达标 / 琥珀逼近 / 红未达）');
});
})();
