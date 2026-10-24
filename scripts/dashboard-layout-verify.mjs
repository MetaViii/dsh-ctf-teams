/** Native headless rendering only; isolated browser profile, no user sessions or network. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
const arg=name=>process.argv[process.argv.indexOf(name)+1]
if(!process.argv.includes('--fixture'))throw Error('--fixture <HTML produced by client-verify> is required')
const browser=process.argv.includes('--browser')?arg('--browser'):[process.env.CTF_LAYOUT_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>file&&existsSync(file))
if(!browser)throw Error('No native browser available; set CTF_LAYOUT_BROWSER explicitly. Layout remains unverified.')
const profile=mkdtempSync(join(tmpdir(),'ctf-flag-layout-'))
const fixture=resolve(arg('--fixture'))
const output=execFileSync(browser,['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--dump-dom',pathToFileURL(fixture).href],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']})
const match=output.match(/<pre id="layout-result">([\s\S]*?)<\/pre>/)
if(!match)throw Error('Browser did not produce layout measurements')
const decoded=match[1].replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&amp;','&')
const report=JSON.parse(decoded)
if(process.argv.includes('--report'))writeFileSync(resolve(arg('--report')),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,valuesChecked:report.cases.reduce((n,row)=>n+row.valueCount,0),failedCases:report.cases.filter(row=>!row.passed)}))
if(!report.passed)process.exit(1)
