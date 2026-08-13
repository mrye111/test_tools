// ═══════════════════════════════════════════════════════════
// 图型片段 G15 · Response times, spread out
// 数据契约：分组分布，逐条记录（几百点）；ECharts
// 引擎：ECharts（HTML 需引入 echarts@6 CDN）
// 来源：lieflat-charts（PolyForm Noncommercial 1.0.0），由 extract-chart-fragments.mjs 抽取
// 用法：参考实现——替换数据与元素 id，保留几何、编码方式与动效节奏；禁止脱离骨架另画
// ═══════════════════════════════════════════════════════════
// ════ mono-fancy3 · 4: jitter strip ════
(()=>{
const cats=['P0 CRITICAL','P1 HIGH','P2 NORMAL','P3 LOW'];
const mkPts=(ci,n,median,spread,outliers)=>{
  const pts=[];
  for(let i=0;i<n;i++){
    const u=rnd(i+1,ci+1), v=rnd(i+7,ci+3);
    let x=median+ (u-.5)*spread*2 + (v>.5?u*spread*.6:0);
    if(i<outliers) x=median+spread*2.2+u*spread*3;
    const jy=ci+ (rnd(i+13,ci+5)-.5)*.58;
    pts.push([Math.max(.2,x),jy]);
  }
  return pts;
};
const groups=[
  mkPts(0,38,.8,.5,2),
  mkPts(1,64,2.4,1.1,3),
  mkPts(2,110,6.5,2.4,4),
  mkPts(3,72,14,4.5,3),
];
const flat=groups.flat();
eReveal('jitter',{
  animationDuration:450,animationEasing:'cubicOut',
  animationDelay:i=>i<flat.length?Math.round(flat[i][1])*260+(i%37)*9:0,
  tooltip:{...tipLight,formatter:p=>cats[Math.round(p.value[1])]+' — '+p.value[0].toFixed(1)+'h to resolve'},
  grid:{left:86,right:16,top:14,bottom:30},
  xAxis:{type:'value',name:'HOURS TO RESOLVE',nameTextStyle:{color:'#C6C5BF',fontSize:8.5},
    splitLine:{lineStyle:{color:'#DEDDD6'}},
    axisLine:{show:false},axisTick:{show:false},
    axisLabel:{color:MUTED,fontFamily:'Inter',fontSize:9.5,formatter:v=>v+'h'}},
  yAxis:{type:'value',min:-.6,max:3.6,inverse:true,
    splitLine:{show:false},axisLine:{show:false},axisTick:{show:false},
    axisLabel:{show:false}},
  series:[{
    type:'scatter',
    data:flat,
    symbolSize:7,
    itemStyle:{color:p=>L[Math.round(p.value[1])],opacity:.62},
  },{
    type:'scatter',silent:true,symbolSize:0,
    data:cats.map((c,i)=>({value:[0,i],label:{show:true,position:'left',offset:[-6,0],
      color:'#6A6963',fontFamily:'Inter',fontSize:9,fontWeight:700,formatter:c}})),
  }],
});
})();
