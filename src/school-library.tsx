import { useState } from 'react'
import { BookOpen, Download } from 'lucide-react'
import { Empty, useWorkspace } from './ui'

export function SchoolLibrary(){
  const {data,t,readLegacy,tell}=useWorkspace()
  const [busy,setBusy]=useState('')
  async function download(id:string){
    if(busy)return
    setBusy(id)
    try {
      const response=await readLegacy(new URLSearchParams({id}))
      const link=document.createElement('a')
      const url=URL.createObjectURL(await response.blob())
      link.href=url
      const filename=/filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition')??'')?.[1]
      link.download=filename?decodeURIComponent(filename):'material'
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(error){tell((error as Error).message,true)}finally{setBusy('')}
  }
  return <section className="page-stack school-library">
    <header className="panel section-panel"><div className="section-title"><BookOpen size={22}/><h1>{t('المكتبة','Library')}</h1></div></header>
    <div className="summary-grid">
      {!data.materials?.length&&<Empty title={t('لا توجد مواد منشورة','No published materials')}/>}
      {data.materials?.map(item=><article className="panel section-panel" key={item.id}>
        <span className="count-pill">{item.category}</span><h2>{item.title}</h2><p>{item.description}</p>
        {item.file?<button type="button" className="btn btn-outline compact" disabled={Boolean(busy)} onClick={()=>void download(item.id)}><Download size={16}/>{t('تنزيل المادة','Download material')}</button>:
          item.url?.startsWith('https://')?<a className="btn btn-outline compact" href={item.url} target="_blank" rel="noopener noreferrer">{t('فتح المصدر','Open source')}</a>:null}
      </article>)}
    </div>
  </section>
}
