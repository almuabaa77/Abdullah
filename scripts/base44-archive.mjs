import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, copyFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const repo=fileURLToPath(new URL('../',import.meta.url))
const entityPattern=/^[A-Za-z][A-Za-z0-9_]{0,80}$/
export const sha256=value=>createHash('sha256').update(value).digest('hex')
export const jsonText=value=>JSON.stringify(value,null,2)+'\n'
export const readJson=async path=>JSON.parse(await readFile(path,'utf8'))

export async function verifyPrivatePath(path) {
  const dir=resolve(path)
  let parent=dir
  while(!(await lstat(parent).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error))))parent=dirname(parent)
  const actual=resolve(await realpath(parent),relative(parent,dir))
  if(actual+sep===repo||actual.startsWith(repo))throw new Error('Use a private location outside the project checkout.')
  if(actual!==dir)throw new Error('Symbolic links are not allowed in archive locations.')
  return dir
}

export async function privateDir(path) {
  await mkdir(path,{recursive:true,mode:0o700})
  const details=await lstat(path)
  if(!details.isDirectory()||details.isSymbolicLink()||details.mode&0o077)throw new Error('Archive directories must be private (chmod 700).')
}

export async function writeJson(path,value,{overwrite=false}={}) {
  const temp=path+'.'+randomUUID()+'.tmp'
  const fd=await open(temp,'wx',0o600)
  try {
    await fd.writeFile(jsonText(value));await fd.sync();await fd.close()
    if(overwrite)await rename(temp,path)
    else await link(temp,path)
  } finally {
    await fd.close()
    await rm(temp,{force:true})
  }
}

async function hashFile(path) {
  const hash=createHash('sha256')
  for await(const buffer of createReadStream(path))hash.update(buffer)
  return hash.digest('hex')
}

async function filesUnder(root,sub='') {
  const base=join(root,sub), result=[]
  for(const file of (await readdir(base,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(file.isSymbolicLink())throw new Error('Archive input contains a symbolic link.')
    const path=join(sub,file.name)
    if(file.isDirectory())result.push(...await filesUnder(root,path))
    else if(file.isFile())result.push(path)
    else throw new Error('Archive input must contain ordinary files only.')
  }
  return result
}

function within(parent,child) {
  const rel=relative(parent,child)
  return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..')
}

async function copyInput(source,destination) {
  const sourceRoot=await realpath(source)
  if(within(sourceRoot,destination)||within(destination,sourceRoot))throw new Error('Source inputs and backup must be in separate directories.')
  for(const entry of await filesUnder(sourceRoot)){
    if(entry.split(sep).some(name=>name==='.git'||name.startsWith('.env')))throw new Error('Move secret and repository metadata files out of the migration input.')
    const target=join(destination,entry),from=join(sourceRoot,entry)
    await privateDir(dirname(target))
    const existing=await lstat(target).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error))
    if(existing&&(!existing.isFile()||existing.isSymbolicLink()))throw new Error('Archive input must contain ordinary files only.')
    if(!existing||await hashFile(target)!==await hashFile(from)){
      if(existing&&entry!=='assets.json')throw new Error('Inputs changed. Capture them into a new backup directory.')
      const temp=target+'.'+randomUUID()+'.tmp'
      try {await copyFile(from,temp);const fd=await open(temp,'r+');try{await fd.chmod(0o600);await fd.sync()}finally{await fd.close()}
        if(existing)await rename(temp,target)
        else await link(temp,target)
      }finally{await rm(temp,{force:true})}
    }
  }
}

export function splitCsv(input) {
  const source=input.replace(/^\uFEFF/,'')
  const rows=[]
  let row=[],field='',quoted=false,closed=false
  const writeField=()=>{row.push(field);field='';closed=false}
  const writeRow=()=>{writeField();rows.push(row);row=[]}
  for(let i=0;i<source.length;i++){
    const ch=source[i]
    if(quoted){
      if(ch==='"'){
        if(source[i+1]==='"'){field+='"';i++}
        else {quoted=false;closed=true}
      }else field+=ch
    }else if(ch===',')writeField()
    else if(ch==='\r'||ch==='\n'){writeRow();if(ch==='\r'&&source[i+1]==='\n')i++}
    else if(ch==='"'&&!closed&&!field)quoted=true
    else {
      if(closed||ch==='"')throw new Error('Invalid CSV quoting.')
      field+=ch
    }
  }
  if(quoted)throw new Error('Invalid CSV quoting.')
  if(field||row.length||closed)writeRow()
  const names=rows.shift()??[]
  if(!names.length||names.some(name=>!name)||new Set(names).size!==names.length)throw new Error('CSV header fields must be present and unique.')
  return rows.map(row=>{
    if(row.length!==names.length)throw new Error('CSV row has a different number of fields than its header.')
    return Object.fromEntries(names.map((name,i)=>[name,row[i]]))
  })
}

