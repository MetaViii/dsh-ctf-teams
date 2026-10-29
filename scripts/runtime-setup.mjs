#!/usr/bin/env node
/** Build the same shipped image outside a model turn, without changing a DSH profile. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DEFAULT_CTF_IMAGE } from '../lib/docker-runtime.js'
const action=process.argv[2]
if(action==='--help'||action==='help'||!action){
  console.log('Usage: dsh-ctf-teams-runtime build | check\nBuild uses the packaged Dockerfile and fixed default image. It never resumes teams or edits a DSH profile.')
  process.exit(0)
}
if(!['build','check'].includes(action)||process.argv.length!==3){console.error('Expected build or check; use --help');process.exit(2)}
const root=fileURLToPath(new URL('../assets/ctf',import.meta.url))
const argv=action==='build'?['build','--file',join(root,'runtime','Dockerfile'),'--tag',DEFAULT_CTF_IMAGE,root]:['image','inspect',DEFAULT_CTF_IMAGE,'--format','{{json .Id}} {{json .Config.Labels}}']
const child=spawn('docker',argv,{stdio:'inherit',windowsHide:true})
child.on('error',error=>{console.error('Docker unavailable: '+error.message);process.exitCode=1})
child.on('exit',code=>{process.exitCode=code??1})
