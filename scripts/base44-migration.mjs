import { parseArgs } from 'node:util'
import { createReadStream } from 'node:fs'
import { link, open, readFile, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { createConnection } from 'mysql2/promise'
import { captureArchive, jsonText, privateDir, readJson, sha256, tablesFrom, verifyArchive, verifyPrivatePath, writeJson } from './base44-archive.mjs'

const options=Object.fromEntries(['app','input','archive','out','snapshot','mapping','approve'].map(name=>[name,{type:'string'}]))
options['keep-archived']={type:'boolean'}
options.draft={type:'boolean'}
const {positionals:[action,...rest],values}=parseArgs({options,allowPositionals:true})
const required=key=>values[key]||(()=>{throw new Error('Missing --'+key)})()
const workspace='school'
const outPath=async()=>{
  const path=await verifyPrivatePath(required('out'))
  await privateDir(path)
  return path
}

async function database(task){
  const value=process.env.MIGRATION_DATABASE_URL
  if(!value||new URL(value).protocol!=='mysql:')throw new Error('Supply MIGRATION_DATABASE_URL through a trusted environment variable.')
  const db=await createConnection(value)
  try {return await task(db)}finally{await db.end()}
}

async function current(db){
  const [rows]=await db.execute('SELECT revision,data FROM halaqat_workspaces WHERE id=?',[workspace])
  if(rows.length!==1||typeof rows[0].data!=='string')throw new Error('Target workspace not found.')
  const {revision,data}=rows[0]
  return {workspace,revision,sha256:sha256(data),data}
}
async function readSnapshot(path){
  const view=await readJson(path)
  if(view.workspace!==workspace||!Number.isSafeInteger(view.revision)||typeof view.data!=='string'||view.sha256!==sha256(view.data)){
    throw new Error('The workspace snapshot is invalid or has been modified.')
  }
  return view
}
const stateKeys=['users','students','circles','daily','notices','links','exams','operations']
const targetKeys=['circles','students','daily','links','exams']

async function mappingEngine(){
  const projectRoot=new URL('../',import.meta.url).pathname
  const output=await build({absWorkingDir:projectRoot,entryPoints:['server/base44-mapping.ts'],bundle:true,write:false,platform:'node',format:'esm',target:'node22'})
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))
}

async function inspect(root){
  const manifest=await verifyArchive(root)
  return {manifest,digest:sha256(await readFile(join(root,'manifest.json')))}
}

async function compareAndSwap(db,before,data){
  const [result]=await db.execute('UPDATE halaqat_workspaces SET revision=revision+1,data=? WHERE id=? AND revision=?',[data,workspace,before.revision])
  if(result.affectedRows!==1)throw new Error('The workspace changed concurrently. Review a fresh snapshot before continuing.')
}