const recordsFrom=value=>{
  if(!Array.isArray(value)||value.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('Expected a list of table records.')
  return value
}

function inventory(spec) {
  const tables=new Set(),functions=new Set()
  for(const [path,methods] of Object.entries(spec?.paths??{})){
    const entity=path.match(/\/entities\/([A-Za-z][A-Za-z0-9_]{0,80})\/?$/)
    const fn=path.match(/\/functions\/([^/{}]+)\/?$/)
    if(entity&&methods?.get)tables.add(entity[1])
    if(fn)functions.add(fn[1])
  }
  return {tables:[...tables].sort(),functions:[...functions].sort()}
}

async function getResponse(url,token,accept='application/json') {
  for(let attempt=0;attempt<4;attempt++){
    let response
    const headers=token?{Authorization:'Bearer '+token,Accept:accept}:{Accept:accept}
    try {response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(120_000)})}
    catch {if(attempt===3)throw new Error('Connection to the Base44 API failed. Re-run capture to resume.')}
    if(response?.ok)return response
    await response?.body?.cancel()
    if(response&&response.status!==429&&response.status<500)throw new Error('Base44 returned HTTP '+response.status)
    if(attempt===3)throw new Error('Base44 returned HTTP '+response?.status+'. Re-run capture to resume.')
    const requested=response?.headers.get('Retry-After')
    await delay(Math.min(30_000,Math.max(1000*2**attempt,(Number(requested)||0)*1000)))
  }
}

const getJson=async(url,token)=>(await getResponse(url,token)).json()
const unavailable=error=>/HTTP (403|404|405|409|410|413)$/.test(error.message)
const optionalJson=path=>readJson(path).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error))
const optionalFile=path=>lstat(path).then(file=>file.isFile()).catch(error=>error.code==='ENOENT'?false:Promise.reject(error))
const apiUrl=(appId,route)=>new URL('https://app.base44.com/api/apps/'+appId+'/'+route)

async function cachedJson(path,url,token){
  const existing=await optionalJson(path)
  if(existing!==undefined||!token)return existing
  try{
    const result=await getJson(url,token)
    await writeJson(path,result)
    return result
  }catch(error){if(!unavailable(error))throw error}
}

async function saveDownload(path,url,{token,zip=false}={}){
  if(await lstat(path).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error)))return true
  const temp=path+'.'+randomUUID()+'.tmp'
  try{
    const response=await getResponse(url,token,zip?'application/zip':'*/*')
    const type=response.headers.get('content-type')?.split(';')[0]
    if(!response.body||type==='text/html'||zip&&!['application/zip','application/x-zip-compressed','application/octet-stream'].includes(type)){
      await response.body?.cancel()
      return false
    }
    let bytes=0
    const maximum=512*1024*1024
    const sizeLimit=new Transform({transform(chunk,encoding,callback){
      bytes+=chunk.length
      if(bytes>maximum)callback(new Error('Attachment exceeds the automatic download limit.'))
      else callback(null,chunk)
    }})
    await pipeline(Readable.fromWeb(response.body),sizeLimit,createWriteStream(temp,{mode:0o600,flags:'wx'}))
    if(!bytes)return false
    if(zip){
      const fd=await open(temp,'r')
      try{
        const prefix=Buffer.alloc(4)
        await fd.read(prefix,0,4,0)
        if(!['504b0304','504b0506'].includes(prefix.toString('hex')))return false
      }finally{await fd.close()}
    }
    await link(temp,path)
    return true
  }catch(error){
    if(unavailable(error)||(!token&&!error.code))return false
    throw error
  }finally{await rm(temp,{force:true})}
}

