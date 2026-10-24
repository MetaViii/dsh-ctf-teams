/** Serialize the actual built flag-panel React tree for native browser layout tests. */
import { writeFile } from 'node:fs/promises'
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const unitless=new Set(['flex','flexGrow','flexShrink','fontWeight','lineHeight','opacity','order','zIndex'])
function html(node) {
  if(node===null||node===undefined||typeof node==='boolean')return ''
  if(Array.isArray(node))return node.map(html).join('')
  if(typeof node==='string'||typeof node==='number')return escape(node)
  if(typeof node.type!=='string')throw Error('Fixture must contain the rendered production panel')
  const attrs=Object.entries(node.props).filter(([key,value])=>key!=='children'&&key!=='key'&&!key.startsWith('on')&&value!==undefined&&value!==false).map(([key,value])=>{
    if(key==='style')value=Object.entries(value).map(([name,v])=>name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+(typeof v==='number'&&v!==0&&!unitless.has(name)?v+'px':v)).join(';')
    if(key==='tabIndex')key='tabindex'
    return ' '+key+'="'+escape(value)+'"'
  }).join('')
  return '<'+node.type+attrs+'>'+html(node.props.children)+'</'+node.type+'>'
}
export async function writeDashboardLayoutFixture(file,panel,values) {
  const expected=JSON.stringify(values).replaceAll('<','\\u003c')
  await writeFile(file,`<!doctype html><meta charset="utf-8"><title>CTF Flag layout regression</title>
<style>*{box-sizing:border-box}body{margin:16px;font:13px Arial,sans-serif;background:#fff;color:#222}code{word-break:break-all;overflow-wrap:anywhere;white-space:normal}#host{min-width:0}#layout-result{white-space:pre-wrap;font:11px monospace}</style>
<div id="host">${html(panel)}</div><pre id="layout-result"></pre>
<script>
const host=document.getElementById('host'), expected=${expected}, cases=[];
const requested=new URLSearchParams(location.search).get('width');
for(const width of requested?[Number(requested)]:[160,240,320,640])for(const zoom of requested?[1]:[1,1.5]) {
  host.style.width=width+'px';host.style.zoom=String(zoom);
  const codes=[...host.querySelectorAll('code')].filter(el=>expected.includes(el.textContent));
  const bounds=host.getBoundingClientRect();
  const values=codes.map(el=>{
    const text=el.firstChild, first=document.createRange(), last=document.createRange();
    first.setStart(text,0);first.setEnd(text,1);last.setStart(text,text.length-1);last.setEnd(text,text.length);
    const firstBox=first.getBoundingClientRect(),lastBox=last.getBoundingClientRect(),box=el.getBoundingClientRect();
    const horizontal=Math.abs(firstBox.top-lastBox.top)<1;
    const contained=box.left>=bounds.left-1&&box.right<=bounds.right+1;
    const fullWidth=box.width>=bounds.width*0.75;
    const overflowing=el.scrollWidth>el.clientWidth+1;el.scrollLeft=el.scrollWidth;
    const scrollable=!overflowing||el.scrollLeft>0;el.scrollLeft=0;
    return {exact:expected.includes(el.textContent),horizontal,contained,fullWidth,overflowing,scrollable,keyboardFocusable:el.tabIndex===0};
  });
  cases.push({width,zoom,valueCount:values.length,values,passed:values.length===expected.length&&values.every(value=>value.exact&&value.horizontal&&value.contained&&value.fullWidth&&value.scrollable&&value.keyboardFocusable)});
}
document.getElementById('layout-result').textContent=JSON.stringify({passed:cases.every(row=>row.passed),browser:navigator.userAgent,cases});
if(requested)document.getElementById('layout-result').hidden=true;
</script>`)
}
