import { useEffect, useState, type CSSProperties } from 'react'
import { ImagePlus, Palette as PaletteIcon, RotateCcw, Save, Sparkles } from 'lucide-react'
import { brandIconUrl, defaultPalette, iconContentLimit, paletteKeys, paletteVariables, readablePalette, type Palette } from './appearance'
import { useWorkspace } from './ui'

const colorLabels = {
  primary:['اللون الأساسي','Primary color'],accent:['اللون المميّز','Accent'],background:['خلفية التطبيق','App background'],
  surface:['البطاقات والأسطح','Cards and surfaces'],text:['لون النص','Text color'],
} as const

async function compressIcon(image:string) {
  const picture=new Image()
  picture.src='data:image/webp;base64,'+image
  await picture.decode()
  const canvas=document.createElement('canvas')
  canvas.width=512
  canvas.height=512
  const context=canvas.getContext('2d')
  if(!context)throw new Error()
  context.drawImage(picture,0,0,512,512)
  for(const quality of [.9,.75,.6,.45,.3,.15]){
    const encoded=canvas.toDataURL('image/webp',quality)
    if(!encoded.startsWith('data:image/webp;base64,'))break
    const base64=encoded.slice(23)
    if(base64.length<=iconContentLimit)return base64
  }
  throw new Error()
}

export function AdminAppearance({busy,save}:{busy:boolean;save:(action:string,payload:Record<string,unknown>)=>Promise<boolean>}) {
  const {data,t,generateIcon,iconGeneration}=useWorkspace()
  const [palette,setPalette]=useState<Palette>(()=>data.appearance??defaultPalette)
  const [icon,setIcon]=useState<string|null>()
  const [description,setDescription]=useState('')
  const [generating,setGenerating]=useState(false)
  const [error,setError]=useState('')
  const saved=data.appearance??defaultPalette
  const [editing,setEditing]=useState(false)
  useEffect(()=>{
    if(!editing)setPalette(data.appearance??defaultPalette)
  },[data.appearance,editing])
  const readable=readablePalette(palette)
  const changed=icon!==undefined||paletteKeys.some(key=>palette[key]!==saved[key])
  const currentIcon=icon===null?brandIconUrl():brandIconUrl(data.appearance?.iconVersion)
  const iconUrl=icon?'data:image/webp;base64,'+icon:currentIcon

  async function generate() {
    if(!description.trim()||generating||!readable)return
    setGenerating(true)
    setError('')
    try {
      const result=await generateIcon(description.trim(),palette)
      const image=await compressIcon(result).catch(()=>{throw new Error(t('تعذر تجهيز الصورة كأيقونة. جرّب وصفًا أبسط.','Could not prepare the image as an icon. Try a simpler description.'))})
      setIcon(image)
    } catch (error) {
      setError((error as Error).message)
    } finally {setGenerating(false)}
  }

  async function apply() {
    if(await save('appearance-save',{palette,icon})){
      setIcon(undefined)
      setEditing(false)
    }
  }

  return <section className="admin-appearance" aria-labelledby="appearance-heading">
    <header><span className="admin-circle-icon"><PaletteIcon size={21}/></span><div>
      <h2 id="appearance-heading">{t('هوية التطبيق','App appearance')}</h2>
      <p>{t('تطبّق الألوان والأيقونة المحفوظة على جميع الحسابات.','Saved colors and icons apply to all accounts.')}</p>
    </div></header>
    <div className="appearance-layout">
      <div className="appearance-editor">
        <fieldset disabled={busy||generating} className="appearance-colors">
          <legend>{t('ألوان التطبيق','App colors')}</legend>
          {paletteKeys.map(key=><label key={key}><span>{t(colorLabels[key][0],colorLabels[key][1])}</span><input type="color" value={palette[key]}
            onChange={event=>{setEditing(true);setPalette(previous=>({...previous,[key]:event.target.value}))}}/><span dir="ltr">{palette[key]}</span></label>)}
        </fieldset>
        {!readable&&<p className="error-box" role="status">{t('اختر خلفيات أفتح ونصًا ولونًا أساسيًا أغمق لسهولة القراءة.','Choose lighter backgrounds with darker text and primary colors for readability.')}</p>}
        <label>{t('وصف الأيقونة الإسلامية','Islamic icon description')}
          <textarea rows={2} maxLength={350} value={description} disabled={generating||!iconGeneration}
            onChange={event=>setDescription(event.target.value)} placeholder={t('مثال: مصحف مفتوح داخل قوس ذهبي بخلفية زيتونية','Example: an open Quran in a golden arch on an olive background')}/>
        </label>
        <div className="chip-row">
          <button type="button" className="btn btn-outline compact" disabled={!iconGeneration||!description.trim()||!readable||busy||generating} onClick={()=>void generate()}>
            <Sparkles size={16}/>{generating?t('جارٍ التوليد…','Generating…'):t('توليد الأيقونة','Generate icon')}
          </button>
          {(icon||icon!==null&&data.appearance?.iconVersion)&&<button type="button" className="btn btn-subtle compact" disabled={generating||busy} onClick={()=>setIcon(null)}><ImagePlus size={16}/>{t('استعادة الأيقونة الأصلية','Restore original icon')}</button>}
        </div>
        {!iconGeneration&&<p className="appearance-help">{t('لتفعيل التوليد، أضف مفتاح OpenAI إلى متغيرات بيئة الخادم.','Add an OpenAI key to the server environment to enable generation.')}</p>}
        {error&&<p className="error-box" role="alert">{error}</p>}
      </div>
      <div className="appearance-preview" style={paletteVariables(palette) as CSSProperties}>
        <div>
          <img src={iconUrl} alt={t('معاينة أيقونة التطبيق','App icon preview')} width="72" height="72"/>
          <strong>{t('حلقات جامع الخير','Al-Khair Quran Circles')}</strong>
          <span className="appearance-preview-button">{t('معاينة المظهر','Appearance preview')}</span>
        </div>
      </div>
    </div>
    <footer>
      <button className="btn btn-outline compact" type="button" disabled={busy||generating} onClick={()=>{setEditing(true);setPalette(defaultPalette)}}><RotateCcw size={15}/>{t('الألوان الأصلية','Original colors')}</button>
      <button className="btn btn-primary compact" type="button" disabled={!changed||!readable||busy||generating} onClick={()=>void apply()}><Save size={16}/>{t('حفظ الهوية','Save appearance')}</button>
    </footer>
  </section>
}