async function captureMetadata(root,appId,token){
  const dir=join(root,'metadata')
  await privateDir(dir)
  const [spec,schemas,library]=await Promise.all([
    cachedJson(join(dir,'openapi.json'),apiUrl(appId,'openapi-spec'),token),
    cachedJson(join(dir,'schemas.json'),apiUrl(appId,'entity-schemas'),token),
    cachedJson(join(dir,'assets.json'),apiUrl(appId,'assets'),token),
  ])
  let libraryCapped=library?.length===500
  const assets=Array.isArray(library)?[...library]:[]
  if(libraryCapped){
    const groups=await Promise.all(['upload','generated'].map(kind=>{
      const url=apiUrl(appId,'assets')
      url.searchParams.set('source_type',kind)
      return cachedJson(join(dir,'assets-'+kind+'.json'),url,token)
    }))
    for(const group of groups)if(Array.isArray(group))assets.push(...group)
    libraryCapped=groups.some(group=>!Array.isArray(group)||group.length>=500)
  }
  const workflows=[]
  let workflowCatalog=false
  for(let offset=0;offset<100_000;offset+=200){
    const url=apiUrl(appId,'workflows')
    url.searchParams.set('include_archived','true')
    url.searchParams.set('limit','200')
    url.searchParams.set('offset',String(offset))
    const page=await cachedJson(join(dir,'workflows-'+offset+'.json'),url,token)
    if(!Array.isArray(page))break
    workflows.push(...page)
    if(page.length<200){workflowCatalog=true;break}
  }
  let definitions=0
  const ids=new Set(workflows.map(workflow=>workflow?.id).filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)))
  for(const id of ids){
    const definition=await cachedJson(join(dir,'workflow-'+id+'.json'),apiUrl(appId,'workflows/'+id),token)
    if(definition)definitions++
  }
  const zip=join(dir,'source.zip')
  const code=token?await saveDownload(zip,apiUrl(appId,'coding/export-to-zip'),{token,zip:true}):
    Boolean(await lstat(zip).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error)))
  return {spec,schemas,assets,summary:{assetCatalog:Array.isArray(library),libraryCapped,workflows:workflows.length,workflowCatalog,definitions,code}}
}

function mediaUrl(value,appId){
  try {
    const url=new URL(value,'https://media.base44.com')
    if(url.origin!=='https://media.base44.com'||url.username||url.password||
      !url.pathname.startsWith('/files/public/'+appId+'/'))return
    url.hash=''
    return url
  }catch{}
}

async function captureTable(root,appId,name,token) {
  const dir=join(root,'api',name)
  await privateDir(dir)
  const ids=new Set(),cursors=new Set()
  let page=0,cursor=null
  while(true){
    const path=join(dir,String(++page).padStart(8,'0')+'.json')
    let entry=await readJson(path).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error))
    if(!entry){
      if(!token)return {issue:'Capture of this table needs source access'}
      const url=new URL('https://app.base44.com/api/apps/'+appId+'/entities/'+encodeURIComponent(name)+'/v2/list')
      url.searchParams.set('sort','id');url.searchParams.set('limit','500')
      if(cursor)url.searchParams.set('cursor',cursor)
      const response=await getJson(url,token)
      if(response.has_more!==(typeof response.next_cursor==='string'&&Boolean(response.next_cursor)))throw new Error('Invalid pagination response in '+name+'.')
      entry={cursor,rows:recordsFrom(response.items),next:response.next_cursor??null}
      await writeJson(path,entry)
    }
    if(entry.cursor!==cursor||entry.next!==null&&(typeof entry.next!=='string'||!entry.next||cursors.has(entry.next)))throw new Error('Pagination changed or repeated in '+name+'.')
    for(const row of recordsFrom(entry.rows)){
      if(typeof row.id!=='string'||!row.id||ids.has(row.id))throw new Error('Missing or duplicate record ID in '+name+'.')
      ids.add(row.id)
    }
    if(!entry.next){
      const countFile=join(dir,'count.json')
      let count=(await readJson(countFile).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error)))?.count
      if(token){
        try {count=(await getJson(new URL('https://app.base44.com/api/apps/'+appId+'/entities/'+encodeURIComponent(name)+'/count'),token)).count}
        catch(error){if(!/HTTP (403|404|405)$/.test(error.message))throw error}
      }
      if(count!==undefined){
        if(!Number.isSafeInteger(count)||count<0||count!==ids.size&&name!=='User')throw new Error('Source count changed or the capture is incomplete for '+name+'.')
        await writeJson(countFile,{count},{overwrite:true})
      }
      return {pages:page,count:ids.size,sourceCount:count}
    }
    cursors.add(entry.next)
    cursor=entry.next
  }
}

