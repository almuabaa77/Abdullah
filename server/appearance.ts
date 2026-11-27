import { paletteKeys, type GeneratedIcon, type Palette } from '../src/appearance'
import { ApiError } from './errors'

export type IconGenerator = (description:string,palette:Palette)=>Promise<GeneratedIcon>

export function webpBytes(value:unknown,max:number) {
  if(typeof value!=='string'||value.length>max||!/^UklGR[A-Za-z0-9+/]+={0,2}$/.test(value))return
  try {
    const bytes=Uint8Array.from(atob(value),char=>char.charCodeAt(0))
    if(bytes.length<20||String.fromCharCode(...bytes.subarray(8,12))!=='WEBP')return
    if(new DataView(bytes.buffer).getUint32(4,true)!==bytes.length-8)return
    return bytes
  } catch { return undefined }
}

const outputLimit=3_000_000

async function generateWithGemini(key:string,prompt:string):Promise<GeneratedIcon> {
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',{
    method:'POST',signal:AbortSignal.timeout(85_000),
    headers:{'x-goog-api-key':key,'Content-Type':'application/json'},
    body:JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      generationConfig:{responseModalities:['IMAGE'],imageConfig:{aspectRatio:'1:1',imageSize:'1K'}},
    }),
  })
  if(!response.ok)throw new ApiError('رفضت خدمة Gemini طلب الصورة. تحقق من المفتاح وصلاحية توليد الصور في Google AI Studio.',502)
  const result=await response.json() as {candidates?:{content?:{parts?:{thought?:boolean;inlineData?:{data?:string;mimeType?:string}}[]}}[]}
  for(const candidate of result.candidates??[]){
    for(const part of candidate.content?.parts??[]){
      const {data,mimeType}=part.inlineData??{}
      if(part.thought||!data||data.length>outputLimit)continue
      if(mimeType==='image/png'&&data.startsWith('iVBORw0KGgo')||mimeType==='image/jpeg'&&data.startsWith('/9j/')
        ||mimeType==='image/webp'&&webpBytes(data,outputLimit))return {image:data,mimeType}
    }
  }
  throw new Error('Invalid Gemini image')
}

async function generateWithOpenAI(key:string,prompt:string):Promise<GeneratedIcon> {
  const response=await fetch('https://api.openai.com/v1/images/generations',{
    method:'POST',signal:AbortSignal.timeout(85_000),
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model:'gpt-image-2.6-flare',n:1,size:'1024x1024',quality:'low',output_format:'webp',output_compression:80,prompt}),
  })
  if(!response.ok)throw new Error('Provider status '+response.status)
  const result=await response.json() as {data?:{b64_json?:string}[]}
  const image=result.data?.[0]?.b64_json
  if(!image||!webpBytes(image,outputLimit))throw new Error('Invalid OpenAI image')
  return {image,mimeType:'image/webp'}
}

export function createIconGenerator({gemini,openai}:{gemini?:string;openai?:string}):IconGenerator|undefined {
  const geminiKey=gemini?.trim(),openAIKey=openai?.trim()
  const generate=geminiKey?(prompt:string)=>generateWithGemini(geminiKey,prompt)
    :openAIKey?(prompt:string)=>generateWithOpenAI(openAIKey,prompt):undefined
  if(!generate)return

  let inFlight=false
  let latestRequest=0
  return async (description,palette)=>{
    if(inFlight||Date.now()-latestRequest<8000)throw new ApiError('انتظر قليلًا قبل توليد أيقونة أخرى.',429)
    inFlight=true
    latestRequest=Date.now()
    try {
      const colors=paletteKeys.map(name=>name+' '+palette[name]).join(', ')
      return await generate(`Create a square Islamic app icon for a Quran-learning platform. Use a simple, recognizable symbol centered in the middle 60 percent, with a solid edge-to-edge background. No text, lettering, or mockup. Palette: ${colors}. Icon description: ${description}`)
    } catch(error) {
      if(error instanceof ApiError)throw error
      console.error('Icon generation failed',error instanceof Error?error.name:'UnknownError')
      throw new ApiError('تعذر توليد الأيقونة الآن. تحقق من إعدادات خدمة الصور ثم حاول مجددًا.',502)
    } finally { inFlight=false }
  }
}