async function execute(){
  if(rest.length)throw new Error('Unexpected positional argument.')
  if(action==='capture'){
    const root=await outPath()
    const results=await captureArchive(root,{appId:required('app'),input:values.input,token:process.env.BASE44_PERSONAL_ACCESS_TOKEN,draft:values.draft})
    console.log(JSON.stringify({sealed:!values.draft,tables:results.tables,assets:results.assets,functions:results.functions,metadata:results.metadata,trash:results.trash},null,2))
  }else if(action==='verify'){
    const {manifest,digest}=await inspect(await verifyPrivatePath(required('archive')))
    console.log(JSON.stringify({sha256:digest,tables:manifest.tables,assets:manifest.assets,metadata:manifest.metadata},null,2))
  }else if(action==='pack'){
    const archive=await verifyPrivatePath(required('archive')), output=await verifyPrivatePath(required('out'))
    const inner=relative(archive,output)
    if(!output.endsWith('.tar.gz')||!(inner==='..'||inner.startsWith('../')))throw new Error('Choose a .tar.gz file outside the archive directory.')
    await privateDir(dirname(output))
    await inspect(archive)
    const temp=output+'.'+randomUUID()+'.tmp'
    const fd=await open(temp,'wx',0o600)
    try {
      const run=spawnSync('tar',['--format=posix','-czf','-','-C',archive,'.'],{stdio:['ignore',fd.fd,'ignore']})
      if(run.status!==0)throw new Error('Could not package the verified archive. The tar command is required.')
      await fd.sync()
      await link(temp,output)
    }finally{await fd.close();await rm(temp,{force:true})}
    const hash=createHash('sha256')
    for await(const block of createReadStream(output))hash.update(block)
    console.log(JSON.stringify({file:output,sha256:hash.digest('hex')}))
  }else if(action==='snapshot'){
    const directory=await outPath()
    const before=await database(current)
    await writeJson(join(directory,'workspace.json'),{...before,capturedAt:new Date().toISOString()})
    console.log('Captured workspace at revision '+before.revision)
  }else if(action==='preview'){
    const archive=await verifyPrivatePath(required('archive'))
    const {manifest,digest}=await inspect(archive)
    const before=await readSnapshot(await verifyPrivatePath(required('snapshot')))
    const dir=await outPath()
    const {planBase44}=await mappingEngine()
    const state=JSON.parse(before.data)
    if(stateKeys.some(key=>!Array.isArray(state[key])))throw new Error('Unsupported workspace snapshot.')
    const rules=values.mapping?await readJson(resolve(values.mapping)):{}
    const result=planBase44(manifest.appId,await tablesFrom(archive,manifest),state,rules)
    const gates=[]
    if(!manifest.hasOpenApi)gates.push('source-inventory-missing')
    if(manifest.tables.some(table=>table.source==='missing'))gates.push('source-tables-missing')
    if(manifest.tables.some(table=>table.sourceCount!==undefined&&table.count!==table.sourceCount))gates.push('source-counts-require-review')
    if(!manifest.assets.inventory||manifest.assets.missing||manifest.assets.unlisted)gates.push('asset-inventory-or-files-missing')
    if(result.counts.conflict)gates.push('unresolved-record-conflicts')
    if(!result.counts.proposed)gates.push('no-records-proposed')
    const archivedFields=result.inventory.some(table=>table.fields.some(field=>!field.mapped&&field.key!=='id'))
    const plan={format:1,archive:digest,workspace,revision:before.revision,before:before.sha256,
      additions:result.additions,gates,archived:result.counts.archived,archivedFields,sourceFunctions:manifest.functions}
    const approval=sha256(jsonText(plan))
    const brief={appId:manifest.appId,revision:before.revision,approval,counts:result.counts,gates,archivedFields,
      tables:manifest.tables,assets:manifest.assets,functions:manifest.functions,metadata:manifest.metadata}
    await writeJson(join(dir,'report.json'),{...brief,inventory:result.inventory,decisions:result.decisions})
    await writeJson(join(dir,'plan.json'),plan)
    console.log(JSON.stringify(brief,null,2))
  }else if(action==='apply'||action==='rollback'){
    const dir=await outPath()
    const planFile=await readFile(join(dir,'plan.json'),'utf8')
    const digest=sha256(planFile)
    if(digest!==required('approve'))throw new Error('Provide the exact approved plan SHA-256.')
    const plan=JSON.parse(planFile)
    if(plan.format!==1||plan.workspace!==workspace||!Array.isArray(plan.gates)||plan.gates.length||targetKeys.some(key=>!Array.isArray(plan.additions?.[key]))){
      throw new Error('This plan cannot be applied because validation is incomplete.')
    }
    const before=await readSnapshot(await verifyPrivatePath(required('snapshot')))
    if(before.revision!==plan.revision||before.sha256!==plan.before)throw new Error('The snapshot does not match the approved plan.')
    const state=JSON.parse(before.data)
    const journalPath=join(dir,'receipt.json')
    const journal=await readJson(journalPath).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error))
    if(journal&&(journal.format!==1||journal.plan!==digest||journal.before!==before.sha256))throw new Error('Receipt does not match the approved plan.')
    if(action==='apply'){
      const {digest:archived}=await inspect(await verifyPrivatePath(required('archive')))
      if(archived!==plan.archive)throw new Error('The sealed source backup does not match the approved plan.')
      if((plan.archived||plan.archivedFields||plan.sourceFunctions.length)&&!values['keep-archived'])throw new Error('Acknowledge the archived records and functions with --keep-archived after reviewing the report.')
      const committedAt=journal?.committedAt??new Date().toISOString()
      for(const key of targetKeys)state[key].push(...plan.additions[key])
      state.audit.push({time:committedAt,actor:'ترحيل البيانات',action:'استيراد تاريخي من Base44',target:digest})
      const data=JSON.stringify(state),after=sha256(data)
      if(journal&&journal.after!==after)throw new Error('The stored receipt does not match the computed migration.')
      await database(async db=>{
        const live=await current(db)
        if(journal&&live.sha256===after&&live.revision===before.revision+1){console.log('This plan is already applied.');return}
        if(live.sha256!==before.sha256||live.revision!==before.revision)throw new Error('Current workspace differs from the preview. Use a fresh snapshot.')
        if(!journal)await writeJson(journalPath,{format:1,plan:digest,committedAt,before:before.sha256,after})
        await compareAndSwap(db,before,data)
        console.log('Applied migration at revision '+(before.revision+1))
      })
    }else{
      if(!journal)throw new Error('No application receipt exists.')
      await database(async db=>{
        const live=await current(db)
        if(live.sha256===before.sha256&&live.revision===before.revision+2){console.log('This plan is already rolled back.');return}
        if(live.sha256!==journal.after||live.revision!==before.revision+1)throw new Error('The workspace changed since migration. Automatic rollback would overwrite later changes.')
        await compareAndSwap(db,live,before.data)
        console.log('Rolled back migration at revision '+(live.revision+1))
      })
    }
  }else throw new Error('Commands: capture, verify, pack, snapshot, preview, apply, rollback')
}

try {await execute()}catch(error) {
  // The driver can include SQL and environment details in error messages.
  console.error(error?.code&&error.code!=='ENOENT'?'Migration stopped ('+error.code+').':error.message)
  process.exitCode=1
}