export async function tablesFrom(root,manifest) {
  const tables={}
  for(const entry of manifest.tables){
    const name=entry.name
    if(!entityPattern.test(name))throw new Error('Invalid entity name.')
    if(entry.source==='api'){
      const rows=[]
      for(let index=1;index<=entry.pages;index++)rows.push(...recordsFrom((await readJson(join(root,'api',name,String(index).padStart(8,'0')+'.json'))).rows))
      tables[name]=rows
    }else if(entry.source==='json'||entry.source==='csv'){
      const path=join(root,'inputs','tables',name+'.'+entry.source)
      tables[name]=entry.source==='json'?recordsFrom(await readJson(path)):splitCsv(await readFile(path,'utf8'))
    }
    if(tables[name]&&tables[name].length!==entry.count)throw new Error('Table record count changed.')
  }
  return tables
}

export function attachmentCandidates(tables) {
  const references=new Map()
  function collect(value,table,field=''){
    if(Array.isArray(value)){for(const item of value)collect(item,table,field);return}
    if(value&&typeof value==='object'){for(const [key,item] of Object.entries(value))collect(item,table,key);return}
    if(typeof value!=='string')return
    if(/^[\[{]/.test(value)){
      try{collect(JSON.parse(value),table,field);return}catch{}
    }
    const assetField=/(?:attachment|file|media|image|photo|avatar|audio|video|document|picture|thumbnail)/i.test(field)
    const assetUri=/^(?:base44|storage|file):\/\//i.test(value)||/^\/files\/(?:public|private)\//i.test(value)||
      /^https:\/\/[^/]*base44[^/]*\/(?:api\/)?(?:files|storage)\//i.test(value)
    const looksLikeFile=/^https?:\/\/[^\s]+\.(?:png|jpe?g|webp|svg|gif|pdf|docx?|xlsx?|mp3|ogg|m4a|mp4|webm|wav|zip)(?:[?#].*)?$/i.test(value)
    if(!assetUri&&!looksLikeFile&&!(assetField&&/^(?:https?:\/\/|private\/|public\/)[^\s]+$/i.test(value)))return
    const entry=references.get(value)??new Set()
    entry.add(table+'.'+field)
    references.set(value,entry)
  }
  for(const [name,rows] of Object.entries(tables))for(const row of rows)collect(row,name)
  return [...references].map(([sourceUri,fields])=>({sourceUri,fields:[...fields].sort()}))
}

export async function captureArchive(root,{appId,input,token,draft=false}) {
  if(!/^[a-f0-9]{24}$/i.test(appId))throw new Error('Provide the Base44 app ID.')
  await privateDir(root)
  const manifestFile=join(root,'manifest.json')
  if(await lstat(manifestFile).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error)))throw new Error('This backup is sealed. Use a new directory for a new capture.')
  const setup=join(root,'capture.json')
  const capture=await readJson(setup).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error))
  if(capture&&capture.appId!==appId)throw new Error('This directory belongs to a different Base44 app.')
  if(!capture)await writeJson(setup,{appId,startedAt:new Date().toISOString()})
  if(input)await copyInput(input,join(root,'inputs'))
  const supplied=await optionalJson(join(root,'inputs','openapi.json'))
  const metadata=(token||await lstat(join(root,'metadata')).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error)))?
    await captureMetadata(root,appId,token):undefined
  const suppliedInventory=inventory(supplied),apiInventory=inventory(metadata?.spec)
  const schemaNames=(metadata?.schemas?.schemas??[]).map(schema=>schema.entity_name).filter(name=>typeof name==='string'&&entityPattern.test(name))
  const expected={tables:[...new Set([...suppliedInventory.tables,...apiInventory.tables,...schemaNames])],
    functions:[...new Set([...suppliedInventory.functions,...apiInventory.functions])].sort()}
  const exports=await readdir(join(root,'inputs','tables')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error))
  const sources=new Map()
  for(const name of exports){
    const match=name.match(/^([A-Za-z][A-Za-z0-9_]{0,80})\.(json|csv)$/)
    if(match&&(match[2]==='json'||!sources.has(match[1])))sources.set(match[1],match[2])
  }
  const names=[...new Set([...expected.tables,...sources.keys(),'User'])].sort()
  if(!expected.tables.length&&!sources.size)throw new Error('Provide an OpenAPI JSON file or JSON/CSV table exports.')
  const tables=[]
  for(const name of names){
    const source=sources.get(name)
    if(source){
      const path=join(root,'inputs','tables',name+'.'+source)
      const count=(source==='json'?recordsFrom(await readJson(path)):splitCsv(await readFile(path,'utf8'))).length
      tables.push({name,source,count})
    }else if(token||await lstat(join(root,'api',name)).catch(error=>error.code==='ENOENT'?undefined:Promise.reject(error))){
      try {
        const captured=await captureTable(root,appId,name,token)
        tables.push({name,source:captured.issue?'missing':'api',...captured})
      }
      catch(error){
        if(/HTTP (403|404)$/.test(error.message))tables.push({name,source:'missing',issue:error.message})
        else throw error
      }
    }else tables.push({name,source:'missing',issue:'No table export or source connection'})
  }
  const assetRecords=await readJson(join(root,'inputs','assets.json')).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))
  if(assetRecords!==null&&!Array.isArray(assetRecords))throw new Error('assets.json must be a list of sourceUri/file pairs.')
  const availableAssets=new Set(await filesUnder(join(root,'inputs','files')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error)))
  let missingAssets=0
  const inventoried=new Set()
  for(const item of assetRecords??[]){
    if(typeof item?.sourceUri!=='string'||!item.sourceUri||inventoried.has(item.sourceUri))throw new Error('Asset references must be present and unique.')
    if(item.external===true){
      const uri=new URL(item.sourceUri)
      if(uri.protocol!=='https:'||/(?:^|\.)base44\.[a-z]+$/i.test(uri.hostname)||uri.username||uri.password)throw new Error('A Base44 asset cannot be inventoried as a durable external link.')
    }else if(typeof item.file!=='string'||!availableAssets.has(item.file))missingAssets++
    inventoried.add(item.sourceUri)
  }
  const candidates=attachmentCandidates(await tablesFrom(root,{tables}))
  const libraryUris=new Set()
  let uncataloguedLibraryFiles=0
  for(const asset of metadata?.assets??[]){
    const sourceUri=asset?.file_url
    if(typeof sourceUri!=='string'||!sourceUri){uncataloguedLibraryFiles++;continue}
    if(libraryUris.has(sourceUri))continue
    libraryUris.add(sourceUri)
  }
  const indexed=new Map(candidates.map(item=>[item.sourceUri,item]))
  for(const sourceUri of libraryUris)if(!indexed.has(sourceUri))indexed.set(sourceUri,{sourceUri,fields:['Base44 media library']})
  const downloads=[]
  const path=join(root,'files')
  if(token||indexed.size){
    await privateDir(path)
    for(const sourceUri of indexed.keys()){
      if(inventoried.has(sourceUri))continue
      const url=mediaUrl(sourceUri,appId)
      if(!url)continue
      const extension=url.pathname.match(/\.[a-z0-9]{1,10}$/i)?.[0].toLowerCase()??'.bin'
      const file=sha256(url.href)+extension
      if(token?await saveDownload(join(path,file),url):await optionalFile(join(path,file))){
        inventoried.add(sourceUri)
        downloads.push({sourceUri,file:'files/'+file})
      }
    }
  }
  const unlisted=[...indexed.values()].filter(item=>!inventoried.has(item.sourceUri))
  await writeJson(join(root,'asset-references.json'),{candidates,downloaded:downloads,unlisted},{overwrite:true})
  const listing=[]
  for(const path of await filesUnder(root)){
    if(path.endsWith('.tmp'))throw new Error('An interrupted temporary file remains. Move it to a private location before sealing.')
    const full=join(root,path)
    listing.push({path,size:(await stat(full)).size,sha256:await hashFile(full)})
  }
  const manifest={format:1,appId,capturedAt:new Date().toISOString(),hasOpenApi:Boolean(supplied??metadata?.spec),tables,functions:expected.functions,
    metadata:metadata?.summary,assets:{
      inventory:Boolean(assetRecords)||Boolean(metadata?.summary.assetCatalog&&!metadata.summary.libraryCapped),
      listed:(assetRecords?.length??0)+downloads.length,missing:missingAssets+uncataloguedLibraryFiles,
      unlisted:unlisted.length,files:availableAssets.size+new Set(downloads.map(item=>item.file)).size
    },files:listing}
  if(!draft)await writeJson(manifestFile,manifest)
  return manifest
}

export async function verifyArchive(root) {
  const manifest=await readJson(join(root,'manifest.json'))
  if(manifest.format!==1||!Array.isArray(manifest.files))throw new Error('Unsupported archive version.')
  const actual=(await filesUnder(root)).filter(path=>path!=='manifest.json')
  const expected=new Map(manifest.files.map(entry=>[entry.path,entry]))
  if(actual.length!==manifest.files.length||expected.size!==actual.length)throw new Error('Archive file counts do not match.')
  for(const path of actual){
    const full=join(root,path),entry=expected.get(path)
    if(!entry||(await stat(full)).size!==entry.size||await hashFile(full)!==entry.sha256)throw new Error('An archive file is missing, changed, or not listed.')
  }
  return manifest
}
