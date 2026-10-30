// ═══════════════════════════════════════════════════════════
// 图型片段 G15 · Jitter Strip 抖动条带（重绘版 · 全出血）
// 数据契约：分组分布，逐条记录（几百点）；ECharts。容器是 <div class="ch">，不是 svg。
// 形式依据：分组分布且逐条记录 → 抖动条带。降级理由：F8 散点容量 ≤20 点不足。
//           同一组内横轴是同一量纲（解决时长），共用一根横轴 —— 绝不双轴。
// 色彩：点的明度 = 分组序（灰阶明度阶梯 L），不上色相。文字一律穿墨色 token。
// 引擎：ECharts（HTML 需引入 echarts@6 CDN）
// ═══════════════════════════════════════════════════════════
// 数据槽位：__DATA__ 由服务端注入 JSON（{cats:[分组名,…], groups:[[[x,y],…],…]}）。
(()=>{
const cats=__DATA__.cats,groups=__DATA__.groups;
const flat=groups.flat();
eReveal('jitter',{
  animationDuration:450,animationEasing:'cubicOut',
  animationDelay:i=>i<flat.length?Math.round(flat[i][1])*260+(i%37)*9:0,
  tooltip:{...tipLight,textStyle:{...tipLight.textStyle,fontSize:13},
    formatter:p=>cats[Math.round(p.value[1])]+' — 解决耗时 '+p.value[0].toFixed(1)+' 小时'},
  grid:{left:130,right:40,top:24,bottom:56},
  xAxis:{type:'value',name:'解决耗时（小时）',
    nameTextStyle:{color:FAINT,fontSize:12,fontFamily:FONT.mono},
    nameGap:16,nameLocation:'middle',
    splitLine:{lineStyle:{color:GRID,width:1}},
    axisLine:{show:false},axisTick:{show:false},
    axisLabel:{color:MUTED,fontFamily:FONT.text,fontSize:12,
      fontVariantNumeric:'tabular-nums',formatter:v=>v+' 小时'}},
  yAxis:{type:'value',min:-.6,max:3.6,inverse:true,
    splitLine:{show:false},axisLine:{show:false},axisTick:{show:false},
    axisLabel:{show:false}},
  series:[{
    type:'scatter',
    data:flat,
    symbolSize:9,
    itemStyle:{color:p=>L[Math.round(p.value[1])],opacity:.62},
  },{
    // 分组名左置：无声系列只承载标签，不是数据
    type:'scatter',silent:true,symbolSize:0,
    data:cats.map((c,i)=>({value:[0,i],label:{show:true,position:'left',offset:[-10,0],
      color:'#4A4944',fontFamily:FONT.text,fontSize:14,fontWeight:600,formatter:c}})),
  }],
});
})();
