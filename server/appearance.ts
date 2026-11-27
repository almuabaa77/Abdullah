import { paletteKeys, type Palette } from '../src/appearance'
import { ApiError } from './errors'

export type IconGenerator = (description:string,palette:Palette)=>Promise<string>

export function webpBytes(value:unknown,max:number) {
  if(typeof value!=='string'||value.length>max||!/^UklGR[A-Za-z0-9+/]+={0,2}$/.test(value))return
  try {
    const bytes=Uint8Array.from(atob(value),char=>char.charCodeAt(0))
    if(bytes.length<20||String.fromCharCode(...bytes.subarray(8,12))!=='WEBP')return
    if(new DataView(bytes.buffer).getUint32(4,true)!==bytes.length-8)return
    return bytes
  } catch { return undefined }
}

export function createIconGenerator(key:string):IconGenerator {
  let inFlight=false
  let latestRequest=0
  return async (description,palette)=>{
    if(inFlight||Date.now()-latestRequest<8000)throw new ApiError('انتظر قليلًا قبل توليد أيقونة أخرى.',429)
    inFlight=true
    latestRequest=Date.now()
    try {
      const colors=paletteKeys.map(name=>name+' '+palette[name]).join(', ')
      const response=await fetch('https://api.openai.com/v1/images/generations',{
        method:'POST',signal:AbortSignal.timeout(85_000),
        headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'gpt-image-2.6-flare',n:1,size:'1024x1024',quality:'low',output_format:'webp',output_compression:80,
          prompt:`Create a square Islamic app icon for a Quran-learning platform. Use a simple, recognizable symbol centered in the middle 60 percent, with a solid edge-to-edge background. No text, lettering, or mockup. Palette: ${colors}. Icon description: ${description}`,
        }),
      })
      if(!response.ok)throw new Error('Provider status '+response.status)
      const result=await response.json() as {data?:{b64_json?:string}[]}
      const image=result.data?.[0]?.b64_json
      if(!image||!webpBytes(image,3_000_000))throw new Error('Invalid image')
      return image
    } catch(error) {
      console.error('Icon generation failed',error instanceof Error?error.name:'UnknownError')
      throw new ApiError('تعذر توليد الأيقونة الآن. تحقق من إعدادات خدمة الصور ثم حاول مجددًا.',502)
    } finally { inFlight=false }
  }
}
