import { useEffect, useState } from 'react'
import { Archive, ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react'
import { dateLabel, Empty, useWorkspace } from './ui'

type ArchivePage={records:{id:string;data:unknown}[];page:number;size:number}

export function AdminLegacy() {
  const {data,t,en,readLegacy,tell}=useWorkspace()
  const archive=data.legacyArchive
  const [entity,setEntity]=useState(archive?.tables[0]?.entity??'')
  const [deleted,setDeleted]=useState(false)
  const [page,setPage]=useState(0)
  const [result,setResult]=useState<ArchivePage>()
  const [error,setError]=useState('')
  const [busy,setBusy]=useState('')
  const entry=archive?.tables.find(item=>item.entity===entity)
  const count=(deleted?entry?.deleted:entry?.active)??0
  useEffect(()=>{
    if(!archive||!entity)return
    const controller=new AbortController()
    setResult(undefined)
    setError('')
    const query=new URLSearchParams({entity,page:String(page),deleted:deleted?'1':'0'})
    void readLegacy(query,controller.signal).then(response=>response.json()).then(setResult).catch(error=>{
      if(!controller.signal.aborted)setError((error as Error).message)
    })
    return ()=>controller.abort()
  },[archive?.id,entity,deleted,page,readLegacy])
  if(!archive)return <Empty title={t('الأرشيف غير متاح حاليًا','No archive is available')}/>
  async function download(id:string,name:string) {
    if(busy)return
    setBusy(id)
    try {
      const response=await readLegacy(new URLSearchParams({file:id}))
      const url=URL.createObjectURL(await response.blob())
      const link=document.createElement('a')
      link.href=url;link.download=name
      link.click()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(error){tell((error as Error).message,true)}finally{setBusy('')}
  }
  return <div className="page-stack admin-legacy">
    <div className="panel section-panel">
      <h3>{t('نسخة Base44 التاريخية','Base44 historical archive')}</h3>
      <p>{dateLabel(archive.capturedAt.slice(0,10),en,true)} · {archive.tables.length} {t('جدولًا','tables')} · {archive.files.length} {t('ملفًا','files')}</p>
      <p>{archive.report.native} {t('سجلًا ضمن أقسام التطبيق','entries in platform sections')} · {archive.report.review} {t('حالة تحتاج مراجعة','entries for review')}</p>
    </div>
    <div className="admin-overview-filters">
      <label>{t('الجدول','Table')}<select value={entity} onChange={event=>{setEntity(event.target.value);setPage(0)}}>
        {archive.tables.map(item=><option key={item.entity} value={item.entity}>{item.entity} · {item.active}</option>)}
      </select></label>
      <label className="check-line"><input type="checkbox" checked={deleted} onChange={event=>{setDeleted(event.target.checked);setPage(0)}}/>{t('سلة المحذوفات','Deleted records')}</label>
    </div>
    {error?<p className="error-box" role="alert">{error}</p>:!result?<p role="status">{t('جارٍ قراءة الأرشيف…','Loading archive…')}</p>:!result.records.length?
      <Empty title={t('لا توجد سجلات في هذا العرض','No records in this view')}/>:<div className="admin-list">
        {result.records.map(record=><details key={record.id} className="admin-legacy-entry">
          <summary><FileText size={15}/><bdi>{record.id}</bdi></summary>
          <pre dir="ltr">{JSON.stringify(record.data,null,2)}</pre>
        </details>)}
        <div className="chip-row">
          <button className="btn btn-outline compact" disabled={page===0} type="button" onClick={()=>setPage(n=>n-1)}><ChevronRight size={15}/>{t('السابق','Previous')}</button>
          <span className="count-pill"><bdi>{page*result.size+1}–{Math.min(count,(page+1)*result.size)} / {count}</bdi></span>
          <button className="btn btn-outline compact" disabled={(page+1)*result.size>=count} type="button" onClick={()=>setPage(n=>n+1)}>{t('التالي','Next')}<ChevronLeft size={15}/></button>
        </div>
      </div>}
    {!!archive.files.length&&<details className="admin-legacy-entry">
      <summary><Archive size={16}/>{t('الملفات المحفوظة','Archived files')}</summary>
      <div className="admin-list">{archive.files.map(file=><button type="button" className="btn btn-outline compact" key={file.id} disabled={Boolean(busy)} onClick={()=>void download(file.id,file.name)}>
        <Download size={16}/><bdi>{file.name}</bdi>
      </button>)}</div>
    </details>}
  </div>
}
