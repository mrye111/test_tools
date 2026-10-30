// ═══════════════════════════════════════════════════════════
// 图型片段 L4 · Ink Matrix 明度矩阵（重绘版 · 全出血）
// 数据契约：分类 × 分类 + 量（≤100 格）；典型为严重度 × 状态的缺陷计数。
// 形式依据：网格里的量 → 热力矩阵；量走灰阶明度（lieflat「明度即数据」），
//           不上彩虹色、不用色相编码密度。
// emphasis：唯一红圈标出「发版前必须清零」那格 —— 一支高亮，其余纯明度。
// 文字按单元明度取纸/墨（填充内唯一例外），其余一律墨色 token。
// 引擎：手写 SVG（零依赖，可离线）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{rows:[…], cols:[…], cells:[[…],…]}）。
(()=>{
const ROWS=__DATA__.rows,COLS=__DATA__.cols,M=__DATA__.cells;
const RAMP=['#EDECE6','#C6C5BF','#8F8E88','#4A4944','#1C1C1A'];
const rampOf=v=>({0:RAMP[0],1:RAMP[1],2:RAMP[2],3:RAMP[3],5:RAMP[4]})[v]??RAMP[4];
obsReveal('arcmatrix',s=>{
  const CW=186,CH=58,GAP=2,X0=190,Y0=70;
  COLS.forEach((c,j)=>{
    txt(s,{x:X0+j*(CW+GAP)+CW/2,y:Y0-18,'font-size':13,fill:MUTED,'text-anchor':'middle',
      'letter-spacing':'.12em',class:'fade',style:`animation-delay:${j*.04}s`},c);
  });
  ROWS.forEach((r,i)=>{
    const y=Y0+i*(CH+GAP);
    txt(s,{x:X0-24,y:y+CH/2,'font-size':15,'font-weight':600,fill:INK,'text-anchor':'end',
      'dominant-baseline':'middle',class:'fade',style:`animation-delay:${i*.05}s`},r);
    const rowSum=M[i].reduce((a,b)=>a+b,0);
    const rx=X0+COLS.length*(CW+GAP)+28;
    txt(s,{x:rx,y:y+CH/2-7,'font-size':20,'font-weight':700,fill:INK,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.4+i*.05}s`},rowSum);
    txt(s,{x:rx,y:y+CH/2+13,'font-size':10,fill:FAINT,'text-anchor':'middle','letter-spacing':'.12em',
      class:'fade',style:`animation-delay:${.4+i*.05}s`},'SUM');

    COLS.forEach((c,j)=>{
      const v=M[i][j],x=X0+j*(CW+GAP);
      const g=el(s,'g',{});
      el(g,'rect',{x,y,width:CW,height:CH,fill:rampOf(v),
        stroke:v===0?GRID:'none','stroke-width':1});
      // 文字按单元明度取纸/墨，绝不穿数据色
      txt(g,{x:x+CW/2,y:y+CH/2,'font-size':24,'font-weight':700,
        fill:v>=3?PAPER:INK,'text-anchor':'middle','dominant-baseline':'central',
        'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.2+(i*4+j)*.02}s`},v);
      tip(g,`${r} × ${c} — ${v} 个缺陷`);

      // emphasis：致命 × 激活 = 发版前必须清零的那格
      if(i===0&&j===0){
        el(s,'rect',{x:x-4,y:y-4,width:CW+8,height:CH+8,fill:'none',
          stroke:STATUS.crit,'stroke-width':2.5,rx:3,class:'fade',style:'animation-delay:.8s'});
        txt(s,{x:x+CW/2,y:y-14,'font-size':12,'font-weight':600,fill:STATUS.crit,
          'text-anchor':'middle','letter-spacing':'.12em',
          class:'fade',style:'animation-delay:.85s'},'发版前必须清零');
      }
    });
  });

  // 列合计
  const yBot=Y0+ROWS.length*(CH+GAP)+10;
  txt(s,{x:X0-24,y:yBot+18,'font-size':10,fill:FAINT,'text-anchor':'end','letter-spacing':'.12em',
    class:'fade'},'SUM');
  COLS.forEach((_,j)=>{
    const colSum=M.reduce((a,row)=>a+row[j],0);
    txt(s,{x:X0+j*(CW+GAP)+CW/2,y:yBot+22,'font-size':20,'font-weight':700,fill:INK,
      'text-anchor':'middle','font-variant-numeric':'tabular-nums',
      class:'fade',style:`animation-delay:${.5+j*.04}s`},colSum);
  });

  // 明度标尺：连续量必须配 scale legend
  let lx=0;
  txt(s,{x:0,y:yBot+62,'font-size':12,fill:MUTED,class:'fade',style:'animation-delay:.7s'},'少');
  lx=34;
  [0,1,2,3,5].forEach((v,k)=>{
    el(s,'rect',{x:lx+k*34,y:yBot+50,width:28,height:16,fill:rampOf(v),
      stroke:v===0?GRID:'none','stroke-width':1,class:'fade',style:`animation-delay:${.7+k*.04}s`});
    txt(s,{x:lx+k*34+14,y:yBot+80,'font-size':11,fill:MUTED,'text-anchor':'middle',
      'font-variant-numeric':'tabular-nums',class:'fade',style:`animation-delay:${.7+k*.04}s`},v);
  });
  txt(s,{x:lx+5*34+16,y:yBot+62,'font-size':12,fill:MUTED,class:'fade',style:'animation-delay:.9s'},
    '多（明度 = 缺陷数）');
});
})();
