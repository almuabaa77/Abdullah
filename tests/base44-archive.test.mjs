import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { captureArchive, splitCsv, tablesFrom, verifyArchive } from '../scripts/base44-archive.mjs'

const appId='6aad731df6fcd4e04d5f3c08'
test('packs original data and media, verifies hashes and reports missing coverage',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'halaqat-base44-'))
  try {
    const input=join(folder,'input'),root=join(folder,'backup')
    await mkdir(join(input,'tables'),{recursive:true})
    await mkdir(join(input,'files'))
    await writeFile(join(input,'openapi.json'),JSON.stringify({paths:{'/entities/LibraryItem':{get:{}},'/entities/Student':{get:{}},'/functions/pointsEngineSimulate':{post:{}}}}))
    await writeFile(join(input,'tables','LibraryItem.csv'),'id,title,url\r\nitem,"آيات, وأذكار",base44://document\r\n')
    await writeFile(join(input,'tables','User.json'),'[]')
    await writeFile(join(input,'assets.json'),JSON.stringify([{sourceUri:'base44://document',file:'document.pdf'},{sourceUri:'base44://missing',file:'missing'}]))
    await writeFile(join(input,'files','document.pdf'),'%PDF bytes kept intact')
    const manifest=await captureArchive(root,{appId,input})
    assert.equal(manifest.assets.missing,1)
    assert.equal(manifest.tables.find(table=>table.name==='Student').source,'missing')
    assert.deepEqual(manifest.functions,['pointsEngineSimulate'])
    assert.equal((await tablesFrom(root,await verifyArchive(root))).LibraryItem[0].title,'آيات, وأذكار')
    await assert.rejects(captureArchive(root,{appId,input}),/sealed/)
    await writeFile(join(root,'inputs','files','document.pdf'),'%different')
    await assert.rejects(verifyArchive(root),/missing, changed/)
  }finally{await rm(folder,{recursive:true,force:true})}
})

test('preserves BOM handling, quoted line breaks and leading zeros in CSV',()=>{
  assert.deepEqual(splitCsv('\uFEFFid,phone,note\r\nabc,0501234567,"first\nsecond ""quote"""\r\n'),[{id:'abc',phone:'0501234567',note:'first\nsecond "quote"'}])
  assert.throws(()=>splitCsv('id,id\n1,2'),/unique/)
  assert.throws(()=>splitCsv('one,two\n1,2,3'),/different number/)
})

test('resumes previously captured pages and checks source count with read-only requests',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'halaqat-base44-pages-'))
  try{
    const input=join(folder,'input'),root=join(folder,'backup')
    await mkdir(join(input,'tables'),{recursive:true})
    await writeFile(join(input,'openapi.json'),JSON.stringify({paths:{'/entities/Student':{get:{}}}}))
    await writeFile(join(input,'tables','User.json'),'[]')
    await mkdir(join(root,'api','Student'),{recursive:true,mode:0o700})
    await writeFile(join(root,'api','Student','00000001.json'),JSON.stringify({cursor:null,rows:[{id:'id-1'}],next:'cursor-2'}))
    const requests=[]
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      assert.equal(url.origin,'https://app.base44.com')
      assert.equal(options.redirect,'error')
      assert.equal(options.headers.Authorization,'Bearer read-only-fixture')
      assert.equal(options.method,undefined)
      if(!url.pathname.includes('/entities/'))return new Response(null,{status:403})
      if(url.pathname.endsWith('/trash'))return Response.json([])
      requests.push(url.pathname)
      if(url.pathname.endsWith('/count'))return Response.json({count:2})
      assert.equal(url.searchParams.get('cursor'),'cursor-2')
      return Response.json({items:[{id:'id-2'}],next_cursor:null,has_more:false})
    })
    const result=await captureArchive(root,{appId,input,token:'read-only-fixture'})
    assert.equal(requests.length,2)
    assert.equal(result.tables.find(table=>table.name==='Student').sourceCount,2)
    assert.equal((await tablesFrom(root,await verifyArchive(root))).Student.length,2)
  }finally{await rm(folder,{recursive:true,force:true})}
})

test('discovers the app without an uploaded spec and copies public library bytes without forwarding the token',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'halaqat-base44-api-'))
  try {
    const root=join(folder,'backup'),publicUrl='https://media.base44.com/files/public/'+appId+'/lesson.pdf'
    const requested=[]
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      requested.push(url.href)
      if(url.origin==='https://media.base44.com'){
        assert.equal(options.headers.Authorization,undefined)
        assert.equal(url.href,publicUrl)
        return new Response('archived file bytes',{headers:{'content-type':'application/pdf'}})
      }
      assert.equal(url.origin,'https://app.base44.com')
      assert.equal(options.headers.Authorization,'Bearer fixture-key')
      assert.equal(options.method,undefined)
      if(url.pathname.endsWith('/openapi-spec'))return Response.json({openapi:'3.0.3',paths:{'/entities/LibraryItem':{get:{}},'/functions/pointsEngineSimulate':{post:{}}}})
      if(url.pathname.endsWith('/entity-schemas'))return Response.json({schemas:[{entity_name:'LibraryItem',entity_schema:{type:'object'}}]})
      if(url.pathname.endsWith('/assets'))return Response.json([{id:'asset-id',file_url:publicUrl}])
      if(url.pathname.endsWith('/workflows'))return Response.json([{id:'old-workflow'}])
      if(url.pathname.endsWith('/workflows/old-workflow'))return Response.json({id:'old-workflow',definition:{}})
      if(url.pathname.endsWith('/coding/export-to-zip'))return new Response(Buffer.from('504b0506'+'00'.repeat(18),'hex'),{headers:{'content-type':'application/zip'}})
      if(url.pathname.endsWith('/entities/User'))return Response.json([])
      if(url.pathname.endsWith('/entities/LibraryItem/trash'))return Response.json([{id:'deleted-item',url:publicUrl}])
      if(url.pathname.includes('/entities/User/'))return url.pathname.endsWith('/count')?Response.json({count:0}):Response.json({items:[],has_more:false,next_cursor:null})
      if(url.pathname.endsWith('/count'))return Response.json({count:1})
      return Response.json({items:[{id:'item',url:publicUrl,file_uri:'private/unavailable.pdf'}],has_more:false,next_cursor:null})
    })
    const result=await captureArchive(root,{appId,token:'fixture-key'})
    assert.equal(result.hasOpenApi,true)
    assert.equal(result.assets.files,1)
    assert.equal(result.assets.unlisted,1)
    assert.equal(result.metadata.definitions,1)
    assert.equal(result.metadata.code,true)
    assert.equal(result.trash.records,1)
    assert.equal(result.trash.checked,1)
    assert.equal(requested.filter(url=>url===publicUrl).length,1)
    assert.ok((await verifyArchive(root)).files.some(file=>file.path.startsWith('files/')&&file.path.endsWith('.pdf')))
  } finally {await rm(folder,{recursive:true,force:true})}
})
